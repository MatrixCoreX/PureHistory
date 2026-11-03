import {createHash} from 'node:crypto';
import {Checksum256, PublicKey, Serializer} from '@wharfkit/antelope';

export const schemaVersion = 1;
const zero = '0'.repeat(64);
export function fail(message: string, statusCode = 400): never {
    throw Object.assign(new Error(message), {statusCode});
}
export function uint(value: unknown): string {
    if (typeof value === 'number' && !Number.isSafeInteger(value)) fail('Unsafe indexed integer', 503);
    if (!/^(0|[1-9]\d*)$/.test(String(value)) || BigInt(String(value)) > (1n << 64n) - 1n) fail('Invalid indexed integer', 503);
    return String(value);
}
export function hash(value: unknown): string {
    if (typeof value !== 'string' || !/^[0-9a-f]{64}$/i.test(value)) fail('Invalid key history hash', 503);
    return value.toLowerCase();
}
export function identity(value: string) {
    try {
        if (typeof value !== 'string' || value.length > 120 || !/^(EOS|PUB_K1_)/.test(value)) throw Error();
        const key = PublicKey.from(value);
        if (String(key.type) !== 'K1') throw Error();
        return {key: key.toString(), hash: Checksum256.hash(Serializer.encode({type: 'public_key', object: key}).array).toString().toLowerCase()};
    } catch { return fail('Invalid K1 public key'); }
}
export function asset(value: unknown) {
    if (typeof value !== 'string') fail('Invalid indexed asset', 503);
    const match = /^(\d+)(?:\.(\d{1,18}))? ([A-Z]{1,7})$/.exec(value);
    if (!match) fail('Invalid indexed asset', 503);
    const atomic = BigInt(match[1] + (match[2] || ''));
    if (atomic > (1n << 62n) - 1n) fail('Indexed asset exceeds wallet bound', 503);
    return {atomic: atomic.toString(), precision: (match[2] || '').length, symbol: match[3]};
}
export function token(contract: string, precision: number, symbol: string) {
    if (!/^[a-z1-5.]{1,13}$/.test(contract) || !Number.isInteger(precision) || precision < 0 || precision > 18 || !/^[A-Z]{1,7}$/.test(symbol)) fail('Invalid asset identity');
    return {contract, precision, symbol, id: contract + ':' + precision + ',' + symbol};
}
export function tokenId(value: string) {
    const m = /^([a-z1-5.]{1,13}):(\d{1,2}),([A-Z]{1,7})$/.exec(value);
    if (!m) fail('Invalid asset filter');
    return token(m[1], Number(m[2]), m[3]);
}
export function sortKey(sequence: unknown, ordinal: unknown, trx: string) {
    const o = uint(ordinal);
    if (BigInt(o) > 4294967295n) fail('Invalid action ordinal', 503);
    return uint(sequence).padStart(20, '0') + ':' + o.padStart(10, '0') + ':' + hash(trx);
}
export type Party = {type: 'key' | 'account' | 'none'; value: string; hash?: string};
export type View = {
    doc_type: string; schema_version: number; chain_id: string; deployment: string;
    id: string; wallet_hash: string; wallet_public_key: string; sort_key: string; sequence: string;
    block_num: number; block_id: string; transaction_id: string; action_ordinal: string; timestamp: string;
    kind: string; direction: string; from: Party; to: Party; counterparty: Party;
    asset: ReturnType<typeof token>; quantity_atomic: string; principal_delta_atomic: string;
    fee_asset: ReturnType<typeof token>; fee_total_atomic: string; fee_charged_atomic: string;
    fee_paid_by: Party; affected_assets: string[]; memo: string; relayer: string;
};
export function project(action: any, context: {
    chainId: string; deployment: string; feeContract: string; feeSymbol: string;
    publicKeys: Map<string, string>; transactionActions: any[];
}): View[] {
    if (action.act?.account !== 'eosio.key' || action.act?.name !== 'receipt') fail('Expected wallet receipt', 503);
    const d = action.act.data;
    const fromHash = hash(d.from_key), toHash = hash(d.to_key);
    if (fromHash === zero && toHash === zero) return []; // Native credit/income are native-account operations.
    if (!['deposit', 'ksend', 'withdraw', 'selfout', 'cancel', 'selfcancel'].includes(d.kind)) fail('Unsupported wallet receipt kind', 503);
    const trx = hash(action.trx_id);
    if (hash(d.transaction_id) !== trx) fail('Receipt transaction mismatch', 503);
    const q = asset(d.quantity), fee = asset(d.fee), principalToken = token(d.token_contract, q.precision, q.symbol);
    if (context.feeSymbol !== fee.precision + ',' + fee.symbol) fail('Fee asset profile mismatch', 503);
    const feeToken = token(context.feeContract, fee.precision, fee.symbol);
    const keyParty = (h: string): Party => {
        const value = context.publicKeys.get(h);
        if (!value || identity(value).hash !== h) fail('Unresolved wallet public key', 503);
        return {type: 'key', value: identity(value).key, hash: h};
    };
    const none: Party = {type: 'none', value: ''};
    let from = fromHash === zero ? none : keyParty(fromHash), to = toHash === zero ? none : keyParty(toHash);
    let memo = '';
    const roots = context.transactionActions.filter(a => a.act?.account === 'eosio.key' && a.act?.name === d.kind);
    if (d.kind === 'deposit') {
        if (fromHash !== zero || toHash === zero || !/^[a-z1-5.]{1,13}$/.test(d.native_from)) fail('Invalid deposit receipt', 503);
        from = {type: 'account', value: d.native_from};
    } else {
        // Owner protocol v2 allows only one wallet operation per native transaction.
        if (roots.length !== 1) fail('Missing or ambiguous owner operation', 503);
        const request = roots[0].act.data?.request;
        if (!request || identity(request.from).hash !== fromHash || hash(request.request_id) !== hash(d.request_id)) fail('Owner operation does not match receipt', 503);
        if (d.kind === 'withdraw' || d.kind === 'selfout') {
            if (!/^[a-z1-5.]{1,13}$/.test(request.to) || toHash !== zero) fail('Invalid withdrawal recipient', 503);
            to = {type: 'account', value: request.to};
        } else if (d.kind === 'ksend' && identity(request.to).hash !== toHash) fail('Transfer recipient mismatch', 503);
        memo = typeof request.memo === 'string' ? request.memo : '';
        if (memo.length > 4096) fail('Oversized wallet memo', 503);
    }
    const payer = d.kind === 'deposit' ? from : fromHash === zero ? none : keyParty(fromHash);
    const wallets = [...new Set([fromHash, toHash].filter(h => h !== zero))];
    return wallets.map(wallet => {
        const outgoing = fromHash === wallet, incoming = toHash === wallet;
        const delta = (incoming ? BigInt(q.atomic) : 0n) - (outgoing ? BigInt(q.atomic) : 0n);
        const charged = payer.type === 'key' && payer.hash === wallet ? fee.atomic : '0';
        const affected = new Set<string>();
        if (BigInt(q.atomic) > 0n) affected.add(principalToken.id);
        if (BigInt(charged) > 0n) affected.add(feeToken.id);
        const ordinal = uint(action.action_ordinal), sequence = uint(action.global_sequence);
        const id = hash(context.chainId) + ':' + trx + ':' + ordinal + ':' + wallet;
        const rawTime = action['@timestamp'];
        if (typeof rawTime !== 'string' || !/^\d{4}-\d{2}-\d{2}T/.test(rawTime)) fail('Invalid receipt timestamp', 503);
        const timestamp = new Date(/[Zz]|[+-]\d\d:\d\d$/.test(rawTime) ? rawTime : rawTime + 'Z').toISOString();
        if (!Number.isSafeInteger(action.block_num) || action.block_num < 1) fail('Invalid receipt block', 503);
        return {
            doc_type: 'event', schema_version: schemaVersion, chain_id: hash(context.chainId), deployment: hash(context.deployment),
            id, wallet_hash: wallet, wallet_public_key: keyParty(wallet).value, sort_key: sortKey(sequence, ordinal, trx), sequence,
            block_num: action.block_num, block_id: hash(action.block_id), transaction_id: trx, action_ordinal: ordinal, timestamp,
            kind: d.kind, direction: outgoing && incoming ? 'self' : delta > 0n ? 'in' : delta < 0n ? 'out' : 'fee',
            from, to, counterparty: outgoing ? to : from, asset: principalToken, quantity_atomic: q.atomic,
            principal_delta_atomic: delta.toString(), fee_asset: feeToken, fee_total_atomic: fee.atomic,
            fee_charged_atomic: charged, fee_paid_by: payer, affected_assets: [...affected], memo, relayer: d.relayer || ''
        };
    });
}
export function queryIdentity(query: any, chainId: string) {
    const key = identity(query.public_key);
    const asset = query.asset ? tokenId(query.asset).id : '';
    const kind = query.kind || 'all', direction = query.direction || 'all';
    if (!['all', 'deposit', 'ksend', 'withdraw', 'cancel'].includes(kind) || !['all', 'in', 'out'].includes(direction)) fail('Invalid history filter');
    const date = (v: any) => {
        if (!v) return '';
        if (typeof v !== 'string' || v.length > 32 || !/^\d{4}-\d{2}-\d{2}T/.test(v) || !Number.isFinite(Date.parse(v))) fail('Invalid UTC date filter');
        return new Date(v).toISOString();
    };
    const after = date(query.after), before = date(query.before);
    if (after && before && after > before) fail('Invalid date range');
    const binding = createHash('sha256').update(JSON.stringify([hash(chainId), key.hash, asset, kind, direction, after, before])).digest('hex');
    return {key, asset, kind, direction, after, before, binding};
}
export function decodeCursor(value: string, binding: string, generation: string, maximum: string) {
    try {
        if (typeof value !== 'string' || value.length > 2048 || !/^[A-Za-z0-9_-]+$/.test(value)) throw Error();
        const c = JSON.parse(Buffer.from(value, 'base64url').toString());
        if (c.binding !== binding || c.generation !== generation || !/^\d{20}:\d{10}:[0-9a-f]{64}$/.test(c.last)) throw Error();
        const upper = uint(c.upper);
        if (BigInt(upper) > BigInt(maximum) || c.last.slice(0, 20) > upper.padStart(20, '0')) throw Error();
        return {upper, last: c.last};
    } catch { return fail('Invalid or expired key history cursor'); }
}
export function encodeCursor(binding: string, generation: string, upper: string, last: string) {
    return Buffer.from(JSON.stringify({binding, generation, upper, last})).toString('base64url');
}
