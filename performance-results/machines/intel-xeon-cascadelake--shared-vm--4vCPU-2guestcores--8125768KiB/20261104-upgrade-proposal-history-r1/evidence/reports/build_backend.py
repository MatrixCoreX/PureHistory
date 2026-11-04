"""Run remotely only; compile and test the read-only history addition."""
from pathlib import Path
import hashlib,json,os,subprocess,traceback
K=Path('/opt/pureeos-upgrade-history-20261104-r1');S=K/'backend';R=Path('/opt/pureeos-keynet-20261103-r2')
try:
 env={**os.environ,'PATH':str(R/'tools/node-current/bin')+':'+os.environ['PATH'],'NODE_OPTIONS':'--max-old-space-size=1024'}
 with(K/'backend-build.log').open('w')as log:subprocess.run(['node','node_modules/typescript/bin/tsc'],cwd=S,env=env,stdout=log,stderr=subprocess.STDOUT,check=True)
 with(K/'backend-tests.log').open('w')as log:subprocess.run(['node','--test','tests/compat/upgrade-history.test.mjs','tests/compat/key-history.test.mjs'],cwd=S,env=env,stdout=log,stderr=subprocess.STDOUT,check=True)
 files={str(p.relative_to(S)):hashlib.sha256(p.read_bytes()).hexdigest()for folder in ['build/upgrade-history','build/api/routes/v2-history/get_upgrade_proposals']for p in(S/folder).rglob('*')if p.is_file()}
 assert files;(K/'BACKEND_BUILD_RESULT.json').write_text(json.dumps({'status':'PASS','files':files,'source_sha256':json.loads((K/'BACKEND_SOURCE.json').read_text())['sha256']},indent=2)+'\n')
 print('READ-ONLY NATIVE UPGRADE HISTORY BUILD/TEST PASS',flush=True)
except BaseException:
 (K/'BACKEND_BUILD_FAILURE.json').write_text(json.dumps({'status':'FAIL','error':traceback.format_exc()},indent=2)+'\n');raise
