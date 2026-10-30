import test from 'node:test';
import assert from 'node:assert/strict';
import {MongoClient} from 'mongodb';
import {readFileSync} from 'node:fs';
import {stateUpdate} from '../../build/indexer/helpers/mongo-state.js';
import {MongoRoutes} from '../../build/indexer/helpers/mongo-routes.js';

const connection = JSON.parse(readFileSync('config/connections.json')).mongodb;
const client = new MongoClient(`mongodb://${encodeURIComponent(connection.user)}:${encodeURIComponent(connection.pass)}@${connection.host}:${connection.port}`);
const database = client.db(`${connection.database_prefix}_aic`);
const collection = database.collection(`purehistory_qualification_${process.pid}`);

test('real MongoDB state: reorder, replay, tombstone, retry, exact vote, owner identity', async () => {
    try {
        await client.connect();
        await collection.createIndex({voter: 1}, {unique: true});
        const routes = Object.create(MongoRoutes.prototype); routes.routes = {};
        routes.votersCollection = collection; routes.addRoutes();
        const write = data => new Promise((resolve, reject) => routes.routes['table-voters']([
            {content: Buffer.from(JSON.stringify(data))}
        ], (_size, error) => error ? reject(error) : resolve()));
        await write({voter: 'alice', block_num: 200, present: 1, last_vote_amount: '9007199254740993', staked_units: '9007199254740993'});
        await write({voter: 'alice', block_num: 150, present: 1, last_vote_amount: '1'});
        assert.equal((await collection.findOne({voter: 'alice'})).last_vote_amount, '9007199254740993');
        await write({voter: 'alice', block_num: 210, present: 0});
        await write({voter: 'alice', block_num: 205, present: 1, last_vote_amount: '2'});
        assert.equal(await collection.countDocuments({present: {$ne: 0}}), 0);
        await write({voter: 'alice', block_num: 220, present: 1, last_vote_amount: '3'});
        await write({voter: 'alice', block_num: 220, present: 1, last_vote_amount: '3'});
        assert.equal(await collection.countDocuments({voter: 'alice'}), 1);
        assert.equal((await collection.findOne({voter: 'alice'})).last_vote_amount, '3');
        await Promise.all(Array.from({length: 50}, (_, index) => write({voter: 'alice', block_num: 300 + index, present: 1, last_vote_amount: String(index)})));
        assert.equal((await collection.findOne({voter: 'alice'})).block_num, 349);
        // Non-voter state uses the same monotonic update; verify identity and literal asset fields.
        await collection.bulkWrite([stateUpdate({voter: 'literal'}, {voter: 'literal', block_num: 1, memo: '$not_a_field', present: 1})]);
        assert.equal((await collection.findOne({voter: 'literal'})).memo, '$not_a_field');
    } finally {
        await collection.drop().catch(() => {});
        await client.close();
    }
});
