import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Serializer} from '@wharfkit/antelope';
import {normalizeCreationAction,queryCreationHistory} from '../../build/creation-history/query.js';
let seed=0;
function fixture(){
 const salt=(++seed).toString(16).padStart(2,'0'),chain=salt.repeat(32),blocks=new Map(),proposals=[],events=[];let infoCalls=0;
 const id=n=>n.toString(16).padStart(8,'0')+salt.repeat(28),auth=actor=>[{actor,permission:actor==='civicgovlead'?'upgrade':'active'}];
 const values=n=>({target:n===1?'eosio.key':'usd',resource_payer:'civicgovlead',ram_payment:'10000',authority_version:n===1?'2':'3',code_bytes:'100',abi_bytes:'20',code_hash:(n===1?'33':'44').repeat(32),abi_hash:'55'.repeat(32),review_document_hash:(n===1?'66':'77').repeat(32)});
 const action=(kind,height,data,actor='civicgovlead')=>{
  const tx=(height+1000).toString(16).padStart(8,'0')+salt.repeat(28),blockId=id(height),timestamp='2026-11-04T00:00:'+String(height).padStart(2,'0')+'.000';
  const act={account:'eosio',name:kind,authorization:auth(actor),data};const actions=kind==='syspropose'?[{account:'eosio',name:'refreshgov',authorization:auth(actor),data:{}},act]:[act];
  blocks.set(blockId,{id:blockId,block_num:height,timestamp,transactions:[{status:'executed',trx:{id:tx,transaction:{actions}}}]});
  const doc={act:structuredClone(act),block_num:height,block_id:blockId,trx_id:tx,'@timestamp':timestamp,action_ordinal:kind==='syspropose'?2:1,creator_action_ordinal:0};
  (kind==='syspropose'?proposals:events).push(doc);return doc;
 };
 action('syspropose',10,values(1));action('syspropose',20,values(2));action('sysexec',25,{proposal_id:1,code:'00',abi:'00'});
 action('sysveto',21,{proposal_id:2,voter:'anthropiclab'},'anthropiclab');action('sysveto',22,{proposal_id:2,voter:'gptgenesisbp'},'gptgenesisbp');
 const native={proposal_exists:true,latest_proposal_id:2,proposal_id:2,pending:true,...values(2),pending_count:1,pending_proposals:[{proposal_id:2,pending:true,...values(2)}]};
 const context={chain,native,blocks,proposals,events,action,values,brokenInfo:false,timeout:false,
  elastic:{search:async body=>{const names=body.query.bool.filter[1].terms['act.name'],range=body.query.bool.filter[2].range.block_num;
   const docs=[...proposals,...events].filter(d=>names.includes(d.act.name)&&d.block_num<=(range.lte??Infinity)&&d.block_num>=(range.gte??0));
   return{timed_out:context.timeout,_shards:{failed:0},hits:{total:{value:docs.length,relation:'eq'},hits:docs.map(_source=>({_source}))}};}},
  rpc:async(method,body)=>{if(method==='get_info')return{chain_id:context.brokenInfo&&++infoCalls>1?'ff'.repeat(32):chain,last_irreversible_block_num:30};
   if(method==='get_system_account_state')return native;if(method==='get_block')return blocks.get(body.block_num_or_id);throw Error('Mutating/unexpected RPC '+method);}};
 return context;
}
test('actual canonical terminal actions establish execution; pending and indexed vetoes remain distinct',async()=>{
 const c=fixture(),r=await queryCreationHistory(c.elastic,'testchain',c.rpc);assert.equal(r.total_proposals,2);assert.deepEqual(r.entries.map(x=>x.proposal_id),['2','1']);
 assert.equal(r.entries[0].status,'pending');assert.equal(r.entries[0].vetoes.length,2);assert.equal(r.entries[1].status,'executed');assert.equal(r.entries[1].executed.block_num,25);
 assert.equal(r.indexing.complete_proposal_sequence,true);assert(!('execute_after'in r.entries[1]));assert(!('effective_voters'in r.entries[1]));
});
test('complete native counter coverage is required before deriving proposal IDs',async()=>{const c=fixture();c.proposals.pop();await assert.rejects(queryCreationHistory(c.elastic,'testchain',c.rpc),/not fully indexed/);});
test('duplicate canonical proposal records cannot manufacture sequence coverage',async()=>{const c=fixture();c.native.latest_proposal_id=3;c.proposals.push(structuredClone(c.proposals[0]));await assert.rejects(queryCreationHistory(c.elastic,'testchain',c.rpc),/Duplicate native proposal/);});
test('fork blocks and absent or unsuccessful transaction receipts are rejected',async()=>{
 for(const kind of ['fork','absent','failed']){const c=fixture(),b=c.blocks.get(c.proposals[0].block_id);if(kind==='fork')b.id='ff'.repeat(32);if(kind==='absent')b.transactions=[];if(kind==='failed')b.transactions[0].status='hard_fail';await assert.rejects(queryCreationHistory(c.elastic,'testchain',c.rpc),/canonical block mismatch|canonical receipt/);}
});
test('indexed proposal bytes must match the canonical root action and latest native state',async()=>{
 const c=fixture();c.proposals[0].act.data.code_hash='88'.repeat(32);await assert.rejects(queryCreationHistory(c.elastic,'testchain',c.rpc),/missing or ambiguous/);
 const d=fixture();d.native.code_hash='99'.repeat(32);await assert.rejects(queryCreationHistory(d.elastic,'testchain',d.rpc),/differs from native/);
});
test('conflicting terminal actions and duplicate voter records fail closed',async()=>{
 const c=fixture();c.action('syscancel',16,{proposal_id:1});await assert.rejects(queryCreationHistory(c.elastic,'testchain',c.rpc),/Conflicting/);
 const d=fixture();d.events.push(structuredClone(d.events[1]));await assert.rejects(queryCreationHistory(d.elastic,'testchain',d.rpc),/Duplicate native creation event/);
});
test('pagination keeps older proposal closing proof and excludes later proposal votes',async()=>{const c=fixture(),r=await queryCreationHistory(c.elastic,'testchain',c.rpc,{offset:1,limit:1});assert.equal(r.entries[0].proposal_id,'1');assert.equal(r.entries[0].status,'executed');assert.equal(r.entries[0].vetoes.length,0);assert.equal(r.has_more,false);});
test('timeouts, chain changes, unsupported counters and unknown query inputs are errors',async()=>{
 const c=fixture();c.timeout=true;await assert.rejects(queryCreationHistory(c.elastic,'testchain',c.rpc),/incomplete/);
 const d=fixture();d.brokenInfo=true;await assert.rejects(queryCreationHistory(d.elastic,'testchain',d.rpc),/chain changed/);
 const e=fixture();e.native.latest_proposal_id='1001';await assert.rejects(queryCreationHistory(e.elastic,'testchain',e.rpc),/bounded/);
 await assert.rejects(queryCreationHistory(fixture().elastic,'bad*',fixture().rpc),/Invalid.*chain/);
 await assert.rejects(queryCreationHistory(fixture().elastic,'testchain',fixture().rpc,{x:'inject'}),/Unknown/);
});
test('binary native action decoding retains exact uint64 values and full hash identity',()=>{
 const fields=['target','resource_payer','ram_payment','authority_version','code_bytes','abi_bytes','code_hash','abi_hash','review_document_hash'],types={target:'name',resource_payer:'name',ram_payment:'int64',authority_version:'uint32',code_bytes:'uint32',abi_bytes:'uint32'},abi={version:'eosio::abi/1.2',types:[],structs:[{name:'syspropose',base:'',fields:fields.map(name=>({name,type:types[name]||'checksum256'}))}],actions:[],tables:[]};
 const c=fixture(),doc=structuredClone(c.proposals[0]);doc.act.data=Serializer.encode({abi,type:'syspropose',object:doc.act.data}).hexString;assert.deepEqual(normalizeCreationAction(doc).data,c.values(1));
 doc.act.name='syscancel';doc.act.data=Buffer.from('ffffffffffffffff','hex').toString('hex');assert.equal(normalizeCreationAction(doc).data.proposal_id,'18446744073709551615');
});

