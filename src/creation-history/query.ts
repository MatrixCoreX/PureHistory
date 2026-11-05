import {Name, Serializer, Transaction} from '@wharfkit/antelope';
import {inflateSync} from 'node:zlib';

const kinds = ['syspropose', 'sysveto', 'sysexec', 'syscancel'];
const proposalFields = ['target', 'resource_payer', 'ram_payment', 'authority_version', 'code_bytes', 'abi_bytes', 'code_hash', 'abi_hash', 'review_document_hash'];
const proposalTypes: any = {target:'name', resource_payer:'name', ram_payment:'int64', authority_version:'uint32', code_bytes:'uint32', abi_bytes:'uint32'};
const abi: any = {version: 'eosio::abi/1.2', types: [], structs: [
    {name: 'syspropose', base: '', fields: proposalFields.map(name => ({name, type: proposalTypes[name] || 'checksum256'}))},
    {name: 'sysveto', base: '', fields: [{name: 'voter', type: 'name'}, {name: 'proposal_id', type: 'uint64'}]},
    ...['sysexec', 'syscancel'].map(name => ({name, base: '', fields: [{name: 'proposal_id', type: 'uint64'}]}))
], actions: [], tables: []};
function fail(message: string, statusCode = 503): never { throw Object.assign(new Error(message), {statusCode}); }
function uint(value: any, max = 0xffffffffffffffffn) {
    if (typeof value === 'number' && !Number.isSafeInteger(value) || !/^(0|[1-9]\d*)$/.test(String(value))) fail('Invalid native creation history integer');
    const n = BigInt(String(value)); if (n > max) fail('Invalid native creation history integer'); return n;
}
function hash(value: any): string { if (typeof value !== 'string' || !/^[a-f\d]{64}$/i.test(value)) fail('Invalid native creation history hash'); return value.toLowerCase(); }
function account(value: any): string {
    try { if (typeof value === 'string' && value.length && value.length <= 13 && Name.from(value).toString() === value) return value; } catch { /* reject */ }
    return fail('Invalid native creation history account');
}
function flag(value: any) { if (value === true || value === 1) return true; if (value === false || value === 0) return false; return fail('Invalid native creation state flag'); }
function timestamp(value: any): string {
    if (typeof value !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{3})?Z?$/.test(value)) fail('Invalid native creation history timestamp');
    const n = Date.parse(value.endsWith('Z') ? value : value + 'Z'); if (!Number.isFinite(n)) fail('Invalid native creation history timestamp'); return new Date(n).toISOString();
}
function data(kind: string, input: any): any {
    let value = input;
    if (typeof value === 'string') {
        if (!/^(?:[a-f\d]{2})+$/i.test(value)) fail('Undecoded native creation action');
        try { value = JSON.parse(JSON.stringify(Serializer.decode({abi, type: kind, data: kind === 'sysexec' ? value.slice(0, 16) : value}))); }
        catch { return fail('Undecoded native creation action'); }
    }
    if (!value || typeof value !== 'object') fail('Invalid native creation action');
    if (kind === 'syspropose') {
        const result: any = Object.fromEntries(proposalFields.map(key => [key, ['target','resource_payer'].includes(key) ? account(value[key]) :
            proposalTypes[key] ? uint(value[key], key === 'ram_payment' ? 100000000n : key === 'authority_version' ? 3n : key === 'code_bytes' ? 16777216n : 1048576n).toString() : hash(value[key])]));
        if (['ram_payment','authority_version','code_bytes','abi_bytes'].some(key => result[key] === '0')) fail('Invalid native creation payload bounds');
        return result;
    }
    return {proposal_id: uint(value.proposal_id).toString(), ...(kind === 'sysveto' ? {voter: account(value.voter)} : {})};
}
function authorization(input: any): any[] {
    if (!Array.isArray(input) || !input.length || input.length > 64) fail('Invalid native creation authorization');
    return input.map(value => ({actor: account(value.actor), permission: account(value.permission)}));
}
export function normalizeCreationAction(source: any) {
    const kind = source?.act?.name;
    if (source?.act?.account !== 'eosio' || !kinds.includes(kind)) fail('Invalid native creation history action');
    let raw = source.act.data;
    if (raw?.account && raw?.name && raw?.authorization) raw = raw.data;
    if (typeof raw !== 'string') raw = {...source['@' + kind], ...raw};
    const block = Number(uint(source.block_num, 0xffffffffn)), blockId = hash(source.block_id);
    if (!block || parseInt(blockId.slice(0, 8), 16) !== block) fail('Invalid native creation block identity');
    return {kind, data: data(kind, raw), authorization: authorization(source.act.authorization),
        block_num: block, block_id: blockId, transaction_id: hash(source.trx_id), timestamp: timestamp(source['@timestamp'] || source.timestamp),
        action_ordinal: Number(uint(source.action_ordinal, 0xffffffffn)), creator_action_ordinal: Number(uint(source.creator_action_ordinal, 0xffffffffn))};
}
const canonicalCache = new Map<string, any>();
async function canonicalBlock(chainId: string, row: any, lib: number, rpc: any) {
    if (row.block_num > lib) fail('Native creation history is not irreversible');
    const key = chainId + ':' + row.block_id; let block = canonicalCache.get(key);
    if (!block) {
        const raw = await rpc('get_block', {block_num_or_id: row.block_id});
        if (hash(raw.id) !== row.block_id || Number(raw.block_num) !== row.block_num) fail('Native creation history canonical block mismatch');
        if (!Array.isArray(raw.transactions)) fail('Native creation block receipts are unavailable');
        block = {id: row.block_id, block_num: row.block_num, timestamp: timestamp(raw.timestamp), transactions: new Map()};
        for (const [index, receipt] of raw.transactions.entries()) {
            const id = hash(typeof receipt.trx === 'string' ? receipt.trx : receipt.trx.id); let transaction = receipt.trx.transaction || receipt.trx;
            if (!transaction.actions && receipt.trx.packed_trx) {
                try {
                    let bytes = Buffer.from(receipt.trx.packed_trx, 'hex');
                    if (receipt.trx.compression === 1 || receipt.trx.compression === 'zlib') bytes = inflateSync(bytes);
                    transaction = JSON.parse(JSON.stringify(Serializer.decode({type: Transaction, data: bytes})));
                } catch { fail('Native creation transaction payload is unavailable'); }
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
    if (block.timestamp !== row.timestamp) fail('Native creation history timestamp mismatch');
    const tx = block.transactions.get(row.transaction_id); if (!tx || tx.status !== 'executed') fail('Native creation history has no executed canonical receipt');
    if (row.creator_action_ordinal !== 0) fail('Native creation action must be top-level');
    const matches = tx.actions.filter((act: any) => act.kind === row.kind && JSON.stringify(act.data) === JSON.stringify(row.data) && JSON.stringify(act.authorization) === JSON.stringify(row.authorization));
    if (matches.length !== 1) fail('Native creation root action is missing or ambiguous');
    return {transaction_index: tx.index, root_index: matches[0].root, verification: 'canonical_root_action'};
}
function checkedHits(response: any, maximum: number): any[] {
    if (response.timed_out || response._shards?.failed || response.hits?.total?.relation !== 'eq' ||
        !Number.isSafeInteger(response.hits.total.value) || response.hits.total.value > maximum || response.hits.hits.length !== response.hits.total.value) fail('Native creation history index query is incomplete');
    return response.hits.hits.map((hit: any) => hit._source);
}
export async function queryCreationHistory(elastic: any, chain: string, rpc: any, query: any = {}) {
    const started = Date.now();
    const verify = async (row: any, chainId: string, lib: number) => {
        if (Date.now() - started > 12000) fail('Native creation history verification budget exceeded');
        return canonicalBlock(chainId, row, lib, rpc);
    };
    if (!/^[a-z0-9_-]{1,40}$/.test(chain)) fail('Invalid native creation history chain');
    if (Object.keys(query).some(key => !['offset', 'limit'].includes(key))) fail('Unknown creation history query', 400);
    const offset = Number(uint(query.offset ?? 0, 1000n)), limit = Number(uint(query.limit ?? 20, 20n)); if (!limit) fail('Invalid creation history limit', 400);
    const info = await rpc('get_info', {}), native = await rpc('get_system_account_state', {}), chainId = hash(info.chain_id), lib = Number(uint(info.last_irreversible_block_num, 0xffffffffn));
    const nativeId = uint(native.latest_proposal_id);
    if (flag(native.proposal_exists) !== (nativeId > 0n) || !Array.isArray(native.pending_proposals) || native.pending_proposals.length > 4 ||
        uint(native.pending_count, 4n) !== BigInt(native.pending_proposals.length)) fail('Invalid native parallel creation state');
    const pending = new Map<string, any>();
    for (const row of native.pending_proposals) {
        const id = uint(row.proposal_id).toString();
        if (!flag(row.pending) || id === '0' || BigInt(id) > nativeId || pending.has(id)) fail('Invalid native parallel creation state');
        pending.set(id, row);
    } if (nativeId > 1000n) fail('Native proposal history exceeds the bounded reconstruction limit');
    const source = {includes: ['act', '@syspropose', '@sysveto', '@sysexec.proposal_id', '@syscancel', 'block_num', 'block_id', 'trx_id', '@timestamp', 'action_ordinal', 'creator_action_ordinal'],
        excludes: ['act.data.code', 'act.data.abi', 'act.data.data.code', 'act.data.data.abi']};
    const search = async (names: string[], range: any, maximum: number) => checkedHits(await elastic.search({index: chain + '-action-*', size: maximum + 1, track_total_hits: true, timeout: '3s', _source: source,
        query: {bool: {filter: [{term: {'act.account': 'eosio'}}, {terms: {'act.name': names}}, {range: {block_num: range}}]}}, sort: [{block_num: 'asc'}, {action_ordinal: 'asc'}]}), maximum);
    const proposals: any[] = (await search(['syspropose'], {lte: lib}, 1000)).map(normalizeCreationAction);
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
        const latest = entries[entries.length - 1], expected = data('syspropose', native);
        if (proposalFields.some(key => latest[key] !== expected[key])) fail('Latest indexed proposal differs from native state');
        if (uint(native.proposal_id) !== nativeId) fail('Native latest creation counter differs');
        for (const entry of entries) {
            const row = pending.get(entry.proposal_id); if (!row) continue;
            const expectedPending = data('syspropose', row);
            if (proposalFields.some(key => entry[key] !== expectedPending[key])) fail('Pending indexed proposal differs from native state');
            entry.status = 'pending';
        }
    }
    const page = entries.slice().reverse().slice(offset, offset + limit), byId = new Map(page.map(entry => [entry.proposal_id, entry]));
    if (page.length) {
        const first = Math.min(...page.map(entry => entry.submitted.block_num));
        // Parallel proposals can close after newer IDs were submitted; scan to LIB.
        const boundary = lib;
        const events = (await search(['sysveto', 'sysexec', 'syscancel'], {gte: first, lte: boundary}, 5000)).map(normalizeCreationAction);
        const eventIds = new Set<string>();
        for (const row of events) {
            const entry = byId.get(row.data.proposal_id); if (!entry) continue;
            const key = row.transaction_id + ':' + row.action_ordinal; if (eventIds.has(key)) fail('Duplicate native creation event'); eventIds.add(key);
            const verification = await verify(row, chainId, lib);
            const proof = {transaction_id: row.transaction_id, block_num: row.block_num, block_id: row.block_id, timestamp: row.timestamp, action_ordinal: row.action_ordinal, ...verification};
            if (row.kind === 'sysveto') {
                if (!row.authorization.some(auth => auth.actor === row.data.voter) || entry.vetoes.some((veto: any) => veto.voter === row.data.voter)) fail('Invalid or duplicate native veto');
                entry.vetoes.push({voter: row.data.voter, ...proof});
            } else {
                if (entry.executed || entry.cancelled) fail('Conflicting native proposal closing records');
                entry[row.kind === 'sysexec' ? 'executed' : 'cancelled'] = proof; entry.status = row.kind === 'sysexec' ? 'executed' : 'cancelled';
            }
        }
    }
    const last = await rpc('get_info', {}); if (hash(last.chain_id) !== chainId || Number(last.last_irreversible_block_num) < lib) fail('Native creation history chain changed');
    return {schema_version: 1, proposal_kind: 'account_creation', chain_id: chainId, native_latest_proposal_id: nativeId.toString(), total_proposals: entries.length,
        offset, limit, entries: page, has_more: offset + page.length < entries.length,
        indexing: {irreversible_block: lib, complete_proposal_sequence: true, vote_counts: 'indexed_irreversible_actions',
            historical_deadlines_and_electorates: 'not_inferred', source: 'native_actions_and_canonical_block_receipts'}};
}
