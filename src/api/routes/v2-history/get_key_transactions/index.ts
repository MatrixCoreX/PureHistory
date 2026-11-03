import {FastifyInstance} from 'fastify';
import {addApiRoute, getRouteName} from '../../../helpers/functions.js';
import {queryKeyHistory} from '../../../../key-history/query.js';

export default function (fastify: FastifyInstance, opts: any, next: () => void) {
    const schema = {
        description: 'Read-only, per-public-key wallet receipts with exact asset amounts and fee attribution. Indexed records only.',
        tags: ['history'],
        querystring: {type: 'object', required: ['public_key'], additionalProperties: false, properties: {
            public_key: {type: 'string', minLength: 50, maxLength: 120},
            asset: {type: 'string', maxLength: 40},
            kind: {type: 'string', enum: ['all', 'deposit', 'ksend', 'withdraw', 'cancel']},
            direction: {type: 'string', enum: ['all', 'in', 'out']},
            after: {type: 'string', maxLength: 32}, before: {type: 'string', maxLength: 32},
            cursor: {type: 'string', maxLength: 2048}
        }}
    };
    addApiRoute(fastify, 'GET', getRouteName(import.meta.filename), (server: FastifyInstance) => async (request: any, reply: any) => {
        const info = await server.antelope.chain.get_info();
        reply.header('Cache-Control', 'no-store');
        const result = await queryKeyHistory(server.elastic, server.manager.chain, {
            chain_id: String(info.chain_id), last_irreversible_block_num: Number(String(info.last_irreversible_block_num))
        }, request.query);
        reply.send(result);
    }, schema);
    next();
}
