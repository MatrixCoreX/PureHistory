"""Collect evidence without keys/DBs. Frontend source stays in private storage.
The full archive must not be copied into the public contract repository.
"""
from pathlib import Path
import hashlib,importlib.util,json,subprocess,tarfile
D=Path(__file__).resolve().parent;W=D.parents[1]
sp=importlib.util.spec_from_file_location('cloud',W/'release-work-20261102/cheap-vps-35bp-history-r1/cloud.py')
c=importlib.util.module_from_spec(sp);sp.loader.exec_module(c);owner=c.read();assert owner['instance']['main_ip']=='66.245.194.132'
remote=r'''
from pathlib import Path
import hashlib,json,re,tarfile
K=Path('/opt/pureeos-upgrade-history-20261104-r1');files=[]
for p in K.iterdir():
 if p.is_file()and p.suffix in ['.json','.log','.py','.mjs','.cjs']:files.append((p,'reports/'+p.name))
for directory in sorted(K.glob('browser-*')):
 if directory.is_dir():
  for p in directory.iterdir():
   if p.is_file()and p.suffix in ['.json','.png']:files.append((p,directory.name+'/'+p.name))
for p in sorted(K.glob('*-source-r[1-9].tar.gz')):files.append((p,'source/'+p.name))
deployment=json.loads((K/'DEPLOYMENT.json').read_text());static=Path(deployment['release'])
for name,digest in deployment['files'].items():
 p=static/name;assert hashlib.sha256(p.read_bytes()).hexdigest()==digest;files.append((p,'static/'+name))
H=Path('/opt/pureeos-keynet-20261103-r2/history-source')
for folder in ['build/upgrade-history','build/api/routes/v2-history/get_upgrade_proposals','src/upgrade-history','src/api/routes/v2-history/get_upgrade_proposals']:
 for p in(H/folder).rglob('*'):
  if p.is_file():files.append((p,'backend/'+str(p.relative_to(H))))
digests={}
for p,name in files:
 data=p.read_bytes()
 assert not re.search(rb'PVT_[A-Z0-9]+_[A-Za-z0-9_-]{40,}',data),'Private key in '+name
 assert not re.search(rb'(?<![1-9A-HJ-NP-Za-km-z])5[HJK][1-9A-HJ-NP-Za-km-z]{49}(?![1-9A-HJ-NP-Za-km-z])',data),'Legacy private key in '+name
 assert name not in digests;digests[name]=hashlib.sha256(data).hexdigest()
a=K/'verified-evidence.tar.gz'
with tarfile.open(a,'w:gz')as t:
 for p,name in files:t.add(p,arcname=name,recursive=False)
print(json.dumps({'archive':str(a),'sha256':hashlib.sha256(a.read_bytes()).hexdigest(),'files':digests}))
'''
q=subprocess.run(c.ssh()+['python3','-B','-'],input=remote,capture_output=True,text=True,check=True);record=json.loads(q.stdout)
opts=['-i',owner['ssh_key_path'],'-o','IdentitiesOnly=yes','-o','BatchMode=yes','-o','StrictHostKeyChecking=yes','-o','UserKnownHostsFile='+owner['known_hosts']]
a=D/'verified-evidence.tar.gz';subprocess.run(['scp',*opts,'root@66.245.194.132:'+record['archive'],str(a)],check=True)
assert hashlib.sha256(a.read_bytes()).hexdigest()==record['sha256'];out=D/'evidence';out.mkdir(exist_ok=True)
with tarfile.open(a)as t:t.extractall(out,filter='data')
for name,digest in record['files'].items():assert hashlib.sha256((out/name).read_bytes()).hexdigest()==digest
(D/'VERIFIED_EVIDENCE_MANIFEST.json').write_text(json.dumps(record,indent=2)+'\n')
print(json.dumps({'files':len(record['files']),'archive_sha256':record['sha256'],'all_hashes_verified':True}))
