"""Local packaging only; remote follow-up for one history table-header translation."""
from pathlib import Path
import hashlib,importlib.util,json,subprocess,tarfile
D=Path(__file__).resolve().parent;W=D.parents[1];S=W/'PureEOS-explorer-key-history-20261103'
sp=importlib.util.spec_from_file_location('c',W/'release-work-20261102/cheap-vps-35bp-history-r1/cloud.py');c=importlib.util.module_from_spec(sp);sp.loader.exec_module(c);s=c.read()
a=D/'frontend-source-r2.tar.gz';names=subprocess.check_output(['git','ls-files','--cached','--others','--exclude-standard','-z'],cwd=S).decode().split('\0')
with tarfile.open(a,'w:gz')as t:
 for n in names:
  if n and Path(n).parts[0]not in {'node_modules','dist','performance-results'}:t.add(S/n,arcname=n,recursive=False)
digest=hashlib.sha256(a.read_bytes()).hexdigest();o=['-i',s['ssh_key_path'],'-o','IdentitiesOnly=yes','-o','BatchMode=yes','-o','StrictHostKeyChecking=yes','-o','UserKnownHostsFile='+s['known_hosts']]
subprocess.run(['scp',*o,str(a),'root@66.245.194.132:/opt/pureeos-upgrade-history-20261104-r1/'],check=True)
remote=r'''
from pathlib import Path
import hashlib,json,subprocess,tarfile
K=Path('/opt/pureeos-upgrade-history-20261104-r1');S=K/'frontend'
assert subprocess.run(['systemctl','is-active','--quiet','pureeos-upgrade-history-frontend-build-r1-20261104']).returncode!=0,'Wait for first build to finish'
assert json.loads((K/'FRONTEND_RESULT.json').read_text())['status']=='PASS'
assert hashlib.sha256((K/'frontend-source-r2.tar.gz').read_bytes()).hexdigest()==DIGEST
(K/'FRONTEND_RESULT.json').rename(K/'FRONTEND_RESULT_r1.json')
with tarfile.open(K/'frontend-source-r2.tar.gz')as t:
 for n in ['src/lib/translations.ts','src/components/DeveloperProposalHistory.test.tsx']:
  (S/n).write_bytes(t.extractfile(n).read())
worker=(K/'build-frontend-r1.py').read_text().replace("['npm','test','--','--config'","['npm','test','--','src/components/DeveloperProposalHistory.test.tsx','src/lib/upgrade-history.test.ts','src/lib/i18n.test.ts','--config'")
worker=worker.replace('frontend-test-r1.log','frontend-test-r2.log').replace('frontend-build-r1.log','frontend-build-r2.log').replace('FRONTEND_FAILURE_r1.json','FRONTEND_FAILURE_r2.json')
old=json.loads((K/'FRONTEND_RESULT_r1.json').read_text())['source_sha256'];worker=worker.replace(old,DIGEST)
(K/'build-frontend-r2.py').write_text(worker)
subprocess.run(['systemd-run','--no-block','--unit=pureeos-upgrade-history-frontend-build-r2-20261104','--property=Type=oneshot','--property=Nice=10','--property=CPUQuota=50%','--property=CPUWeight=100','--property=MemoryHigh=768M','--property=MemoryMax=1G','--property=OOMScoreAdjust=900','--property=RuntimeMaxSec=1800','--property=StandardOutput=append:'+str(K/'build-controller-r2.log'),'--property=StandardError=append:'+str(K/'build-controller-r2.log'),'python3','-B',str(K/'build-frontend-r2.py')],check=True)
print('Translation-only remote9affected tests/build launched')
'''.replace('DIGEST',repr(digest))
p=subprocess.run(c.ssh()+['python3','-B','-'],input=remote,capture_output=True,text=True);assert not p.returncode,p.stderr;print(p.stdout)
