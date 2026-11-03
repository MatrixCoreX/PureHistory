/**
 * Bounded, read-only-source projection into the existing Elasticsearch cluster.
 * A full receipt pass is repeated to heal late source indexing. No node scan,
 * transaction submission, contract changes, or additional database service.
 */
import fs from 'node:fs';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {Client} from '@elastic/elasticsearch';
import {hash, identity, project, schemaVersion, uint} from '../build/key-history/model.js';
import {historyIndex} from '../build/key-history/query.js';

const root = process.env.HISTORY_ROOT;
if (!root) throw Error('HISTORY_ROOT is required');
const connections = JSON.parse(fs.readFileSync(path.join(root, 'config/connections.json')));
const chain = process.env.HISTORY_CHAIN || 'aic', cfg = connections.chains[chain];
const expectedChain = process.env.EXPECTED_CHAIN_ID, expectedCode = process.env.EXPECTED_KEY_CODE_HASH;
if (!expectedChain || !expectedCode || cfg.chain_id !== expectedChain) throw Error('Explicit chain and wallet code pins are required');
const e = connections.elasticsearch;
const elastic = new Client({node: /^[a-z]+:\/\//.test(e.host) ? e.host : 'http://' + e.host,
    auth: {username: e.user, password: e.pass}, requestTimeout: 15000, maxRetries: 1});
