# 链上历史最高 TPS

独立只读 Python 服务，从原生 get_info/get_block 读取全部已最终确认区块，验证从创世起连续的高度和父区块 ID，将每块全部 receipt 数保存于 SQLite。链上历史最高 TPS 为历史最大 receipt 数除以固定区块间隔；没有24小时到期窗口，不使用浏览器缓存。首次补齐期间返回503，不以不完整记录宣称历史最高。链身份不符会停止提供统计。PureEOS/EOS 均可使用，不依赖系统合约、SHIP 或浏览器。

Python3.10+运行：

```sh
python3 peak_tps.py --rpc http://127.0.0.1:8888 --chain-id CHAIN_ID --data-dir /var/lib/purehistory-peak-tps --port 9052 --block-interval-ms 500
```

HTTPS只读接口：`GET /v2/stats/get_peak_tps?scope=all_time`。原有默认24h查询保留兼容，显式`scope=24h`也可用。只监听本机9052，将HTTPS请求转发到该端口。配置明确提供实际 Chain ID；新链使用新数据目录。要求原生RPC保留从创世起的区块；裁剪节点无法补齐时不伪造完整覆盖。`python3 -B -m unittest -v test_peak_tps.py`运行9项测试。最高单块TPS不代表持续吞吐量。

# All-time on-chain peak TPS

This read-only Python service retrieves every irreversible native block from genesis with get_info/get_block, verifies contiguous heights and parent IDs, and persists complete receipt counts in SQLite. The lifetime peak is the largest native block receipt count divided by the fixed block interval. It does not expire after24hours and uses no browser storage. Initial backfill returns503 instead of claiming a complete peak. Changed chain identities make statistics unavailable. Compatible with native PureEOS/EOS APIs, independently of SHIP and system contracts.

Use Python3.10+ and the command above with the actual Chain ID. Query HTTPS GET `/v2/stats/get_peak_tps?scope=all_time`; the original default and explicit`scope=24h`remain compatible. Proxy to loopback9052. A new chain requires a new data directory. Native RPC must retain blocks from genesis; incomplete/pruned sources cannot claim full coverage. Run the9tests with `python3 -B -m unittest -v test_peak_tps.py`. Single-block peak is not sustained throughput.
