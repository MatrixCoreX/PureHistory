"""Format verified evidence; private frontend sources stay in the private explorer repo."""
from pathlib import Path
import hashlib,json,shutil
D=Path(__file__).resolve().parent;W=D.parents[1];E=D/'evidence';R=E/'reports';read=lambda n:json.loads((R/n).read_text())
for name in ['BACKEND_BUILD_RESULT.json','ACTUAL_HISTORY_QUERY.json','API_INTEGRATION.json','PUBLIC_API_INTEGRATION.json','FRONTEND_RESULT.json','SOURCE_PROVENANCE.json','LIVE_AUDIT_after.json','CLEANUP_RESULT.json']:assert read(name)['status']=='PASS',name
for phase in ['preview','public']:assert json.loads((E/('browser-'+phase)/'RESULT.json').read_text())['status']=='PASS'
deploy=read('DEPLOYMENT.json');audit=read('LIVE_AUDIT_after.json');clean=read('CLEANUP_RESULT.json');source=read('SOURCE_PROVENANCE.json');page=read('PUBLIC_API_INTEGRATION.json')['page']
text=f'''# 历史提案列表与导航顶部留白（2026-11-04）

已开发、远端验证并发布：[开发者提案页面](https://aic-test.matrixai.one/#/upgrades)。侧栏顶部留白为36px，保留无可见滚动条样式及短屏滚轮/触摸/键盘访问。治理页面也显示同一历史列表。

## 页面实际内容

当前链{page['chain_id']}，实际不可逆提案按新到旧显示：

| 提案 | 目标 | 实际历史状态 | 已索引否决 |
|---|---|---|---:|
| #3 | eosio.token | 待执行；原生快照显示已达否决门槛 |24|
| #2 | eosio.key | 已执行，RAM市场计费升级 |0|
| #1 | eosio.key | 已执行，中继可设费率升级 |0|

每项提供提交和实际执行/撤回交易链接；哈希及逐BP否决交易默认折叠。原生最新快照的有效否决24/门槛16，与历史已索引票数区分。#3公示满1800秒后执行被原生否决拒绝，失败尝试不入链，历史不会伪造成功devexec或将其标成已执行。其翻倍目标为21亿→42亿AIC，实际上限21亿/发行1亿保持。

## 历史查询与真实性边界

新增同源只读 `/history/v2/history/get_upgrade_proposals?offset=0&limit=20`，使用原有Hyperion索引及当前同链RPC，不新增数据库、索引器、投影进程或HTTP入口。原生只保留最新状态；完整不可逆devpropose数量必须等于原生提案计数，按规范区块/交易/根动作顺序重建ID。规范不可逆块身份、executed交易回执、根动作提交字节/授权和最新哈希均核对，索引缺失、重号、分叉、失败回执或链变化均报错，不能用浏览器缓存补造历史。执行/撤回须有实际成功动作，不能用代码匹配推定。历史选民及公示截止没有足够证明时不推断；历史否决数标为已索引不可逆动作。

每页最多20项，提案重建最多1000，页内事件最多5000，验证预算12秒，成功结果缓存5秒，规范不可逆块仅缓存精简动作信息。超限或服务失败显示可重试错误。前端同链校验、序列/证明/终态一致性检查及分页保留真实数据边界。该上限不是整链终身历史完整性承诺。

## 远端验证与发布

后端完整TypeScript构建及21项兼容测试（新增9项及原公钥历史12项）通过。前端完整257项测试与构建通过；补充一项英文表头后，相关9项及TypeScript/生产构建再次通过。真实主机上的实际三提案/24票/两次执行、旧分页与不合法limit查询、公网现有get_actions兼容均通过。

预览与公网各四组实际Chrome：1366×768中文深色、1440×900英文浅色、390×844中文浅色、844×390英文深色。核对三行与状态、24个BP回执、五个哈希、默认折叠、刷新失败清空旧行并恢复、无正文横向溢出、顶部36px/无滚动条及最后导航入口键盘可达。无JS页面错误。截图及JSON保留。

前端提交{source['repositories']['PureEOS-explorer-key-history-20261103']['commit']}，103个构建输入与Git及远端归档一致；后端提交{source['repositories']['PureHistory-key-history-20261103']['commit']}，205个输入一致。静态发布{deploy['release']}，全部六个公网文件摘要匹配，上一版本完整保留。只在原API应用添加独立路由模块并重启该应用，原server/get_actions/配置摘要未变；未重启节点或索引器。

首次后端打包误排除src/api/config及TypeScript推断错误在隔离构建中失败，修正后通过，未发布失败制品。首次实际查询使用错误配置文件路径，在读取前失败；正确config路径后通过。原API低优先级重启初始化约两分钟，其间本地探测连接拒绝，随后真实路由验证通过。公网脚本原先预期未知参数返回400，但共享AJV按原行为删除额外字段并返回正常页；测试更正为检查规范化语义，非法limit仍400。以上日志均保留，没有借此更改共享验证器或链参数。

## 原服务与磁盘

最终原{audit['node_count']}节点PID/unit配置、票权、押金、原Germany永久禁令、native21/15、系统/代币/节点字节及CPU/NET/WASM参数保持；EOSkey仍为已批准bc3358d7。原普通稀疏业务、中继、历史API/索引器/公钥投影均运行。实际共享Cascadelake4vCPU/8GB主机资源紧张，未新增TPS或容量资格结论。cap提案24有效否决仍保留，上限及发行量不变。

完整证据与源码/静态/模块摘要本地校验后，仅清理本轮停用构建目录，释放分配空间{clean['allocated_removed_MiB']}MiB、可用{clean['available_GiB']}GiB；当前静态、安装后的活动API模块、共享依赖/浏览器、全部私钥/当前链/历史和先前不可变证据保留。私有浏览器源码和静态完整归档只进入私有浏览器仓库与本地证据，公共历史仓库仅保存公开后端源码和可公开证据。

English: the published explorer shows three real historical proposals, two canonical executions and24 irreversible veto records. The navigation has36px top padding, hidden scrollbars and full keyboard access on short screens. Remote tests, real API/browser checks, source/public asset hashes and original-node preservation audit passed.
'''
(D/'REPORT.md').write_text(text)
p=D/'PLAN.md';p.write_text(p.read_text()+'\n\nCompleted: remotebackend21/frontend257+translation9/build; actual3canonicalproposals/24vetoes/2executions; publicAPI/pagination/4preview+4publicChrome; staticpublication/36pxnav/protected26nodeaudit and verifiedcleanup. No chain/node/indexer reset/restart, newserver orTPS. Source/evidence archives verified and visibility scoped.\n')
rel=Path('performance-results/machines/intel-xeon-cascadelake--shared-vm--4vCPU-2guestcores--8125768KiB/20261104-upgrade-proposal-history-r1')
for repo,private in [('PureEOS-explorer-key-history-20261103',True),('PureHistory-key-history-20261103',False)]:
 out=W/repo/rel;out.mkdir(parents=True,exist_ok=True)
 for name in ['REPORT.md','PLAN.md']:shutil.copy2(D/name,out/name)
 for p in E.rglob('*'):
  if not p.is_file():continue
  r=p.relative_to(E)
  if not private and(r.parts[0]=='static'or r.parts[0]=='source'and r.name.startswith('frontend-')):continue
  dest=out/'evidence'/r;dest.parent.mkdir(parents=True,exist_ok=True);shutil.copy2(p,dest)
 for p in D.iterdir():
  if p.is_file()and p.suffix in ['.py','.mjs','.cjs']:
   dest=out/'operations'/p.name;dest.parent.mkdir(exist_ok=True);shutil.copy2(p,dest)
 manifest={str(p.relative_to(out)):hashlib.sha256(p.read_bytes()).hexdigest()for p in out.rglob('*')if p.is_file()and p.name!='EVIDENCE_MANIFEST.json'}
 (out/'EVIDENCE_MANIFEST.json').write_text(json.dumps({'private_frontend_source_included':private,'files':manifest},indent=2)+'\n')
print('HISTORY/NAVIGATION REPORT AND VISIBILITY-SCOPED EVIDENCE COMPLETE')
