import assert from 'node:assert/strict';
import fs from 'node:fs';
const K='/opt/pureeos-upgrade-history-20261104-r1',base='https://aic-test.matrixai.one/history';
async function get(path,status=200){const r=await fetch(base+path,{signal:AbortSignal.timeout(40000)});assert.equal(r.status,status,path);return r.json();}
const page=await get('/v2/history/get_upgrade_proposals?offset=0&limit=20');
assert.equal(page.chain_id,'116ea0c3c556951ba0a9244cbfbfe13f98972f3353c38ff38c35122d0f61c5a0');assert.deepEqual(page.entries.map(e=>[e.proposal_id,e.status,e.vetoes.length]),[['3','pending',24],['2','executed',0],['1','executed',0]]);
const old=await get('/v2/history/get_upgrade_proposals?offset=2&limit=1');assert.equal(old.entries[0].proposal_id,'1');assert.equal(old.entries[0].status,'executed');assert.equal(old.has_more,false);
await get('/v2/history/get_upgrade_proposals?limit=21',400);const normalized=await get('/v2/history/get_upgrade_proposals?unknown=1');assert.equal(normalized.total_proposals,3);
const actions=await get('/v2/history/get_actions?act.account=eosio&act.name=devpropose&limit=3&sort=desc');assert.equal(actions.actions.length,3);
fs.writeFileSync(K+'/PUBLIC_API_INTEGRATION.json',JSON.stringify({status:'PASS',page,older_pagination:old,invalid_limit_rejected:true,unknown_query_removed_by_shared_schema:true,existing_get_actions:true,read_only:true,UTC:new Date().toISOString()},null,2)+'\n');console.log('PUBLIC HISTORY API AND PAGINATION PASS');
