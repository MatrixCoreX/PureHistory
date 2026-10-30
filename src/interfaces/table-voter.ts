import {Document as MongoDoc} from "mongodb";

export interface IVoter extends MongoDoc {
    block_num: number,
    is_proxy: boolean,
    last_vote_weight?: string | number,
    last_vote_amount?: string,
    staked_units?: string,
    vote_schema?: 'integer-v2' | 'legacy-eosio',
    primary_key: string,
    producers: string[],
    proxied_vote_weight?: string | number,
    proxy: string,
    staked: number | string,
    voter: string,
}
