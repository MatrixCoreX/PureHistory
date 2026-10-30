import {FastifyInstance} from 'fastify';
import {addApiRoute, getRouteName} from '../../../helpers/functions.js';

export default function (fastify: FastifyInstance, opts: any, next: () => void) {
    addApiRoute(fastify, 'GET', getRouteName(import.meta.filename), instance => async (_request, reply) => {
        const profile = await instance.manager.getSystemProfile();
        reply.send({...profile, ...(profile.vote_schema === 'integer-v2' ? {
            single_choice: true, proxy_voting: false, time_weighted: false,
            integer_encoding: 'decimal-string', unit: 'smallest core-token unit'
        } : {integer_encoding: 'legacy-compatible'})});
    }, {tags: ['system'], summary: 'Detected system-contract voting schema'});
    next();
}
