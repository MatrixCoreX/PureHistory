import {FastifyInstance} from 'fastify';
import {addApiRoute, getRouteName} from '../../../helpers/functions.js';
import {queryCreationHistory} from '../../../../creation-history/query.js';

export default function (fastify: FastifyInstance, opts: any, next: () => void) {
    let cached: {key: string; expires: number; value: any} | undefined;
    const schema = {description: 'Read-only native account-creation proposals, vetoes and terminal actions verified against irreversible block receipts. Historical electorate/deadline values are never inferred.', tags: ['history'],
        querystring: {type: 'object', additionalProperties: false, properties: {offset: {type: 'integer', minimum: 0, maximum: 1000}, limit: {type: 'integer', minimum: 1, maximum: 20}}}};
    addApiRoute(fastify, 'GET', getRouteName(import.meta.filename), (server: FastifyInstance) => async (request: any, reply: any) => {
        const key = JSON.stringify(request.query); reply.header('Cache-Control', 'no-store');
        if (cached?.key === key && cached.expires > Date.now()) return reply.send(cached.value);
        const rpc = async (method: string, body: any) => {
            if (!['get_info', 'get_system_account_state', 'get_block'].includes(method)) throw new Error('Read-only creation history RPC');
            const response = await fetch(`${server.manager.conn.chains[server.manager.chain].http}/v1/chain/${method}`, {
                method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(body), signal: AbortSignal.timeout(10000)});
            if (!response.ok) throw Object.assign(new Error('Native creation history RPC is unavailable'), {statusCode: 503});
            return JSON.parse(await response.text(), (_key, value, context?: any) => typeof value === 'number' && !Number.isSafeInteger(value) && /^\d+$/.test(context?.source || '') ? context.source : value);
        };
        try {
            const value = await queryCreationHistory(server.elastic, server.manager.chain, rpc, request.query);
            cached = {key, expires: Date.now() + 5000, value}; reply.send(value);
        } catch (error) { cached = undefined; throw error; }
    }, schema);
    next();
}
