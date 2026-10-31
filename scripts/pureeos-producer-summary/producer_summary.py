import datetime
PERIOD=1461*86400*2
LIMIT=(1<<32)-1
INVALID_RANK=((1<<64)-1)<<64
SUPPORTED_WASM={'6ed4cccc3aac05231f95e63b5464325315668bea2997ddb15de0b29768bf3a62','5f25a25816fc6db145dbd811d9c24dd99c9b9b1fd260b8e16a045476d0c3c11a'}
def truth(value):return value is True or str(value).lower()in ['1','true']
def all_rows(rpc,table):
 rows=[];lower='';seen=set()
 while True:
  r=rpc('get_table_rows',{'code':'eosio','scope':'eosio','table':table,'json':True,'limit':1000,'lower_bound':lower});rows.extend(r['rows'])
  if not r.get('more'):return rows
  following=str(r.get('next_key',''));assert following and following!=lower and following not in seen,'Non-progressing table pagination';seen.add(following);lower=following
  assert len(rows)<100000,'Producer table exceeds supported full-count bound'
def next_capacity(origin,slot):
 origin=int(origin);slot=int(slot);elapsed=max(0,slot-origin);epoch=elapsed//PERIOD
 if epoch>=25:return{'capacity':LIMIT,'next_capacity':None,'next_slot':None,'estimated_at':None}
 base=210<<epoch;remainder=elapsed%PERIOD;capacity=min(LIMIT,base+base*remainder//PERIOD)
 if capacity==LIMIT:return{'capacity':capacity,'next_capacity':None,'next_slot':None,'estimated_at':None}
 step=capacity-base+1;boundary=(step*PERIOD+base-1)//base;next_slot=origin+epoch*PERIOD+boundary
 assert next_slot>slot
 estimated=(datetime.datetime(2000,1,1,tzinfo=datetime.timezone.utc)+datetime.timedelta(seconds=next_slot/2)).isoformat(timespec='milliseconds')
 return{'capacity':capacity,'next_capacity':capacity+1,'next_slot':str(next_slot),'estimated_at':estimated,'period_slots':str(PERIOD),'rule':'linear growth; capacity doubles every1461days'}
def summarize(rpc,rotation,schedule):
 code=rpc('get_code_hash',{'account_name':'eosio'})['code_hash']
 if code not in SUPPORTED_WASM:return{'available':False,'reason':'Unsupported system contract; eligibility and capacity growth not inferred','system_code_hash':code}
 producers=all_rows(rpc,'producersv2');candidates=all_rows(rpc,'rotcands');maintenance=all_rows(rpc,'bpmaint')
 registered={p['owner']for p in producers if truth(p.get('is_active'))};banned={c['owner']for c in candidates if truth(c.get('banned'))};paused={m['owner']for m in maintenance if int(m.get('state',0))!=0}
 valid={c['owner']for c in candidates if c['owner']in registered and int(c['rank'])<INVALID_RANK and c['owner']not in banned and c['owner']not in paused}
 published={c['owner']for c in candidates if c['owner']in valid and int(c.get('seen_epoch',0))==int(rotation['published_epoch'])}
 active=[p['producer_name']for p in(schedule.get('active')or{}).get('producers',[])]
 growth=next_capacity(rotation['growth_start_slot'],rotation['last_slot']);assert growth['capacity']==int(rotation['capacity']),'Capacity differs from qualified on-chain growth rule'
 return{'available':True,'system_code_hash':code,'registered_bp_count':len(registered),'eligible_bp_count':len(valid),'published_candidate_count':len(published),'active_producer_count':len(active),'permanent_blacklist_count':len(banned),'maintenance_excluded_count':len(paused&registered),'maintenance_active_count':sum(1 for m in maintenance if m['owner']in registered and int(m.get('state',0))==2),'maintenance_pending_count':sum(1 for m in maintenance if m['owner']in registered and int(m.get('state',0))==1),'rotation_capacity':int(rotation['capacity']),'next_capacity':growth['next_capacity'],'next_capacity_slot':growth['next_slot'],'next_capacity_estimated_at':growth['estimated_at'],'count_scope':'All native producer/candidate/maintenance rows; pagination complete; no online-process or history-node count','eligible_scope':'Active registration, positive integer votes and usable producer/finalizer keys (valid rank), excluding permanent bans and non-normal maintenance; candidate admission still follows ranking snapshots'}
