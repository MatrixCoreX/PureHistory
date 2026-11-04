import {Name, Serializer, Transaction} from '@wharfkit/antelope';
import {inflateSync} from 'node:zlib';

const kinds = ['devpropose', 'devveto', 'devexec', 'devcancel'];
const proposalFields = ['target', 'old_code_hash', 'old_abi_hash', 'new_code_hash', 'new_abi_hash', 'review_document_hash'];
const abi: any = {version: 'eosio::abi/1.2', types: [], structs: [
    {name: 'devpropose', base: '', fields: proposalFields.map(name => ({name, type: name === 'target' ? 'name' : 'checksum256'}))},
    {name: 'devveto', base: '', fields: [{name: 'voter', type: 'name'}, {name: 'proposal_id', type: 'uint64'}]},
    ...['devexec', 'devcancel'].map(name => ({name, base: '', fields: [{name: 'proposal_id', type: 'uint64'}]}))
], actions: [], tables: []};
function fail(message: string, statusCode = 503): never { throw Object.assign(new Error(message), {statusCode}); }
function uint(value: any, max = 0xffffffffffffffffn) {
    if (typeof value === 'number' && !Number.isSafeInteger(value) || !/^(0|[1-9]\d*)$/.test(String(value))) fail('Invalid native upgrade history integer');
    const n = BigInt(String(value)); if (n > max) fail('Invalid native upgrade history integer'); return n;
}
function hash(value: any): string { if (typeof value !== 'string' || !/^[a-f\d]{64}$/i.test(value)) fail('Invalid native upgrade history hash'); return value.toLowerCase(); }
function account(value: any): string {
    try { if (typeof value === 'string' && value.length && value.length <= 13 && Name.from(value).toString() === value) return value; } catch { /* reject */ }
    return fail('Invalid native upgrade history account');
}
function flag(value: any) { if (value === true || value === 1) return true; if (value === false || value === 0) return false; return fail('Invalid native upgrade state flag'); }
function timestamp(value: any): string {
    if (typeof value !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{3})?Z?$/.test(value)) fail('Invalid native upgrade history timestamp');
    const n = Date.parse(value.endsWith('Z') ? value : value + 'Z'); if (!Number.isFinite(n)) fail('Invalid native upgrade history timestamp'); return new Date(n).toISOString();
}
function data(kind: string, input: any): any {
    let value = input;
    if (typeof value === 'string') {
        if (!/^(?:[a-f\d]{2})+$/i.test(value)) fail('Undecoded native upgrade action');
        try { value = JSON.parse(JSON.stringify(Serializer.decode({abi, type: kind, data: kind === 'devexec' ? value.slice(0, 16) : value}))); }
        catch { return fail('Undecoded native upgrade action'); }
    }
    if (!value || typeof value !== 'object') fail('Invalid native upgrade action');
    if (kind === 'devpropose') return Object.fromEntries(proposalFields.map(key => [key, key === 'target' ? account(value[key]) : hash(value[key])]));
    return {proposal_id: uint(value.proposal_id).toString(), ...(kind === 'devveto' ? {voter: account(value.voter)} : {})};
}
function authorization(input: any): any[] {
    if (!Array.isArray(input) || !input.length || input.length > 64) fail('Invalid native upgrade authorization');
    return input.map(value => ({actor: account(value.actor), permission: account(value.permission)}));
}
export function normalizeUpgradeAction(source: any) {
    const kind = source?.act?.name;
    if (source?.act?.account !== 'eosio' || !kinds.includes(kind)) fail('Invalid native upgrade history action');
    let raw = source.act.data;
    if (raw?.account && raw?.name && raw?.authorization) raw = raw.data;
    if (typeof raw !== 'string') raw = {...source['@' + kind], ...raw};
    const block = Number(uint(source.block_num, 0xffffffffn)), blockId = hash(source.block_id);
    if (!block || parseInt(blockId.slice(0, 8), 16) !== block) fail('Invalid native upgrade block identity');
    return {kind, data: data(kind, raw), authorization: authorization(source.act.authorization),
        block_num: block, block_id: blockId, transaction_id: hash(source.trx_id), timestamp: timestamp(source['@timestamp'] || source.timestamp),
        action_ordinal: Number(uint(source.action_ordinal, 0xffffffffn)), creator_action_ordinal: Number(uint(source.creator_action_ordinal, 0xffffffffn))};
}
const canonicalCache = new Map<string, any>();
async function canonicalBlock(chainId: string, row: any, lib: number, rpc: any) {
    if (row.block_num > lib) fail('Native upgrade history is not irreversible');
    const key = chainId + ':' + row.block_id; let block = canonicalCache.get(key);
    if (!block) {
        const raw = await rpc('get_block', {block_num_or_id: row.block_id});
        if (hash(raw.id) !== row.block_id || Number(raw.block_num) !== row.block_num) fail('Native upgrade history canonical block mismatch');
        if (!Array.isArray(raw.transactions)) fail('Native upgrade block receipts are unavailable');
        block = {id: row.block_id, block_num: row.block_num, timestamp: timestamp(raw.timestamp), transactions: new Map()};
        for (const [index, receipt] of raw.transactions.entries()) {
            const id = hash(typeof receipt.trx === 'string' ? receipt.trx : receipt.trx.id); let transaction = receipt.trx.transaction || receipt.trx;
            if (!transaction.actions && receipt.trx.packed_trx) {
                try {
                    let bytes = Buffer.from(receipt.trx.packed_trx, 'hex');
                    if (receipt.trx.compression === 1 || receipt.trx.compression === 'zlib') bytes = inflateSync(bytes);
                    transaction = JSON.parse(JSON.stringify(Serializer.decode({type: Transaction, data: bytes})));
                } catch { fail('Native upgrade transaction payload is unavailable'); }
            }
            const actions = (transaction.actions || []).map((act: any, root: number) => {
                if (act.account !== 'eosio' || !kinds.includes(act.name)) return undefined;
                return {root, kind: act.name, data: data(act.name, act.hex_data || act.data), authorization: authorization(act.authorization)};
            }).filter(Boolean);
            block.transactions.set(id, {index, status: receipt.status, actions});
        }
        if (canonicalCache.size >= 2048) canonicalCache.delete(canonicalCache.keys().next().value!);
        canonicalCache.set(key, block);
    }
    if (block.timestamp !== row.timestamp) fail('Native upgrade history timestamp mismatch');
    const tx = block.transactions.get(row.transaction_id); if (!tx || tx.status !== 'executed') fail('Native upgrade history has no executed canonical receipt');
    if (row.creator_action_ordinal !== 0) {
        if (row.kind !== 'devveto') fail('Native upgrade action must be top-level');
        return {transaction_index: tx.index, root_index: -1, verification: 'indexed_inline_trace_and_canonical_transaction'};
    }
    const matches = tx.actions.filter((act: any) => act.kind === row.kind && JSON.stringify(act.data) === JSON.stringify(row.data) && JSON.stringify(act.authorization) === JSON.stringify(row.authorization));
    if (matches.length !== 1) fail('Native upgrade root action is missing or ambiguous');
    return {transaction_index: tx.index, root_index: matches[0].root, verification: 'canonical_root_action'};
}
function checkedHits(response: any, maximum: number): any[] {
    if (response.timed_out || response._shards?.failed || response.hits?.total?.relation !== 'eq' ||
        !Number.isSafeInteger(response.hits.total.value) || response.hits.total.value > maximum || response.hits.hits.length !== response.hits.total.value) fail('Native upgrade history index query is incomplete');
    return response.hits.hits.map((hit: any) => hit._source);
}
export async function queryUpgradeHistory(elastic: any, chain: string, rpc: any, query: any = {}) {
    const started = Date.now();
    const verify = async (row: any, chainId: string, lib: number) => {
        if (Date.now() - started > 12000) fail('Native upgrade history verification budget exceeded');
        return canonicalBlock(chainId, row, lib, rpc);
    };
    if (!/^[a-z0-9_-]{1,40}$/.test(chain)) fail('Invalid native upgrade history chain');
    if (Object.keys(query).some(key => !['offset', 'limit'].includes(key))) fail('Unknown upgrade history query', 400);
    const offset = Number(uint(query.offset ?? 0, 1000n)), limit = Number(uint(query.limit ?? 20, 20n)); if (!limit) fail('Invalid upgrade history limit', 400);
    const info = await rpc('get_info', {}), native = await rpc('get_upgrade_state', {}), chainId = hash(info.chain_id), lib = Number(uint(info.last_irreversible_block_num, 0xffffffffn));
    const nativeId = uint(native.proposal_id), pending = flag(native.pending); if (nativeId > 1000n) fail('Native proposal history exceeds the bounded reconstruction limit');
    const source = {includes: ['act', '@devpropose', '@devveto', '@devexec.proposal_id', '@devcancel', 'block_num', 'block_id', 'trx_id', '@timestamp', 'action_ordinal', 'creator_action_ordinal'],
        excludes: ['act.data.code', 'act.data.abi', 'act.data.data.code', 'act.data.data.abi']};
    const search = async (names: string[], range: any, maximum: number) => checkedHits(await elastic.search({index: chain + '-action-*', size: maximum + 1, track_total_hits: true, timeout: '3s', _source: source,
        query: {bool: {filter: [{term: {'act.account': 'eosio'}}, {terms: {'act.name': names}}, {range: {block_num: range}}]}}, sort: [{block_num: 'asc'}, {action_ordinal: 'asc'}]}), maximum);
    const proposals: any[] = (await search(['devpropose'], {lte: lib}, 1000)).map(normalizeUpgradeAction);
    if (BigInt(proposals.length) !== nativeId) fail('Native proposal sequence is not fully indexed');
    const seen = new Set<string>();
    for (const row of proposals) {
        Object.assign(row, await verify(row, chainId, lib));
        const key = row.transaction_id + ':' + row.root_index; if (seen.has(key)) fail('Duplicate native proposal index record'); seen.add(key);
    }
    proposals.sort((a, b) => a.block_num - b.block_num || a.transaction_index - b.transaction_index || a.root_index - b.root_index);
    const entries: any[] = proposals.map((row, index) => ({proposal_id: String(index + 1), ...row.data, authorization: row.authorization,
        submitted: {transaction_id: row.transaction_id, block_num: row.block_num, block_id: row.block_id, timestamp: row.timestamp, action_ordinal: row.action_ordinal},
        status: 'closed_unknown', vetoes: [], executed: undefined, cancelled: undefined}));
    if (entries.length) {
        const latest = entries[entries.length - 1], expected = data('devpropose', native);
        if (proposalFields.some(key => latest[key] !== expected[key])) fail('Latest indexed proposal differs from native state');
        latest.status = pending ? 'pending' : 'closed_unknown';
    }
    const page = entries.slice().reverse().slice(offset, offset + limit), byId = new Map(page.map(entry => [entry.proposal_id, entry]));
    if (page.length) {
        const first = Math.min(...page.map(entry => entry.submitted.block_num));
        const boundary = entries.find(entry => BigInt(entry.proposal_id) === BigInt(page[0].proposal_id) + 1n)?.submitted.block_num ?? lib;
        const events = (await search(['devveto', 'devexec', 'devcancel'], {gte: first, lte: boundary}, 5000)).map(normalizeUpgradeAction);
        const eventIds = new Set<string>();
        for (const row of events) {
            const entry = byId.get(row.data.proposal_id); if (!entry) continue;
            const key = row.transaction_id + ':' + row.action_ordinal; if (eventIds.has(key)) fail('Duplicate native upgrade event'); eventIds.add(key);
            const verification = await verify(row, chainId, lib);
            const proof = {transaction_id: row.transaction_id, block_num: row.block_num, block_id: row.block_id, timestamp: row.timestamp, action_ordinal: row.action_ordinal, ...verification};
            if (row.kind === 'devveto') {
                if (!row.authorization.some(auth => auth.actor === row.data.voter) || entry.vetoes.some((veto: any) => veto.voter === row.data.voter)) fail('Invalid or duplicate native veto');
                entry.vetoes.push({voter: row.data.voter, ...proof});
            } else {
                if (entry.executed || entry.cancelled) fail('Conflicting native proposal closing records');
                entry[row.kind === 'devexec' ? 'executed' : 'cancelled'] = proof; entry.status = row.kind === 'devexec' ? 'executed' : 'cancelled';
            }
        }
    }
    const last = await rpc('get_info', {}); if (hash(last.chain_id) !== chainId || Number(last.last_irreversible_block_num) < lib) fail('Native upgrade history chain changed');
    return {schema_version: 1, chain_id: chainId, native_latest_proposal_id: nativeId.toString(), total_proposals: entries.length,
        offset, limit, entries: page, has_more: offset + page.length < entries.length,
        indexing: {irreversible_block: lib, complete_proposal_sequence: true, vote_counts: 'indexed_irreversible_actions',
            historical_deadlines_and_electorates: 'not_inferred', source: 'native_actions_and_canonical_block_receipts'}};
}
