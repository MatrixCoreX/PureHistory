"""Local source packaging/orchestration only; every build/test runs remotely."""
from pathlib import Path
import hashlib,importlib.util,json,subprocess,tarfile,sys
D=Path(__file__).resolve().parent;W=D.parents[1];S=W/'PureHistory-key-history-20261103'
spec=importlib.util.spec_from_file_location('cloud',W/'release-work-20261102/cheap-vps-35bp-history-r1/cloud.py');c=importlib.util.module_from_spec(spec);spec.loader.exec_module(c);owner=c.read();assert owner['instance']['main_ip']=='66.245.194.132'
attempt=sys.argv[1]if len(sys.argv)>1 else'r1';assert attempt in ['r1','r2']
a=D/('backend-source-'+attempt+'.tar.gz');names=subprocess.check_output(['git','ls-files','--cached','--others','--exclude-standard','-z'],cwd=S).decode().split('\0')
with tarfile.open(a,'w:gz')as t:
 for name in names:
  if name and Path(name).parts[0]not in {'node_modules','build','dist','performance-results','config','chains'}and Path(name).name!='connections.json':t.add(S/name,arcname=name,recursive=False)
digest=hashlib.sha256(a.read_bytes()).hexdigest();K='/opt/pureeos-upgrade-history-20261104-r1'
subprocess.run(c.ssh()+['mkdir','-p',K],check=True)
opts=['-i',owner['ssh_key_path'],'-o','IdentitiesOnly=yes','-o','BatchMode=yes','-o','StrictHostKeyChecking=yes','-o','UserKnownHostsFile='+owner['known_hosts']]
subprocess.run(['scp',*opts,str(a),str(D/'build_backend.py'),'root@66.245.194.132:'+K+'/'],check=True)
setup='''from pathlib import Path
import hashlib,json,subprocess,tarfile
K=Path('/opt/pureeos-upgrade-history-20261104-r1');S=K/'backend';assert not S.exists();S.mkdir()
assert hashlib.sha256((K/'backend-source-r1.tar.gz').read_bytes()).hexdigest()==DIGEST
with tarfile.open(K/'backend-source-r1.tar.gz')as t:t.extractall(S,filter='data')
H=Path('/opt/pureeos-keynet-20261103-r2/history-source')
for name in ['package.json','package-lock.json']:assert(S/name).read_bytes()==(H/name).read_bytes()
(S/'node_modules').symlink_to(H/'node_modules',target_is_directory=True)
(K/'BACKEND_SOURCE.json').write_text(json.dumps({'sha256':DIGEST},indent=2)+'\\n')
subprocess.run(['systemd-run','--no-block','--unit=pureeos-upgrade-history-backend-build-r1-20261104','--property=Type=oneshot','--property=Nice=10','--property=CPUQuota=50%','--property=CPUWeight=100','--property=MemoryHigh=1G','--property=MemoryMax=1800M','--property=OOMScoreAdjust=900','--property=RuntimeMaxSec=1800','--property=StandardOutput=append:'+str(K/'backend-controller.log'),'--property=StandardError=append:'+str(K/'backend-controller.log'),'python3','-B',str(K/'build_backend.py')],check=True)
print('NATIVE HISTORY BACKEND BUILD LAUNCHED')
'''.replace('backend-source-r1.tar.gz',a.name).replace('backend-build-r1-20261104','backend-build-'+attempt+'-20261104').replace('DIGEST',repr(digest))
q=subprocess.run(c.ssh()+['python3','-B','-'],input=setup,capture_output=True,text=True);assert not q.returncode,q.stderr;print(q.stdout)
(D/('BACKEND_LAUNCH_'+attempt+'.json')).write_text(json.dumps({'status':'LAUNCHED','source_sha256':digest},indent=2)+'\n')
