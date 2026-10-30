# PureHistory · 纯粹的历史

[English](README.en.md)

PureHistory 为 **PureEOS 和旧 EOS** 提供区块、交易、内联操作、账户历史及状态查询。当前版本为 **4.1.0-purehistory.1**。

项目基于 [Hyperion 4.1.0](https://github.com/eosrio/hyperion-history-api)，保留原作者署名和 [MIT 许可证](license.md)。

- 源码仓库：[MatrixCoreX/PureHistory](https://github.com/MatrixCoreX/PureHistory)
- 历史 API：**https://purehistory-api.matrixai.one**
- 区块浏览器：https://aic.matrixai.one

## 工作方式

PureHistory 从节点的 State History Plugin（SHIP）读取区块、执行轨迹及状态变更，经解析后写入 Elasticsearch 和 MongoDB，并使用 RabbitMQ、Redis 提供索引流水线和查询缓存。

链规则、余额、奖励、BP 处罚及最终性仍由节点和系统合约决定。历史服务负责读取和查询，不重新执行投票政策，也不自行认定 BP 黑名单。

## PureEOS 与旧 EOS 兼容

| 系统 | 系统表 | 投票接口 |
| --- | --- | --- |
| PureEOS | `globalv2`、`producersv2`、`votersv2` | `vote_schema=integer-v2`，票数及质押采用最小代币单位的整数字符串 |
| 旧 EOS | `global`、`producers`、`voters` | `vote_schema=legacy-eosio`，保留原数值权重、代理及候选列表 |

适配器根据已部署系统 ABI 识别表结构。无法识别的投票结构会明确报错，不返回容易误解的空列表。

PureEOS 保持单选、无代理、无时间加权。接口中的 `weight`、`last_vote_amount`、`staked` 使用字符串，避免浮点转换。例如精度为 4 时，`100.1234 AIC` 对应 `1001234` 个最小单位。超过 JavaScript 安全整数范围的非精确数字输入会被拒绝。

旧 EOS 的 `weight`、`staked` 保留数字类型。其代理和权重按链上记录读取，PureHistory 不重新计算时间权重或迁移投票。

## 编译

使用 Node.js **22+**、npm，以及与原生 `node-abieos`、uWebSockets 库兼容的 Linux 环境。当前已验证的部署在 Ubuntu **24.04.5 LTS** 主机上，通过固定摘要的 Node **22.23.4 / Debian trixie** 容器构建、运行，以避免宿主机 glibc 差异。

PureHistory 尚未完成 Ubuntu 26.04 原生编译验证；PureEOS 节点的系统兼容验证范围与本项目分别记录。

```bash
git clone https://github.com/MatrixCoreX/PureHistory.git
cd PureHistory
npm ci
npm run build
npm run test:compat
```

## 配置与启动

创建 `config/chains` 目录，将 `references/connections.ref.json` 复制为 `config/connections.json`，将 `references/config.ref.json` 复制为对应链的配置文件，例如 `config/chains/aic.config.json`。

配置带认证且仅监听本机的 Elasticsearch、RabbitMQ、Redis、MongoDB，以及节点 RPC、SHIP 连接。凭据只允许服务用户读取，不得提交 Git。投票状态接口需要启用 MongoDB 和 `features.tables.voters`。

```bash
export CONFIG_JSON=config/chains/aic.config.json
node --enable-source-maps build/indexer/launcher.js
```

在另一个受管理进程中运行 API：

```bash
export CONFIG_JSON=config/chains/aic.config.json
node --enable-source-maps build/api/server.js
```

已有索引启用投票适配时，须同步对应系统表。同步工具会暂停相应消费者、按系统 ABI 读取投票表，再恢复索引。不要启动两组索引器重复消费同一套队列。

```bash
node build/cli/hyp-control.js sync voters aic
```

## 接口示例

```text
/v2/health
/v2/state/get_system_profile
/v2/state/get_voters?limit=50&listProducers=true
/v2/state/get_voter_scopes?term=node
/v2/history/get_transaction?id=TRANSACTION_ID
/v2/history/get_actions?account=ACCOUNT&filter=eosio.token:transfer&sort=asc&after=1&limit=50
/v2/state/get_tokens?account=ACCOUNT
/v1/chain/get_info
```

升序历史查询须提供区块、时间或序列范围。交易完成索引后可以只用 ID 查询，无需传区块号。

不能仅凭区块头高度判断历史回填完成，须结合队列和实际交易核对。当前账户及投票状态写入带有区块顺序保护和删除标记，数据库写入失败会重新排队；这些机制不替代分叉处理。

## 部署和验证范围

正式接口采用只读 HTTPS、CORS 和限流，管理端口与数据库仅监听本机。验证覆盖运行中的 PureEOS 链，以及真实旧 EOS ABI、模拟 RPC、序列化和队列组件；旧 EOS 的离线兼容证据不等同于所有旧 EOS 网络的线上认证。

编译、测试范围、原始失败记录和后续事项见[验证说明](docs/QUALIFICATION_20261031.md)。服务路径、资源保护、证书续期和回退方式见[运维说明](docs/OPERATIONS.md)。
