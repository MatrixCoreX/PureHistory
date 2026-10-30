import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync, mkdtempSync, mkdirSync, writeFileSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import Fastify from 'fastify';
import {detectSystemProfile, resolveSystemProfile, exactInteger, normalizeVoter} from '../../build/indexer/helpers/system-profile.js';
import scopesRoute from '../../build/api/routes/v2-state/get_voter_scopes/index.js';
import votersRoute from '../../build/api/routes/v2-state/get_voters/index.js';
import systemRoute from '../../build/api/routes/v2-state/get_system_profile/index.js';
import {MongoRoutes} from '../../build/indexer/helpers/mongo-routes.js';
import {ElasticRoutes} from '../../build/indexer/helpers/elastic-routes.js';

const legacy = JSON.parse(readFileSync(new URL('./fixtures/eosio-system-v1.8.3.abi.json', import.meta.url)));
const pure = {version: 'eosio::abi/1.2', types: [], tables: [
    {name: 'votersv2', type: 'voter'}, {name: 'globalv2', type: 'global'}, {name: 'producersv2', type: 'producer'}
], structs: [{name: 'voter', base: '', fields: [{name: 'last_vote_amount', type: 'int64'}]}]};
const pureRow = {owner: 'alice', proxy: '', is_proxy: false, producers: ['nodea'], last_vote_amount: '9007199254740993', staked: '9007199254740993'};
const legacyRow = {owner: 'bob', proxy: 'proxyacct', is_proxy: 0, producers: [], last_vote_weight: '1234.56789', staked: 100000, proxied_vote_weight: '800.5'};

test('actual EOS v1.8.3 ABI and PureEOS v2 ABI select distinct tables', () => {
    assert.equal(detectSystemProfile(legacy).vote_schema, 'legacy-eosio');
    assert.equal(detectSystemProfile(pure).tables.voters, 'votersv2');
    const liveAbi = JSON.parse(readFileSync(new URL('./fixtures/pureeos-system-20261031.abi.json', import.meta.url)));
    assert.equal(detectSystemProfile(liveAbi).tables.voters, 'votersv2');
    assert.throws(() => detectSystemProfile({tables: [], structs: []}), /refusing to guess/);
});
test('ABI alias and inheritance supported; cycles rejected', () => {
    const fixture = structuredClone(pure);
    fixture.types.push({new_type_name: 'units', type: 'int64'});
    fixture.structs[0].fields[0].type = 'units';
    fixture.structs.push({name: 'derived', base: 'voter', fields: []});
    fixture.tables[0].type = 'derived';
    assert.equal(detectSystemProfile(fixture).vote_schema, 'integer-v2');
    fixture.structs[0].base = 'derived';
    assert.throws(() => detectSystemProfile(fixture), /Cyclic/);
});
test('int64 decimal encoding is exact and unsafe inputs fail closed', () => {
    assert.equal(exactInteger('9223372036854775807', 'vote'), '9223372036854775807');
    assert.equal(exactInteger('-9223372036854775808', 'vote'), '-9223372036854775808');
    for (const invalid of [9007199254740993, '9223372036854775808', '1.25', undefined]) {
        assert.throws(() => exactInteger(invalid, 'vote'));
    }
});
test('owner differs from payer; PureEOS keeps single-choice and rejects proxy/multiple choices', () => {
    const row = normalizeVoter({...pureRow, payer: 'different'}, 'integer-v2');
    assert.equal(row.owner, 'alice');
    assert.equal(row.last_vote_amount, pureRow.last_vote_amount);
    assert.throws(() => normalizeVoter({...pureRow, producers: ['nodea', 'nodeb']}, 'integer-v2'));
    assert.throws(() => normalizeVoter({...pureRow, proxy: 'proxyacct'}, 'integer-v2'));
});
test('legacy proxy and weighted values are retained without recomputation', () => {
    const row = normalizeVoter(legacyRow, 'legacy-eosio');
    assert.equal(row.proxy, 'proxyacct');
    assert.equal(row.last_vote_weight, 1234.56789);
    assert.equal(row.proxied_vote_weight, 800.5);
});
test('RPC profile derives core symbol/precision without float conversion', async () => {
    const profile = await resolveSystemProfile(async method => method === 'get_abi' ? {abi: pure} : {rows: [{quote: {balance: '100000000.0000 AIC'}}]});
    assert.equal(profile.core_symbol, 'AIC'); assert.equal(profile.vote_precision, 4);
    assert.match(profile.abi_hash, /^[a-f0-9]{64}$/);
});