test('an older proposal remains pending when the newest ID is cancelled',async()=>{
 const f=fixture();f.events.splice(0,1);f.native.pending=false;f.native.pending_proposals=[{proposal_id:1,pending:true,...f.values(1)}];f.native.pending_count=1;
 f.action('syscancel',26,{proposal_id:2});const r=await queryCreationHistory(f.elastic,'testchain',f.rpc);
 assert.equal(r.entries[0].status,'cancelled');assert.equal(r.entries[1].status,'pending');
});
test('pending per-ID payloads and the bounded native pending count must agree',async()=>{
 const c=fixture();c.native.pending_count=2;await assert.rejects(queryCreationHistory(c.elastic,'testchain',c.rpc),/parallel creation/);
 const d=fixture();d.native.pending_proposals[0].code_hash='99'.repeat(32);await assert.rejects(queryCreationHistory(d.elastic,'testchain',d.rpc),/Pending indexed/);
});
test('four creation roots in one canonical transaction retain distinct IDs and pending states',async()=>{
 const c=fixture(),first=structuredClone(c.proposals[0]),actions=[],rows=[];
 c.proposals.length=0;c.events.length=0;c.blocks.clear();
 for(const [i,target]of ['eosio.key','usd','cny','eosio.signup'].entries()){
  const value={...c.values(i+1),target,authority_version:target.startsWith('eosio.')?'2':'3'};
  const act={account:'eosio',name:'syspropose',authorization:first.act.authorization,data:value};
  actions.push({account:'eosio',name:'refreshgov',authorization:first.act.authorization,data:{}},act);
  c.proposals.push({...structuredClone(first),act:structuredClone(act),action_ordinal:2*i+2});
  rows.push({proposal_id:i+1,pending:true,...value});
 }
 c.blocks.set(first.block_id,{id:first.block_id,block_num:first.block_num,timestamp:first['@timestamp'],transactions:[{status:'executed',trx:{id:first.trx_id,transaction:{actions}}}]});
 Object.assign(c.native,rows[3],{latest_proposal_id:4,pending_count:4,pending_proposals:rows});
 const r=await queryCreationHistory(c.elastic,'testchain',c.rpc);
 assert.deepEqual(r.entries.map(x=>x.proposal_id),['4','3','2','1']);assert(r.entries.every(x=>x.status==='pending'&&x.submitted.transaction_id===first.trx_id));
});
