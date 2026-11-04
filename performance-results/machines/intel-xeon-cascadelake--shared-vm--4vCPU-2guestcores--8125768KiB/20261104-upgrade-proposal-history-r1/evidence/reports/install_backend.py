"""Remote-only: add the qualified read-only API module to the existing history app."""
from pathlib import Path
import datetime,hashlib,json,shutil,subprocess,urllib.request
K=Path('/opt/pureeos-upgrade-history-20261104-r1');S=K/'backend';H=Path('/opt/pureeos-keynet-20261103-r2/history-source')
assert json.loads((K/'BACKEND_BUILD_RESULT.json').read_text())['status']=='PASS'
assert json.loads((K/'ACTUAL_HISTORY_QUERY.json').read_text())['status']=='PASS'
assert not(K/'BACKEND_DEPLOYMENT.json').exists()
protected=['build/api/server.js','build/api/routes/v2-history/get_actions/get_actions.js','src/api/server.ts','src/api/routes/v2-history/get_actions/get_actions.ts','config/connections.json']
sha=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
before={p:sha(H/p)for p in protected};paths=[]
for folder in ['build/upgrade-history','build/api/routes/v2-history/get_upgrade_proposals','src/upgrade-history','src/api/routes/v2-history/get_upgrade_proposals']:
 paths.extend(p for p in(S/folder).rglob('*')if p.is_file())
assert len(paths)>=4
files={}
for p in paths:
 rel=p.relative_to(S);dest=H/rel;dest.parent.mkdir(parents=True,exist_ok=True)
 if dest.exists():assert dest.read_bytes()==p.read_bytes()
 else:shutil.copy2(p,dest)
 files[str(rel)]=sha(dest)
assert before=={p:sha(H/p)for p in protected}
subprocess.run(['systemctl','restart','pureeos-keynet2-purehistory-api-20261103.service'],check=True)
(K/'BACKEND_DEPLOYMENT.json').write_text(json.dumps({'status':'INSTALLED','UTC':datetime.datetime.now(datetime.timezone.utc).isoformat(),'files':files,'protected_unchanged':before,'scope':'Existing read-only API app restart only; no indexer/projector/node/DB/contract changes'},indent=2)+'\n')
print('NATIVE HISTORY API OVERLAY INSTALLED')
