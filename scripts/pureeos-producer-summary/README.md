# PureEOS BP 统计

`producer_summary.py` 是只读统计模块，由运行中的链观察服务提供 `/v2/state/get_producer_summary`。它不是独立 HTTP 服务；调用方提供原生 RPC 函数、当前 rotation 行和原生出块排班。部署前须核对已验证系统合约 WASM，未知版本返回不可用，不套用旧 EOS 规则。

统计完整分页读取 `producersv2`、`rotcands` 和 `bpmaint`。`maintenance_active_count` 只统计激活注册 BP 中状态为 2（维护已生效）的账户；`maintenance_pending_count` 统计状态为 1（等待交接）的账户。两者之和为 `maintenance_excluded_count`。已注销账户的旧维护记录不计入当前维护数量。永久封禁记录另行统计，保留历史注销 BP 的封禁。

等待交接的 BP 仍可能属于原生出块/确认委员会，必须保持在线；维护已生效后才可停机。原生在岗人数独立统计，不能由有效候选数或维护数量相减推导。关闭维护恢复候选资格，入岗仍遵守正常轮换。

本模块不修改维护状态、处罚、奖励或节点配置，也不推断在线进程数。容量增长时间由已核验的链上 slot 规则计算，实际链上状态优先。多次 RPC 读取不是固定区块快照。

测试：在本目录执行 `python3 -B -m unittest -v test_summary.py`。三个用例覆盖等待/生效的区别、注销记录和真实空表。

# PureEOS BP summary

`producer_summary.py` is a read-only module used by the live chain observer at `/v2/state/get_producer_summary`. It is not a standalone HTTP server: callers provide a native RPC function, the current rotation row and native proposer schedule. Verify the qualified system-contract WASM before deployment. Unsupported versions return unavailable rather than inferring legacy EOS rules.

It paginates all `producersv2`, `rotcands` and `bpmaint` rows. `maintenance_active_count` counts actively registered BPs in state 2 (effective maintenance); `maintenance_pending_count` counts state 1 (awaiting handoff). Their sum is `maintenance_excluded_count`. Old maintenance rows belonging to deregistered accounts are excluded. Permanent bans are counted separately, including historical bans of deregistered BPs.

A BP awaiting handoff may still be a native proposer/finalizer and must remain online. Shutdown is allowed only after maintenance becomes effective. Native membership is counted independently, not inferred by subtracting maintenance from eligible candidates. Cancelling maintenance restores candidacy; normal rotation still controls admission.

This module changes no maintenance flags, penalties, rewards or node configuration and does not infer online process counts. Estimated capacity growth follows qualified on-chain slot rules; actual chain state takes precedence. Multiple RPC reads are not a fixed-block snapshot.

Run `python3 -B -m unittest -v test_summary.py` in this directory. Three cases cover pending/effective separation, deregistered records and genuinely empty tables.
