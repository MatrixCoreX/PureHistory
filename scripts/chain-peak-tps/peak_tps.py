"""Server-owned rolling TPS from complete irreversible native block receipts."""
import argparse,datetime,json,sqlite3,threading,time,urllib.request
from pathlib import Path
from http.server import BaseHTTPRequestHandler,ThreadingHTTPServer
from urllib.parse import urlsplit,parse_qs
WINDOW=86400

def epoch(value):
    dt=datetime.datetime.fromisoformat(value.replace('Z','+00:00'))
    return (dt if dt.tzinfo else dt.replace(tzinfo=datetime.timezone.utc)).timestamp()

def iso(value):return datetime.datetime.fromtimestamp(value,datetime.timezone.utc).isoformat(timespec='milliseconds')

def insert_block(db,block,height,previous):
    assert block['block_num']==height,'Noncontiguous native block height'
    assert previous is None or block['previous']==previous,'Canonical parent mismatch'
    assert isinstance(block['transactions'],list),'Native receipt list missing'
    db.execute('INSERT INTO blocks VALUES(?,?,?,?,?)',(height,block['id'],block['previous'],epoch(block['timestamp']),len(block['transactions'])))
    return block['id']

def summary(db,info,cursor,stamp,interval,scope='24h'):
    assert cursor>=info['last_irreversible_block_num'],'Incomplete finality backfill'
    if scope=='all_time':
        where='height<=?';params=(info['last_irreversible_block_num'],)
    else:
        where='time>=? AND time<=? AND height<=?';params=(stamp-WINDOW,stamp,info['last_irreversible_block_num'])
    rows=db.execute('SELECT COUNT(*),MIN(height),MAX(height),MIN(time) FROM blocks WHERE '+where,params).fetchone()
    assert not rows[0] or rows[0]==rows[2]-rows[1]+1,'Gap in counted canonical blocks'
    if scope=='all_time':assert rows[0]==info['last_irreversible_block_num'] and rows[1]==1,'Lifetime statistics must include every block from genesis'
    row=db.execute('SELECT height,id,time,receipts FROM blocks WHERE '+where+' ORDER BY receipts DESC,height DESC LIMIT 1',params).fetchone()
    peak=None if row is None else {'block_num':row[0],'block_id':row[1],'block_time':iso(row[2]),'receipt_count':row[3],'tps':row[3]*1000/interval}
    return {'schema_version':1,'available':True,'chain_id':info['chain_id'],'scope':'chain_lifetime'if scope=='all_time'else'rolling_24h','generated_at':iso(stamp),'window_seconds':None if scope=='all_time'else WINDOW,'window_start':iso(rows[3])if scope=='all_time'else iso(stamp-WINDOW),'window_end':iso(stamp),'block_interval_ms':interval,'head':info['head_block_num'],'LIB':info['last_irreversible_block_num'],'indexed_through':cursor,'complete_through_LIB':True,'block_count':rows[0],'first_counted_block':rows[1],'last_counted_block':rows[2],'peak_tps':peak['tps']if peak else 0,'peak':peak,'source':'canonical_node_rpc_irreversible_receipts','definition':'Maximum native block receipt count divided by fixed block interval; '+('all finalized chain history from genesis'if scope=='all_time'else'rolling24h')+'; includes empty blocks; not a sustained benchmark'}

