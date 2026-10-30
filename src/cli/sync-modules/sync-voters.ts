import {Name} from '@wharfkit/antelope';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {IVoter} from '../../interfaces/table-voter.js';
import {Synchronizer} from './synchronizer.js';
import {normalizeVoter, resolveSystemProfile, SystemProfile} from '../../indexer/helpers/system-profile.js';
import {stateUpdate} from '../../indexer/helpers/mongo-state.js';

export class VoterSynchronizer extends Synchronizer<IVoter> {
    constructor(chain: string) {super(chain, 'voters');}

    private async rpc(method: string, body: any) {
        const response = await fetch(`${this.connections.chains[this.chain].http}/v1/chain/${method}`, {
            method: 'POST', headers: {'Content-Type': 'application/json'},
            body: JSON.stringify(body), signal: AbortSignal.timeout(30000)
        });
        if (!response.ok) throw new Error(`Voter synchronization RPC ${method}: ${response.status}`);
        return response.json();
    }

    private async* scan(profile: SystemProfile) {
        let lowerBound: string | undefined;
        do {
            const result = await this.rpc('get_table_rows', {
                code: profile.system_contract, scope: profile.system_contract,
                table: profile.tables.voters, json: true, limit: 300, lower_bound: lowerBound
            });
            for (const row of result.rows) {
                const voter = normalizeVoter(row, profile.vote_schema);
                const {owner, ...fields} = voter;
                this.totalItems++;
                yield {voter: owner, ...fields, present: 1, block_num: this.currentBlock,
                    staked: voter.staked_units ?? voter.staked,
                    primary_key: Name.from(owner).value.toString()} as IVoter;
            }
            if (!result.more) break;
            const next = String(result.next_key);
            if (!next || next === 'undefined' || next === lowerBound) throw new Error('Voter pagination did not advance');
            lowerBound = next;
        } while (true);
    }

    public async run() {
        const configPath = process.env.CONFIG_JSON || join(import.meta.dirname, '../../../config/chains', `${this.chain}.config.json`);
        const config = JSON.parse(readFileSync(configPath, 'utf8'));
        const profile = await resolveSystemProfile(this.rpc.bind(this), config.settings.system_contract ?? config.settings.eosio_alias ?? 'eosio');
        this.currentBlock = (await this.rpc('get_info', {})).head_block_num;
        await this.setupMongo('voters', [
            {fields: {voter: 1}, options: {unique: true}},
            {fields: {producers: 1}}, {fields: {is_proxy: 1}}
        ]);
        try {
            if (this.collection) {
                let batch: any[] = [];
                for await (const doc of this.scan(profile)) {
                    batch.push(stateUpdate({voter: doc.voter}, doc));
                    if (batch.length >= 300) {
                        await this.collection.bulkWrite(batch, {ordered: false});
                        batch = [];
                    }
                }
                if (batch.length) await this.collection.bulkWrite(batch, {ordered: false});
            } else {
                const result = await this.elastic.helpers.bulk({
                    datasource: this.scan(profile),
                    onDocument: doc => [{index: {_id: doc.voter, _index: this.indexName}}, doc]
                });
                if (result.failed) throw new Error(`Failed to index ${result.failed} voters`);
            }
            console.log(`PureHistory synchronized ${this.totalItems} ${profile.vote_schema} voters.`);
        } finally {
            await this.mongoClient?.close();
        }
    }
}