for (const [schema, raw, abi] of [['integer-v2', pureRow, pure], ['legacy-eosio', legacyRow, legacy]]) {
    test(`real Fastify get_voters serialization: ${schema}`, async () => {
        const app = Fastify();
        const normalized = normalizeVoter(raw, schema);
        const document = {...normalized, voter: raw.owner, block_num: 42, staked: normalized.staked_units ?? normalized.staked};
        let query;
        app.decorate('manager', {chain: 'test', conn: {mongodb: {enabled: true, database_prefix: 'test'}},
            config: {features: {tables: {voters: true}}, api: {enable_caching: false, limits: {get_voters: 100}}},
            getSystemProfile: async () => ({...detectSystemProfile(abi), core_symbol: schema === 'integer-v2' ? 'AIC' : 'EOS', vote_precision: 4})});
        app.decorate('redis', {get: async () => null});
        const cursor = {skip() {return this;}, limit() {return this;}, toArray: async () => [document]};
        app.decorate('mongo', {client: {db: () => ({collection: () => ({countDocuments: async () => 1, find: q => {query = q; return cursor;}})})}});
        app.register(votersRoute); app.register(systemRoute); app.register(scopesRoute);
        const response = await app.inject('/get_voters?listProducers=true');
        assert.equal(response.statusCode, 200, response.body);
        const result = response.json();
        assert.equal(result.voters[0].account, raw.owner);
        assert.equal(result.vote_schema, schema);
        assert.deepEqual(query.present, {$ne: 0});
        if (schema === 'integer-v2') {
            assert.equal(result.voters[0].weight, '9007199254740993');
            assert.equal(result.voters[0].staked, '9007199254740993');
            assert.equal(result.proxy_voting, false); assert.equal(result.time_weighted, false);
        } else {
            assert.equal(result.voters[0].weight, 1234.56789);
            assert.equal(result.voters[0].staked, 100000);
        }
        assert.equal((await app.inject('/get_system_profile')).json().vote_schema, schema);
        const scopes = await app.inject(`/get_voter_scopes?term=${raw.owner.slice(0, 3)}`);
        assert.equal(scopes.statusCode, 200, scopes.body);
        assert.deepEqual(scopes.json().scopes, [raw.owner]);
        await app.close();
    });
}

