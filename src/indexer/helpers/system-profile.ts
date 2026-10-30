import {createHash} from 'node:crypto';

export type VoteSchema = 'integer-v2' | 'legacy-eosio';
export interface SystemProfile {
    product: 'PureHistory';
    vote_schema: VoteSchema;
    system_contract: string;
    tables: {global: string; producers: string; voters: string};
    core_symbol?: string;
    vote_precision?: number;
    abi_hash?: string;
}

/** Preserve integer ABI values instead of silently rounding unsafe JSON numbers. */
export function exactInteger(value: unknown, field: string): string {
    if (typeof value === 'number' && !Number.isSafeInteger(value)) {
        throw new Error(`${field} must be supplied as an exact integer string`);
    }
    const text = String(value);
    if (!/^-?\d+$/.test(text)) throw new Error(`${field} is not an integer`);
    const number = BigInt(text);
    if (number < -(1n << 63n) || number >= (1n << 63n)) throw new Error(`${field} exceeds int64`);
    return number.toString();
}

export function detectSystemProfile(abi: any, systemContract = 'eosio'): SystemProfile {
    if (!abi || !Array.isArray(abi.tables) || !Array.isArray(abi.structs)) {
        throw new Error('System contract ABI has no table/struct definitions');
    }
    const tables = new Map<string, string>(abi.tables.map((t: any) => [String(t.name), String(t.type)]));
    const structs = new Map<string, any>(abi.structs.map((s: any) => [String(s.name), s]));
    const aliases = new Map<string, string>((abi.types || []).map((t: any) => [String(t.new_type_name), String(t.type)]));
    function underlying(type: string, seen = new Set<string>()): string {
        if (seen.has(type)) throw new Error('Cyclic system ABI type alias');
        seen.add(type);
        return aliases.has(type) ? underlying(aliases.get(type)!, seen) : type;
    }
    function fields(type: string, visited = new Set<string>()): any[] {
        type = underlying(type);
        if (visited.has(type)) throw new Error('Cyclic system ABI inheritance');
        visited.add(type);
        const entry = structs.get(type);
        if (!entry) return [];
        return [...(entry.base ? fields(entry.base, visited) : []), ...(entry.fields || [])];
    }
    const v2 = tables.get('votersv2');
    const exactVotes = v2 && fields(v2).some((f: any) => f.name === 'last_vote_amount' && underlying(f.type) === 'int64');
    if (exactVotes && tables.has('globalv2') && tables.has('producersv2')) {
        return {product: 'PureHistory', vote_schema: 'integer-v2', system_contract: systemContract,
            tables: {global: 'globalv2', producers: 'producersv2', voters: 'votersv2'}};
    }
    const legacy = tables.get('voters');
    if (legacy && fields(legacy).some((f: any) => f.name === 'last_vote_weight' && ['float64', 'double'].includes(underlying(f.type)))) {
        return {product: 'PureHistory', vote_schema: 'legacy-eosio', system_contract: systemContract,
            tables: {global: 'global', producers: 'producers', voters: 'voters'}};
    }
    throw new Error('Unrecognized system voting ABI; refusing to guess a voting model');
}

export async function resolveSystemProfile(
    rpc: (method: string, body: any) => Promise<any>, systemContract = 'eosio'
): Promise<SystemProfile> {
    const response = await rpc('get_abi', {account_name: systemContract});
    const profile = detectSystemProfile(response.abi, systemContract);
    profile.abi_hash = createHash('sha256').update(JSON.stringify(response.abi)).digest('hex');
    try {
        const market = await rpc('get_table_rows', {code: systemContract, scope: systemContract, table: 'rammarket', json: true, limit: 1});
        const asset = market.rows?.[0]?.quote?.balance;
        const match = typeof asset === 'string' && /^-?\d+(?:\.(\d+))? ([A-Z]{1,7})$/.exec(asset);
        if (match) {profile.vote_precision = (match[1] || '').length; profile.core_symbol = match[2];}
    } catch {
        // An uninitialized legacy RAM market does not invalidate its voting ABI.
    }
    return profile;
}

export function normalizeVoter(row: any, schema: VoteSchema): any {
    const voter = String(row.owner);
    if (!voter || voter === 'undefined') throw new Error('Voter row has no owner');
    const producers = (row.producers || []).map(String);
    if (schema === 'integer-v2') {
        if (producers.length > 1 || (row.proxy && String(row.proxy) !== '') || row.is_proxy === true || row.is_proxy === 1) {
            throw new Error('Invalid PureEOS single-choice/no-proxy voter state');
        }
        return {owner: voter, vote_schema: schema, is_proxy: false, producers,
            last_vote_amount: exactInteger(row.last_vote_amount, 'last_vote_amount'),
            staked_units: exactInteger(row.staked, 'staked'), proxy: ''};
    }
    const weight = Number(row.last_vote_weight), staked = Number(row.staked), proxied = Number(row.proxied_vote_weight);
    if (![weight, staked, proxied].every(Number.isFinite)) throw new Error('Invalid legacy EOS voter values');
    return {owner: voter, vote_schema: schema, is_proxy: row.is_proxy === true || row.is_proxy === 1,
        last_vote_weight: weight, staked, proxied_vote_weight: proxied, proxy: String(row.proxy || ''), producers};
}

export function publicVoter(row: any, schema: VoteSchema, includeProducers: boolean): any {
    const result: any = {account: row.voter, is_proxy: row.is_proxy,
        last_vote_block: row.block_num, producers: includeProducers ? (row.producers || []) : undefined};
    if (schema === 'integer-v2') {
        result.weight = exactInteger(row.last_vote_amount, 'last_vote_amount');
        result.last_vote_amount = result.weight;
        result.staked = exactInteger(row.staked_units ?? row.staked, 'staked');
        result.vote_schema = schema;
    } else {
        result.weight = row.last_vote_weight;
        result.staked = row.staked;
    }
    return result;
}
