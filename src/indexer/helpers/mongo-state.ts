/** Idempotent state updates: delayed deliveries cannot overwrite a newer block.
 * Keep deletion tombstones so an older update cannot resurrect a removed row.
 * This is delivery ordering protection, not a replacement for fork reconciliation.
 */
export function stateUpdate(filter: Record<string, any>, data: Record<string, any>) {
    const document = Object.fromEntries(Object.entries(data).filter(([, value]) => value !== undefined));
    return {updateOne: {filter, upsert: true, update: [{$replaceWith: {$cond: [
        {$gte: [{$literal: document.block_num}, {$ifNull: ['$block_num', -1]}]},
        {$mergeObjects: ['$$ROOT', {$literal: document}]}, '$$ROOT'
    ]}}]}};
}
