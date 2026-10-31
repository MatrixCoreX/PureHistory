# 服务端 24 小时最高 TPS

独立只读 Python 服务，从原生 get_info/get_block 获取最终确认区块，验证连续高度和父区块 ID，将每块全部 receipt 数量保存于 SQLite。窗口为服务器当前 UTC 时间向前 24 小时；每块 receipt 数除以固定区块间隔，峰值到期可以下降。初次补齐期间返回 HTTP503，不输出不完整峰值。链身份不符会停止提供统计，不会混用新旧链。兼容提供这两个原生接口的 PureEOS/EOS；不依赖浏览器、SHIP 或具体系统合约。

使用 Python3.10+：

```sh
python3 peak_tps.py --rpc http://127.0.0.1:8888 --chain-id CHAIN_ID --data-dir /var/lib/purehistory-peak-tps --port 9052 --block-interval-ms 500
```

将 HTTPS 的 GET /v2/stats/get_peak_tps 转发到本机9052。服务只监听127.0.0.1，不接受任意统计窗口或写链接口。运维配置需明确提供实际 Chain ID；更换链使用新的数据目录。运行测试：`python3 -B -m unittest -v test_peak_tps.py`。这是单块峰值，不代表持续TPS。

# Server-side 24-hour peak TPS

This read-only Python service retrieves irreversible native blocks with get_info/get_block, checks contiguous heights and parent IDs, and persists complete receipt counts in SQLite. The rolling window ends at current server UTC. TPS equals native receipt count per fixed block interval; expired peaks may fall. Initial backfill returns HTTP503 rather than a partial peak. A changed chain identity makes statistics unavailable instead of mixing chains. Compatible with PureEOS/EOS native endpoints; no browser storage, SHIP or system-contract assumptions.

Use Python3.10+ and the command above, replacing CHAIN_ID with the actual identity. Proxy HTTPS GET /v2/stats/get_peak_tps to loopback9052; the service binds only127.0.0.1, exposes no arbitrary windows or chain writes. Use a new data directory for a new chain. Run `python3 -B -m unittest -v test_peak_tps.py`. This single-block peak is not sustained throughput.