const message = (body, tag, headers = {}) => ({content: Buffer.from(JSON.stringify(body)), fields: {deliveryTag: tag}, properties: {headers}});
for (const route of ['table-accounts', 'table-voters', 'table-proposals', 'state', 'dynamic-table']) {
    test(`Mongo write rejection is propagated: ${route}`, async () => {
        const routes = Object.create(MongoRoutes.prototype); routes.routes = {};
        const failing = {bulkWrite: async () => {throw new Error('injected database failure');}};
        routes.accountsCollection = routes.votersCollection = routes.proposalsCollection = routes.permissionsCollection = failing;
        routes.db = {collection: () => failing}; routes.addRoutes(); routes.addDynamicRoutes();
        const payload = [message({voter: 'alice', owner: 'alice', code: 'eosio.token', scope: 'alice', symbol: 'AIC', block_num: 1, present: 1}, 1, {type: 'permission', code: 'test', table: 'test', present: 1})];
        const result = await new Promise(resolve => routes.routes[route](payload, (size, error) => resolve({size, error})));
        assert.equal(result.size, 0); assert.match(result.error.message, /injected/);
    });
}
for (const outcome of ['success', 'failure', 'partial-duplicate-id']) {
    test(`ES acknowledgments cover only the submitted batch: ${outcome}`, async () => {
        const routes = Object.create(ElasticRoutes.prototype);
        routes.chain = 'test'; routes.routes = {}; routes.retryOnConflict = 3;
        routes.cm = {config: {settings: {index_version: 'v1'}}};
        routes.bulkAction = async () => {
            if (outcome === 'failure') throw new Error('injected ES failure');
            return outcome === 'success' ? {errors: false} : {errors: true, items: [
                {update: {_id: 'alice', status: 200}}, {update: {_id: 'alice', status: 409}}
            ]};
        };
        routes.registerRoutes();
        const ack = [], nack = [];
        const channel = {ack: m => ack.push(m.fields.deliveryTag), nack: m => nack.push(m.fields.deliveryTag)};
        const payload = [message({voter: 'alice', block_num: 2}, 10), message({voter: 'alice', block_num: 3}, 11)];
        await new Promise(resolve => routes.routes['table-voters'](payload, channel, resolve));
        assert.deepEqual(ack, outcome === 'success' ? [10, 11] : outcome === 'failure' ? [] : [10]);
        assert.deepEqual(nack, outcome === 'failure' ? [10, 11] : outcome === 'success' ? [] : [11]);
        assert.ok(!ack.includes(12) && !nack.includes(12), 'unsubmitted buffered delivery must not be acknowledged');
    });
}

for (const [table, raw, schema] of [['votersv2', pureRow, 'integer-v2'], ['voters', legacyRow, 'legacy-eosio']]) {
    test(`deserializer through queue keeps row owner, deletion and exact fields: ${table}`, async () => {
        const previousDir = process.cwd(), previousConfig = process.env.CONFIG_JSON;
        const temporary = mkdtempSync(join(tmpdir(), 'purehistory-compat-'));
        mkdirSync(join(temporary, 'config'));
        writeFileSync(join(temporary, 'config.json'), JSON.stringify({settings: {chain: 'test'}, indexer: {abi_scan_mode: false}}));
        writeFileSync(join(temporary, 'config/connections.json'), '{}');
        process.chdir(temporary); process.env.CONFIG_JSON = 'config.json';
        let MainDSWorker;
        try {MainDSWorker = (await import('../../build/indexer/workers/deserializer.js')).default;}
        finally {
            process.chdir(previousDir);
            if (previousConfig === undefined) delete process.env.CONFIG_JSON;
            else process.env.CONFIG_JSON = previousConfig;
            rmSync(temporary, {recursive: true, force: true});
        }
        const worker = Object.create(MainDSWorker.prototype);
        worker.conf = {settings: {}, features: {tables: {voters: true}}, indexer: {disable_indexing: false}, scaling: {indexing_queues: 2}};
        worker.tableHandlers = {}; worker.chain = 'test'; worker.tbl_vote_emit_idx = 1;
        const messages = [];
        worker.preIndexingQueue = {push: async message => messages.push(JSON.parse(message.content.toString()))};
        await worker.populateTableHandlers();
        const delta = {data: structuredClone(raw), payer: 'different', present: 0, primary_key: '123', block_num: 500};
        await worker.tableHandlers[`eosio:${table}`](delta);
        assert.equal(messages.length, 1);
        assert.equal(messages[0].voter, raw.owner);
        assert.equal(messages[0].present, 0);
        assert.equal(messages[0].vote_schema, schema);
        if (schema === 'integer-v2') {
            assert.equal(messages[0].last_vote_amount, '9007199254740993');
            assert.equal(messages[0].last_vote_weight, undefined);
        } else assert.equal(messages[0].last_vote_weight, 1234.56789);
    });
}
