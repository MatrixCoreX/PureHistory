import fs from 'node:fs';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {queryUpgradeHistory} from './backend/build/upgrade-history/query.js';
const K='/opt/pureeos-upgrade-history-20261104-r1',R='/opt/pureeos-keynet-20261103-r2';
const {Client}=createRequire(R+'/history-source/package.json')('@elastic/elasticsearch');
const conn=JSON.parse(fs.readFileSync(R+'/history-source/config/connections.json','utf8')),e=conn.elasticsearch;
const elastic=new Client({node:`${e.protocol}://${e.host}`,auth:{username:e.user,password:e.pass},tls:{rejectUnauthorized:false}});
const rpc=async(method,body)=>{assert(['get_info','get_upgrade_state','get_block'].includes(method));const r=await fetch('http://127.0.0.1:8890/v1/chain/'+method,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(20000)});assert(r.ok,'Read-only native RPC HTTP '+r.status);return JSON.parse(await r.text(),(_k,v,c)=>typeof v==='number'&&!Number.isSafeInteger(v)&&/^\d+$/.test(c?.source||'')?c.source:v);};
try{
 const page=await queryUpgradeHistory(elastic,'aic',rpc,{limit:20,offset:0});
 assert.equal(page.chain_id,'116ea0c3c556951ba0a9244cbfbfe13f98972f3353c38ff38c35122d0f61c5a0');
 assert.equal(page.total_proposals,3);assert.deepEqual(page.entries.map(e=>[e.proposal_id,e.status,e.vetoes.length]),[['3','pending',24],['2','executed',0],['1','executed',0]]);
 assert.equal(page.entries[1].executed.transaction_id,'b029b9947a608a679baf6445a0e2d106fe2bc8601e59db58a98f5d963f45ff33');
 assert.equal(page.entries[0].target,'eosio.token');assert(!page.entries[0].executed);
 fs.writeFileSync(K+'/ACTUAL_HISTORY_QUERY.json',JSON.stringify({status:'PASS',page},null,2)+'\n');console.log('ACTUAL THREE PROPOSALS AND24 VETOES CANONICALLY VERIFIED');
}finally{await elastic.close();}
