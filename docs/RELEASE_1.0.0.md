# PureHistory 1.0.0

## 简体中文

当前首版名称为 PureHistory，基于 Hyperion 4.1.0，保留上游署名与 MIT 许可。支持 PureEOS 的 integer-v2 单选整数投票表及旧 EOS 的原始投票结构，按部署 ABI 识别，旧 EOS 不改写为 PureEOS 的投票政策。

配套 PureEOS 1.0.0 包含 7 天开发者升级审查，以及永久封禁 BP 不占候选排名容量。PureHistory 只读取链上结果，不参与提案、否决、封禁或最终性。可选统计和票数拆分模块支持已核验的 373b66 系统 WASM 与 038ffb 序列化 ABI；总票权、自投、他投保留整数精度；自投按投票账号身份认定。

35 项模块/兼容测试已通过（12 票数、5 统计、18 旧 EOS 兼容）。实际部署 Python 模块读取新合约重放状态也通过；这不冒称在隔离测试链重新执行完整 SHIP/Elasticsearch 索引。Node.js 22 容器构建及 Ubuntu 支持范围仍按 README 的具体记录。

源码、构建和发行包摘要见发行清单。配置凭据、钱包、私钥、节点状态库不包含在源码或发行资产中。发布 Git 版本不会重置已有历史或自动改动正在运行的服务。

## English

PureHistory 1.0.0 is based on Hyperion 4.1.0 with upstream attribution and MIT terms retained. ABI-detected PureEOS integer-v2 single-choice voting and legacy EOS vote schemas remain distinct. Legacy EOS weights/proxies are preserved.

The matching PureEOS release provides seven-day developer upgrade review and excludes permanent bans before ranked candidate-capacity counting. PureHistory reads chain decisions; it never proposes, vetoes, bans or finalizes. Optional summaries and exact vote-breakdown modules qualify WASM373b66/packed ABI038ffb. Self votes mean voting-account identity, independent of funding origin.

35 existing checks passed: 12 vote-breakdown, 5 summary and 18 legacy compatibility cases. Actual deployed Python modules also read the new-contract replay state successfully; this is not an isolated-chain full SHIP/Elasticsearch reindex claim. Node.js/container and Ubuntu scope remain documented precisely in the READMEs. Release manifests bind source/build/assets; credentials, keys, wallets and node databases are excluded. Publishing a Git release does not reset history or automatically restart services.
