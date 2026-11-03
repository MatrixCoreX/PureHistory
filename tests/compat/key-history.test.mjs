import {test} from 'node:test';
import assert from 'node:assert/strict';
import {PublicKey} from '@wharfkit/antelope';
import {asset, identity, project, uint, queryIdentity, encodeCursor, decodeCursor} from '../../build/key-history/model.js';
import {queryKeyHistory} from '../../build/key-history/query.js';

const keyA = 'PUB_K1_7y1ttFMwRegZvahUzmJ7ykHKR2jmxfLkr3Xrx7uoJmXz2EhDEQ';
const keyB = 'PUB_K1_6W8FU4k6nypnX4cedeeoEkUaYAVzj2jJTszg8hgTS45EwPszzq';
const a = identity(keyA), b = identity(keyB), chain = 'ab'.repeat(32), trx = 'cd'.repeat(32), zero = '0'.repeat(64);
const requestId = 'ef'.repeat(32);
function fixture(kind = 'ksend', extra = {}) {
    const data = {kind, request_id: requestId, transaction_id: trx, native_from: '', from_key: a.hash, to_key: b.hash,
        token_contract: 'keyusdtoken1', quantity: '1.2500 USD', fee: '0.0284 AIC', relayer: 'gptgenesisbp', ...extra};
    const action = {act: {account: 'eosio.key', name: 'receipt', data}, trx_id: trx, action_ordinal: 3,
        global_sequence: '9007199254740993', block_num: 90, block_id: '12'.repeat(32), '@timestamp': '2026-11-03T08:00:00.000'};
    const context = {chainId: chain, deployment: '34'.repeat(32), feeContract: 'eosio.token', feeSymbol: '4,AIC',
        publicKeys: new Map([[a.hash, keyA], [b.hash, keyB]]), transactionActions: [{act: {account: 'eosio.key', name: kind,
            data: {request: {from: keyA, to: kind === 'ksend' ? keyB : 'keymapleseed', request_id: requestId, memo: 'fixture memo'}}}}]};
    return {action, context};
}
test('EOS and PUB_K1 aliases identify one wallet', () => {
    assert.deepEqual(identity(PublicKey.from(keyA).toLegacyString()), a);
    assert.throws(() => identity(keyA.slice(0, -1) + 'x'));
});
test('asset and sequence amounts remain exact above Number precision', () => {
    assert.equal(asset('900719925474.0993 AIC').atomic, '9007199254740993');
    assert.equal(uint('18446744073709551615'), '18446744073709551615');
    assert.throws(() => uint(9007199254740992));
    assert.throws(() => asset('-1.0000 AIC'));
});
test('USD transfer charges AIC only to sender, and asset filters remain per-wallet', () => {
    const {action, context} = fixture(); const [sender, receiver] = project(action, context);
    assert.equal(sender.principal_delta_atomic, '-12500'); assert.equal(sender.fee_charged_atomic, '284');
    assert.deepEqual(sender.affected_assets, ['keyusdtoken1:4,USD', 'eosio.token:4,AIC']);
    assert.equal(receiver.principal_delta_atomic, '12500'); assert.equal(receiver.fee_charged_atomic, '0');
    assert.deepEqual(receiver.affected_assets, ['keyusdtoken1:4,USD']);
    assert.equal(receiver.fee_paid_by.hash, a.hash);
});
test('native deposit attributes fee to native sender and never debits receiving key', () => {
    const {action, context} = fixture('deposit', {from_key: zero, to_key: b.hash, native_from: 'keyusdtoken1'});
    const [row] = project(action, context);
    assert.equal(row.fee_paid_by.type, 'account'); assert.equal(row.fee_paid_by.value, 'keyusdtoken1');
    assert.equal(row.fee_charged_atomic, '0'); assert.equal(row.direction, 'in');
});
test('same-key transfer emits one fee-paying view with zero principal', () => {
    const {action, context} = fixture('ksend', {to_key: a.hash}); context.transactionActions[0].act.data.request.to = keyA;
    const rows = project(action, context);
    assert.equal(rows.length, 1); assert.equal(rows[0].principal_delta_atomic, '0');
    assert.equal(rows[0].direction, 'self'); assert.equal(rows[0].fee_charged_atomic, '284');
});
test('withdrawal gets recipient from matching owner request; missing roots fail closed', () => {
    const {action, context} = fixture('selfout', {to_key: zero});
    assert.deepEqual(project(action, context)[0].to, {type: 'account', value: 'keymapleseed'});
    context.transactionActions = []; assert.throws(() => project(action, context), /ambiguous owner/);
});
test('cancel is a fee event; native credit and relay income are excluded', () => {
    const {action, context} = fixture('cancel', {to_key: zero, token_contract: 'eosio.token', quantity: '0.0000 AIC'});
    assert.equal(project(action, context)[0].direction, 'fee');
    action.act.data.from_key = zero; action.act.data.kind = 'claim'; assert.deepEqual(project(action, context), []);
});
test('distinct receipt ordinals in the same native transaction remain distinct', () => {
    const {action, context} = fixture(); const first = project(action, context);
    action.action_ordinal = 7; const second = project(action, context);
    assert.notEqual(first[0].id, second[0].id); assert.equal(project(action, context)[0].id, second[0].id);
});
test('cursors bind wallet, asset, date and generation, preserving an upper sequence', () => {
    const base = queryIdentity({public_key: keyA}, chain), last = '00009007199254740993:0000000003:' + trx;
    const c = encodeCursor(base.binding, 'generation1', '9007199254740993', last);
    assert.equal(decodeCursor(c, base.binding, 'generation1', '9007199254740994').upper, '9007199254740993');
    for (const filters of [{public_key: keyB}, {public_key: keyA, asset: 'eosio.token:4,AIC'}, {public_key: keyA, after: '2026-11-01T00:00:00Z'}])
        assert.throws(() => decodeCursor(c, queryIdentity(filters, chain).binding, 'generation1', '9007199254740994'));
    assert.throws(() => decodeCursor(c, base.binding, 'generation2', '9007199254740994'));
    assert.throws(() => decodeCursor(c, base.binding, 'generation1', '2'));
});
test('unavailable index returns 503 instead of an empty history', async () => {
    await assert.rejects(queryKeyHistory({get: async () => {throw Error('down');}}, 'aic', {chain_id: chain}, {public_key: keyA}), {statusCode: 503});
});
test('query uses key-specific affected assets and rejects incomplete ES searches', async () => {
    const calls = [], status = {schema_version: 1, chain_id: chain, ready: true, sequence: '100', generation: 'one', scanned_irreversible_block: 90, last_success_utc: new Date().toISOString()};
    const elastic = {get: async () => ({_source: status}), search: async q => {calls.push(q); return {hits: {hits: []}, aggregations: {assets: {buckets: []}}};}};
    const info = {chain_id: chain, last_irreversible_block_num: 100};
    const result = await queryKeyHistory(elastic, 'aic', info, {public_key: keyA, asset: 'eosio.token:4,AIC'});
    assert.equal(result.indexing.complete_lifetime_history, false);
    assert.ok(calls[0].query.bool.filter.some(x => x.term?.affected_assets === 'eosio.token:4,AIC'));
    assert.ok(calls[0].query.bool.filter.some(x => x.term?.wallet_hash === a.hash));
    elastic.search = async () => ({timed_out: true});
    await assert.rejects(queryKeyHistory(elastic, 'aic', info, {public_key: keyA}), {statusCode: 503});
});
test('21 hits become 20 rows with a pinned cursor and strict next-page boundary', async () => {
    const status = {schema_version: 1, chain_id: chain, ready: true, sequence: '100', generation: 'one', scanned_irreversible_block: 90};
    const {action, context} = fixture(); const original = project(action, context)[0];
    const hits = Array.from({length: 21}, (_, i) => ({_source: {...original, sort_key: String(100 - i).padStart(20, '0') + ':0000000003:' + trx}}));
    const calls = [];
    const elastic = {get: async () => ({_source: status}), search: async q => {calls.push(q);return q.size === 0 ? {aggregations: {assets: {buckets: []}}} : {hits: {hits}};}};
    const info = {chain_id: chain, last_irreversible_block_num: 100};
    const first = await queryKeyHistory(elastic, 'aic', info, {public_key: keyA});
    assert.equal(first.entries.length, 20); assert.ok(first.next_cursor);
    status.sequence = '200';
    await queryKeyHistory(elastic, 'aic', info, {public_key: keyA, cursor: first.next_cursor});
    const filters = calls[2].query.bool.filter;
    assert.ok(filters.some(x => x.range?.sort_key?.lt === first.entries[19].sort_key));
    assert.ok(filters.some(x => x.range?.sort_key?.lte?.startsWith('00000000000000000100:')));
});
