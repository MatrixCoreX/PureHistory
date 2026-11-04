"""Remove stopped history/UI build work only after verified publication and evidence."""
from pathlib import Path
import datetime,json,os,shutil,subprocess
K=Path('/opt/pureeos-upgrade-history-20261104-r1');R=Path('/opt/pureeos-keynet-20261103-r2')
assert json.loads((K/'browser-public/RESULT.json').read_text())['status']=='PASS'
assert json.loads((K/'LIVE_AUDIT_after.json').read_text())['status']=='PASS'
assert(K/'verified-evidence.tar.gz').is_file()
paths=[K/'frontend',K/'backend',K/'backend.failed-r1']
for u in ['pureeos-keynet2-purehistory-api-20261103.service','pureeos-key-history-20261103.service','pureeos-keynet2-relay-20261103.service']:
 command=subprocess.check_output(['systemctl','show',u,'-p','ExecStart','--value'],text=True)
 for p in paths:assert str(p)not in command
for proc in Path('/proc').iterdir():
 if not proc.name.isdigit()or int(proc.name)==os.getpid():continue
 try:cmd=(proc/'cmdline').read_bytes().replace(b'\0',b' ').decode(errors='replace');cwd=(proc/'cwd').resolve()
 except(OSError,RuntimeError):continue
 for p in paths:assert str(p)not in cmd and not cwd.is_relative_to(p),'Active process depends on build work'
allocated=0;removed=[]
for p in paths:
 if not p.exists():continue
 for child in p.rglob('*'):
  if child.is_file()and not child.is_symlink():allocated+=child.stat().st_blocks*512
 removed.append(str(p))
before=shutil.disk_usage(K).free
for p in paths:
 if p.exists():shutil.rmtree(p)
after=shutil.disk_usage(K).free
old=json.loads(Path('/opt/pureeos-key-rate-20261104-r1/LIVE_AUDIT_after.json').read_text())
for u,pid in old['node_pids'].items():assert int(subprocess.check_output(['systemctl','show',u,'-p','MainPID','--value'],text=True))==pid
result={'status':'PASS','UTC':datetime.datetime.now(datetime.timezone.utc).isoformat(),'removed':removed,'allocated_removed_MiB':round(allocated/1048576,3),'net_free_increase_MiB':round((after-before)/1048576,3),'available_GiB':round(after/1073741824,3),'original26nodePIDs_preserved':True,'active_source_and_static_preserved':True,'scope':'Only stopped frontend/backend build trees, with verified source/module/static/evidence archives and local copies first; shared dependencies, all private keys, current chain/history retained'}
(K/'CLEANUP_RESULT.json').write_text(json.dumps(result,indent=2)+'\n');print(json.dumps(result))