def main():
    p=argparse.ArgumentParser();p.add_argument('--rpc',required=True);p.add_argument('--chain-id',required=True);p.add_argument('--data-dir',required=True);p.add_argument('--port',type=int,default=9052);p.add_argument('--block-interval-ms',type=int,default=500);a=p.parse_args()
    assert len(a.chain_id)==64 and all(c in '0123456789abcdef'for c in a.chain_id)
    assert 1<=a.block_interval_ms<=60000 and urlsplit(a.rpc).scheme in ['http','https']
    D=Path(a.data_dir);D.mkdir(parents=True,exist_ok=True);DB=D/'canonical-receipts.sqlite';lock=threading.Lock();lifetime={};current={'schema_version':1,'available':False,'chain_id':a.chain_id,'reason':'Initial canonical receipt backfill is running'}
    def rpc(method,data={}):
        req=urllib.request.Request(a.rpc.rstrip('/')+'/v1/chain/'+method,json.dumps(data).encode(),{'Content-Type':'application/json'})
        with urllib.request.urlopen(req,timeout=30)as r:return json.load(r)
    def save(name,data):
        temp=D/(name+'.pending');temp.write_text(json.dumps(data,indent=2)+'\n');temp.replace(D/name)
    def publish(data,all_time=None):
        with lock:
            current.clear();current.update(data);lifetime.clear();lifetime.update(all_time or data)
        save('PROGRESS.json',all_time or data)
    def worker():
        with sqlite3.connect(DB)as db:
            db.execute('PRAGMA journal_mode=WAL');db.execute('CREATE TABLE IF NOT EXISTS state(k TEXT PRIMARY KEY,v TEXT)');db.execute('CREATE TABLE IF NOT EXISTS blocks(height INTEGER PRIMARY KEY,id TEXT,previous TEXT,time REAL,receipts INTEGER)');db.execute('CREATE INDEX IF NOT EXISTS block_time ON blocks(time)')
            def state(k,default=None):
                r=db.execute('SELECT v FROM state WHERE k=?',(k,)).fetchone();return json.loads(r[0])if r else default
            def put(k,v):db.execute('INSERT OR REPLACE INTO state VALUES(?,?)',(k,json.dumps(v)))
            if state('chain_id')not in [None,a.chain_id]:publish({'available':False,'reason':'Stored chain identity mismatch; explicit new data directory required','chain_id':a.chain_id});return
            put('chain_id',a.chain_id);db.commit()
            while True:
                try:
                    info=rpc('get_info');assert info['chain_id']==a.chain_id,'Native chain identity changed; statistics are unavailable'
                    lib=int(info['last_irreversible_block_num']);assert lib>0
                    cursor=state('cursor');previous=state('previous')
                    if cursor is not None and not state('lifetime_enabled',False):
                        coverage=db.execute('SELECT COUNT(*),MIN(height),MAX(height) FROM blocks').fetchone()
                        if coverage!=(cursor,1,cursor):
                            db.execute('DELETE FROM blocks');cursor=None;previous=None;put('cursor',None);put('previous',None)
                        put('lifetime_enabled',True);db.commit()
                    if cursor is None:
                        cursor=0;previous=None;put('cursor',cursor);put('previous',previous);put('lifetime_enabled',True);db.commit()
                    assert cursor<=lib,'Irreversible cursor moved backwards'
                    for height in range(cursor+1,min(lib,cursor+256)+1):
                        block=rpc('get_block',{'block_num_or_id':str(height)});previous=insert_block(db,block,height,previous);cursor=height
                        put('cursor',cursor);put('previous',previous)
                        if height%32==0:db.commit()
                    db.commit()
                    if cursor<lib:
                        publish({'schema_version':1,'available':False,'chain_id':a.chain_id,'generated_at':iso(time.time()),'reason':'Initial canonical receipt backfill is running','indexed_through':cursor,'LIB':lib});continue
                    stamp=time.time();result=summary(db,info,cursor,stamp,a.block_interval_ms);all_time=summary(db,info,cursor,stamp,a.block_interval_ms,'all_time');publish(result,all_time)
                    time.sleep(5)
                except Exception as error:
                    db.rollback();publish({'schema_version':1,'available':False,'chain_id':a.chain_id,'generated_at':iso(time.time()),'reason':str(error)[:300]});time.sleep(5)
    class Handler(BaseHTTPRequestHandler):
        def do_GET(self):
            if urlsplit(self.path).path!='/v2/stats/get_peak_tps':self.send_error(404);return
            scope=parse_qs(urlsplit(self.path).query).get('scope',['24h'])[0]
            if scope not in ['24h','all_time']:self.send_error(400,'Invalid statistics scope');return
            with lock:data=dict(lifetime if scope=='all_time'else current)
            raw=json.dumps(data,separators=(',',':')).encode();self.send_response(200 if data.get('available')else 503);self.send_header('Content-Type','application/json');self.send_header('Cache-Control','no-store');self.send_header('Access-Control-Allow-Origin','*');self.send_header('Content-Length',str(len(raw)));self.end_headers();self.wfile.write(raw)
        def log_message(self,*args):pass
    threading.Thread(target=worker,daemon=True).start();ThreadingHTTPServer(('127.0.0.1',a.port),Handler).serve_forever()
if __name__=='__main__':main()