const index = historyIndex(chain), source = chain + '-action-*';
const batch = Math.min(100, Math.max(5, Number(process.env.KEY_HISTORY_BATCH || 25)));
const interval = Math.max(3000, Number(process.env.KEY_HISTORY_INTERVAL_MS || 10000));
let stopping = false, status, config, pages = 0;
const keys = new Map(), canonicalBlocks = new Map();
process.on('SIGTERM', () => { stopping = true; });
process.on('SIGINT', () => { stopping = true; });
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function rpc(method, body = {}) {
    const r = await fetch(cfg.http.replace(/\/$/, '') + '/v1/chain/' + method, {
        method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(body),
        signal: AbortSignal.timeout(15000)
    });
    if (!r.ok) throw Error('Source RPC ' + method + ' HTTP ' + r.status);
    return r.json();
}
async function putStatus() {
    await elastic.index({index, id: '_status', document: status, refresh: 'wait_for'});
}
async function initialize() {
    if (!await elastic.indices.exists({index})) {
        await elastic.indices.create({index, settings: {number_of_shards: 1, number_of_replicas: 0, refresh_interval: '1s'},
            mappings: {dynamic: false, properties: {
                doc_type: {type: 'keyword'}, chain_id: {type: 'keyword'}, wallet_hash: {type: 'keyword'},
                sort_key: {type: 'keyword'}, kind: {type: 'keyword'}, direction: {type: 'keyword'},
                affected_assets: {type: 'keyword'}, block_num: {type: 'long'}, timestamp: {type: 'date'}
            }}});
    }
    try { status = (await elastic.get({index, id: '_status'}))._source; } catch (err) {
        if (err.statusCode !== 404) throw err;
    }
    if (status && (status.chain_id !== expectedChain || status.schema_version !== schemaVersion)) throw Error('Projection identity mismatch');
    status ||= {doc_type: 'status', schema_version: schemaVersion, chain_id: expectedChain, generation: randomUUID(),
        ready: false, sequence: '0', scanned_irreversible_block: 0, cycles: 0};
    await putStatus();
}
async function verifySource() {
    const info = await rpc('get_info');
    if (info.chain_id !== expectedChain) throw Error('Source chain changed; projection paused');
    const code = await rpc('get_code_hash', {account_name: 'eosio.key'});
    if (code.code_hash !== expectedCode) throw Error('Wallet code changed; review projection compatibility');
    const result = await rpc('get_table_rows', {code: 'eosio.key', scope: 'eosio.key', table: 'config', json: true, limit: 1});
    config = result.rows?.[0];
    if (result.more || !config || config.version !== 2 || config.chain_id !== expectedChain) throw Error('Unsupported wallet configuration');
    const blocks = await elastic.search({index: chain + '-block-*', size: 1, sort: [{block_num: 'desc'}], _source: ['block_num']});
    const indexed = blocks.hits.hits[0]?._source?.block_num;
    if (!Number.isSafeInteger(indexed) || indexed < 1) throw Error('Source block index is initializing');
    return Math.min(info.last_irreversible_block_num, indexed);
}
async function resolveKey(h) {
    if (/^0+$/.test(h) || keys.has(h)) return;
    const result = await rpc('get_table_rows', {code: 'eosio.key', scope: 'eosio.key', table: 'wallets', json: true,
        index_position: 2, key_type: 'sha256', lower_bound: h, upper_bound: h, limit: 2});
    const row = result.rows?.[0];
    if (result.more || result.rows?.length !== 1 || hash(row.key_hash) !== h || identity(row.key).hash !== h) throw Error('Unable to resolve indexed wallet identity');
    if (keys.size >= 4096) keys.delete(keys.keys().next().value);
    keys.set(h, identity(row.key).key);
}
async function projectBatch(hits) {
    const actions = hits.map(x => x._source);
    // Lookup only blocks referenced by indexed receipts. Never trust a failed
    // transaction trace or a forked source action as a finalized wallet event.
    for (const action of actions) {
        if (!canonicalBlocks.has(action.block_num)) {
            const block = await rpc('get_block', {block_num_or_id: action.block_num});
            if (canonicalBlocks.size >= 512) canonicalBlocks.delete(canonicalBlocks.keys().next().value);
            canonicalBlocks.set(action.block_num, {id: hash(block.id), transactions: new Set(block.transactions
                .filter(x => x.status === 'executed').map(x => typeof x.trx === 'string' ? x.trx.toLowerCase() : hash(x.trx.id)))});
        }
        const block = canonicalBlocks.get(action.block_num);
        if (block.id !== hash(action.block_id) || !block.transactions.has(hash(action.trx_id))) throw Error('Receipt is not in an executed canonical transaction');
    }
    const ids = [...new Set(actions.filter(x => !/^0+$/.test(x.act.data.from_key)).map(x => x.trx_id))];
    let byTransaction = new Map();
    if (ids.length) {
        const roots = await elastic.search({index: source, size: 1000, track_total_hits: true,
            query: {bool: {filter: [{terms: {trx_id: ids}}, {term: {'act.account': 'eosio.key'}}]}}});
        if (roots.timed_out || roots._shards?.failed || roots.hits.total?.value > 1000) throw Error('Incomplete source transaction actions');
        for (const hit of roots.hits.hits) {
            const a = hit._source; const list = byTransaction.get(a.trx_id) || [];
            list.push(a); byTransaction.set(a.trx_id, list);
        }
    }
    const docs = [];
    for (const action of actions) {
        const d = action.act.data;
        await resolveKey(hash(d.from_key)); await resolveKey(hash(d.to_key));
        const views = project(action, {chainId: expectedChain, deployment: config.deployment,
            feeContract: config.fee_contract, feeSymbol: config.fee_symbol, publicKeys: keys,
            transactionActions: byTransaction.get(action.trx_id) || []});
        for (const view of views) docs.push({index: {_index: index, _id: view.id}}, view);
    }
    if (docs.length) {
        const result = await elastic.bulk({operations: docs, refresh: 'wait_for'});
        if (result.errors) throw Error('Projection bulk write incomplete; retry same receipt IDs');
    }
}
await initialize();
while (!stopping) {
    try {
        const target = await verifySource();
        let after, maximum = BigInt(status.sequence), failed = false;
        do {
            const result = await elastic.search({index: source, size: batch, timeout: '5s', track_total_hits: false,
                query: {bool: {filter: [{term: {'act.account': 'eosio.key'}}, {term: {'act.name': 'receipt'}},
                    {range: {block_num: {lte: target}}}]}},
                sort: [{global_sequence: 'asc'}, {action_ordinal: 'asc'}, {trx_id: 'asc'}],
                ...(after ? {search_after: after} : {})});
            if (result.timed_out || result._shards?.failed) throw Error('Incomplete source receipt query');
            const hits = result.hits.hits;
            if (!hits.length) break;
            await projectBatch(hits);
            for (const x of hits) maximum = BigInt(uint(x._source.global_sequence)) > maximum ? BigInt(uint(x._source.global_sequence)) : maximum;
            after = hits[hits.length - 1].sort;
            pages++;
            if (hits.length < batch) break;
            if (stopping) { failed = true; break; }
            await sleep(interval);
        } while (!stopping);
        if (!failed && !stopping) {
            status = {...status, ready: true, paused: false, sequence: maximum.toString(), scanned_irreversible_block: target,
                last_success_utc: new Date().toISOString(), cycles: status.cycles + 1, deployment: config.deployment,
                wallet_code_hash: expectedCode, coverage: 'indexed_receipts', complete_lifetime_history: false};
            await putStatus();
            console.log(JSON.stringify({status: 'PASS', cycle: status.cycles, through: target, receipt_sequence: status.sequence, pages}));
        }
    } catch (err) {
        status.paused = true;
        await putStatus().catch(() => {});
        console.error(JSON.stringify({status: 'PAUSED', reason: err.message, last_success_utc: status.last_success_utc}));
    }
    await sleep(Math.max(interval, 30000));
}
await elastic.close();
