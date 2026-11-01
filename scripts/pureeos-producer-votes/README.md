# PureEOS 自投与他人投票

只读接口 `GET /v2/state/get_producer_votes?accounts=founderbpgpt,openaibp4312` 一次最多50个不同账户。自投指BP账户自身选择该BP时，`votersv2.last_vote_amount`的实际分配票权；他人票权为总票权减自投。资金最初由谁转入不影响归类。数值保持最小单位整数字符串，不使用浮点、时间加权或代理推断。

必须连接不出块、拒绝未确认交易的历史节点，当前使用`127.0.0.1:8890`。使用原生数据库队列上的`get_upgrade_state`前后区块ID作为读取屏障，检测变化最多重试3次；出块节点存在同一head下的推测状态，因此不能替代历史节点。未知合约WASM、ABI、原生投票格式或精度均返回不可用。该扩展不改变现有EOS历史接口。

服务监听`127.0.0.1:9053`，经历史域名的精确路径代理访问。最多8路RPC读取、2个并行批次、64项10秒缓存，相同查询合并。缺失、错误或不一致数据不能转成零。HTTPS入口统一发送CORS头，内部服务不重复添加。服务不加载钱包或密钥，不开放写RPC；原有24小时观察服务无需重启。

运行：设置`PUREEOS_CHAIN_ID`；可选`PUREEOS_COMMITTED_RPC`；执行`python3 -B server.py`。测试：`python3 -B -m unittest discover -v`。部署须另核对非出块节点角色、实际链身份、HTTPS/CORS及浏览器集成。

# PureEOS self and other votes

The read-only `GET /v2/state/get_producer_votes?accounts=founderbpgpt,openaibp4312` accepts at most50unique accounts. Self votes are the BP account's allocated `votersv2.last_vote_amount` when it selects itself. Other votes equal total minus self. Funding origin does not determine voter identity. All amounts remain exact integer strings in smallest units, without floating-point, time weighting or proxy inference.

Use a nonproducing history node that rejects unconfirmed transactions, currently`127.0.0.1:8890`. Native database-queue `get_upgrade_state` head IDs bound each read, with at most3attempts on a changing head. A producer may hold speculative changes under the same head and is unsuitable. Unknown WASM/ABI, native vote schema or precision is unavailable. Existing legacy EOS history interfaces remain unchanged.

The companion listens on`127.0.0.1:9053`, behind an exact history-domain route. It limits RPC concurrency to8, concurrent batches to2and cache entries to64with a10second TTL, coalescing identical requests. Missing or inconsistent data never becomes zero. HTTPS ingress owns CORS; the internal service does not duplicate its header. It loads no keys or wallets and permits no write RPC. The existing24hour observer does not need restarting.

Set`PUREEOS_CHAIN_ID`, optionally`PUREEOS_COMMITTED_RPC`, then run`python3 -B server.py`. Run`python3 -B -m unittest discover -v`. Deployment also requires checking source-node role, actual chain identity, HTTPS/CORS and browser integration.
