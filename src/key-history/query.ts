import {decodeCursor, encodeCursor, fail, queryIdentity, schemaVersion, uint} from './model.js';

export const historyIndex = (chain: string) => {
    if (!/^[a-z0-9_-]{1,40}$/.test(chain)) fail('Invalid history chain', 503);
    return chain + '-key-history-v1';
};
export async function queryKeyHistory(elastic: any, chain: string, info: any, query: any) {
    const input = queryIdentity(query, info.chain_id), index = historyIndex(chain);
    let status: any;
    try { status = (await elastic.get({index, id: '_status'}))._source; }
    catch { return fail('Public-key history index is not available', 503); }
    if (!status || status.schema_version !== schemaVersion || status.chain_id !== info.chain_id || !status.ready) fail('Public-key history is initializing', 503);
    const current = uint(status.sequence), cursor = query.cursor ? decodeCursor(query.cursor, input.binding, status.generation, current) : undefined;
    const upper = cursor?.upper || current;
    const filters: any[] = [{term: {doc_type: 'event'}}, {term: {chain_id: info.chain_id}}, {term: {wallet_hash: input.key.hash}},
        {range: {sort_key: {lte: upper.padStart(20, '0') + ':9999999999:' + 'f'.repeat(64)}}}];
    const baseFilters = [...filters];
    if (input.asset) filters.push({term: {affected_assets: input.asset}});
    if (input.kind !== 'all') filters.push({terms: {kind: input.kind === 'withdraw' ? ['withdraw', 'selfout'] : input.kind === 'cancel' ? ['cancel', 'selfcancel'] : [input.kind]}});
    if (input.direction !== 'all') filters.push({terms: {direction: input.direction === 'in' ? ['in'] : ['out', 'self', 'fee']}});
    if (input.after || input.before) filters.push({range: {timestamp: {...(input.after ? {gte: input.after} : {}), ...(input.before ? {lte: input.before} : {})}}});
    if (cursor) filters.push({range: {sort_key: {lt: cursor.last}}});
    const result = await elastic.search({index, size: 21, track_total_hits: false, timeout: '3s',
        query: {bool: {filter: filters}}, sort: [{sort_key: 'desc'}]});
    if (result.timed_out || result._shards?.failed) fail('Public-key history query is incomplete', 503);
    const hits = result.hits.hits, rows = hits.slice(0, 20).map((x: any) => x._source);
    if (rows.some((x: any) => x.wallet_hash !== input.key.hash || x.chain_id !== info.chain_id)) fail('Invalid history index identity', 503);
    const options = await elastic.search({index, size: 0, timeout: '3s', query: {bool: {filter: baseFilters}},
        aggs: {assets: {terms: {field: 'affected_assets', size: 100}}}});
    if (options.timed_out || options._shards?.failed) fail('Public-key asset query is incomplete', 503);
    return {
        schema_version: schemaVersion, chain_id: info.chain_id, public_key: input.key.key, key_hash: input.key.hash,
        entries: rows, assets: options.aggregations.assets.buckets.map((x: any) => x.key),
        next_cursor: hits.length > 20 ? encodeCursor(input.binding, status.generation, upper, rows[rows.length - 1].sort_key) : undefined,
        indexing: {
            scanned_irreversible_block: status.scanned_irreversible_block, last_success_utc: status.last_success_utc,
            irreversible_block: info.last_irreversible_block_num, coverage: 'indexed_receipts',
            stale: !status.last_success_utc || Date.now() - Date.parse(status.last_success_utc) > 120000,
            paused: Boolean(status.paused), complete_lifetime_history: false
        }
    };
}
