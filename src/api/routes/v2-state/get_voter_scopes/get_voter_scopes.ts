import {FastifyInstance, FastifyReply, FastifyRequest} from "fastify";
import {timedQuery} from "../../../helpers/functions.js";

async function getVoterScopes(fastify: FastifyInstance, request: FastifyRequest) {

    const query = request.query as any;

    const response: any = {
        scopes: []
    };

    if (fastify.manager.conn.mongodb && fastify.manager.conn.mongodb.enabled !== false) {
        if (fastify.manager.config.features?.tables?.voters === false) {
            throw new Error('Voter indexing is disabled');
        }
        const profile = await fastify.manager.getSystemProfile();
        const filter: any = {present: {$ne: 0}, voter: {$regex: query.term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}};
        if (profile.vote_schema === 'integer-v2') filter.vote_schema = 'integer-v2';
        else filter.$or = [{vote_schema: 'legacy-eosio'}, {vote_schema: {$exists: false}}];
        const name = `${fastify.manager.conn.mongodb.database_prefix}_${fastify.manager.chain}`;
        const rows = await fastify.mongo.client.db(name).collection('voters')
            .find(filter, {projection: {_id: 0, voter: 1}}).limit(100).toArray();
        response.scopes = rows.map(row => row.voter);
        return response;
    }

    const result = await fastify.elastic.search<{voter: string}>({
        index: fastify.manager.chain + "-table-voters-*",
        query: {
            wildcard: {
                voter: {
                    value: `*${query.term}*`
                }
            }
        },
        _source: {
            includes: "voter"
        }
    });

    if ( result && result.hits.hits && result.hits.hits.length > 0) {
        result.hits.hits.forEach(v => {
            if (v._source) {
                response.scopes.push(v._source.voter);
            }
        });
    }

    return response;
}

export function getVoterScopesHandler(fastify: FastifyInstance, route: string) {
    return async (request: FastifyRequest, reply: FastifyReply) => {
        reply.send(await timedQuery(getVoterScopes, fastify, request, route));
    }
}
