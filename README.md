# PureHistory · 纯粹的历史

PureHistory provides indexed blocks, transactions, inline actions, account history and state APIs for **PureEOS and legacy EOS**. It is derived from [Hyperion 4.1.0](https://github.com/eosrio/hyperion-history-api), with the original MIT license and attribution retained. Current version: **4.1.0-purehistory.1**.

PureHistory 为 **PureEOS 和旧 EOS** 提供区块、交易、内联操作、账户历史及状态查询。数据来自节点的 State History Plugin（SHIP），经解析后写入 Elasticsearch / MongoDB，并使用 RabbitMQ 和 Redis。链规则、余额、奖励、BP 处罚及最终性仍由节点和系统合约决定。

Source / 源码仓库：[MatrixCoreX/PureHistory](https://github.com/MatrixCoreX/PureHistory)

Production API / 正式 API：**https://purehistory-api.matrixai.one**

## Compatibility / 兼容方式

| System / 系统 | Tables / 系统表 | Voting response / 投票响应 |
| --- | --- | --- |
| PureEOS | `globalv2`, `producersv2`, `votersv2` | `vote_schema=integer-v2`; exact decimal strings in smallest token units; single choice, no proxy or time weighting / 最小单位整数字符串，单选，无代理及时间加权 |
| Legacy EOS / 旧 EOS | `global`, `producers`, `voters` | `vote_schema=legacy-eosio`; preserve numeric weights, proxy and producer lists / 保留原数值权重、代理及候选列表 |

The adapter detects the deployed system ABI. Unknown voting schemas fail explicitly instead of returning a misleading empty list. PureEOS integer votes do not pass through legacy floating-point fields. `100.1234 AIC` means `1001234` units at precision 4. Unsafe JavaScript integer inputs are rejected. Legacy values are read as recorded; PureHistory never recomputes time weighting or migrates votes.

适配器通过已部署系统 ABI 识别投票表。PureEOS 的 `weight`、`last_vote_amount` 和 `staked` 为字符串；旧 EOS 的 `weight`、`staked` 保留数字类型。旧 EOS 兼容验证使用真实 v1.8.3 ABI、模拟 RPC、真实 Fastify 序列化和队列组件检查；这不等同于完成所有旧 EOS 网络的线上认证。

## Build and run / 编译与运行

Use Node.js **22+**, npm, and Linux with compatible native `node-abieos` / uWebSockets libraries. The qualified deployment builds and runs in a pinned Node 22 Debian trixie container on Ubuntu **24.04.5 LTS**, avoiding host glibc mismatches. PureHistory itself has not been natively qualified on Ubuntu 26.04; PureEOS node qualification is separate.

使用 Node.js **22+**。原生依赖需匹配 glibc。当前服务器为 Ubuntu **24.04.5 LTS**，通过固定摘要的 Node 容器构建、运行；不要把 PureEOS 的 Ubuntu 26.04 验证范围直接套用于历史服务。

```bash
npm ci
npm run build
npm run test:compat
```

Copy `references/connections.ref.json` to `config/connections.json` and prepare it with authenticated, loopback-bound Elasticsearch, RabbitMQ, Redis, MongoDB and a node RPC/SHIP connection. Copy `references/config.ref.json` to your chain configuration. Keep credentials outside Git and readable only by the service user.

配置带认证且只监听本机的数据库、消息队列和节点 RPC/SHIP。连接配置放在 `config/connections.json`，链配置由 `references/config.ref.json` 复制生成；凭据不得提交 Git。

```bash
export CONFIG_JSON=config/chains/aic.config.json
node --enable-source-maps build/indexer/launcher.js
# Run in another managed process / 另一个受管理进程中运行
node --enable-source-maps build/api/server.js
```

For an existing index, enable `features.tables.voters`, seed voters with the matching adapter, and resume live indexing. The synchronizer reads the configured system contract and actual ABI table, not a hardcoded EOS table.

已有索引需开启 `features.tables.voters` 并同步投票表；操作时应暂停对应索引消费者，完成同步后恢复。不要启动两个消费者组去重复读取同一套历史队列。

```bash
node build/cli/hyp-control.js sync voters aic
```

## API examples / 接口示例

```text
/v2/health
/v2/state/get_system_profile
/v2/state/get_voters?limit=50&listProducers=true
/v2/history/get_transaction?id=TRANSACTION_ID
/v2/history/get_actions?account=ACCOUNT&filter=eosio.token:transfer&sort=asc&after=1&limit=50
/v2/state/get_tokens?account=ACCOUNT
/v1/chain/get_info
```

Ascending action history requires a block/date/sequence bound. A transaction ID query needs no block hint once indexing has caught up. Backfill completeness must be checked against queues and actual transaction IDs; a current header height alone does not prove that action indexing is complete.

升序历史查询须提供区块、时间或序列范围。交易完成索引后可以只用 ID 查询，无需传区块号。不能仅凭区块头高度判断回填完成，必须结合队列和实际交易核对。

The public deployment exposes read-only HTTPS routes with CORS and rate limits. Administration and dependencies remain on loopback. Current account/voter updates reject older deliveries and retain deletion tombstones; database failures requeue the submitted batch. These controls protect delivery ordering and do not replace upstream fork reconciliation.

当前部署公开只读 HTTPS API，启用 CORS 与限流，管理口和数据库仅监听本机。账户和投票状态防止旧消息覆盖新状态，并保留删除标记；写入失败会重新排队。此机制不替代分叉处理。

See [operations](docs/OPERATIONS.md) and [qualification](docs/QUALIFICATION_20261031.md) for exact deployment paths, evidence, compatibility scope and remaining review items.
