# PureHistory operations / 运维

Canonical API: `https://purehistory-api.matrixai.one`. Existing explorer: `https://aic.matrixai.one`; the explorer application is maintained separately.

The retained EPYC 4345P server runs the chain without restart or configuration changes. History dependencies/data and service orchestration live under `/opt/pureeos-hyperion-20261031`; the separately versioned PureHistory source lives under `/opt/purehistory-dual-compat-20261031/source`. Do not delete either directory while services reference it.

```bash
systemctl status purehistory.service
systemctl status pureeos-hyperion-resource-guard.timer
curl -fsS https://purehistory-api.matrixai.one/v2/health
curl -fsS https://purehistory-api.matrixai.one/v2/state/get_system_profile
```

Use `systemctl stop/start purehistory.service` (`pureeos-hyperion.service` is its retained internal unit name) for the whole history stack. Its stop helper first requests a graceful indexer stop, then stops history containers; it does not stop nodeos. Do not blindly apply Docker restart policies to the indexer, which intentionally stops for certain upstream modes. Investigate a stopped indexer before resuming it.

Public requests are handled by `/etc/nginx/conf.d/purehistory-api.conf`. Dependencies, original RPC, SHIP and the indexer controller bind loopback only. Certificates use HTTP ACME through Cloudflare; renewal deploy hooks validate and reload nginx. Do not expose database or controller ports to make health checks pass.

Data directories, `.env`, `secrets.json`, and authenticated connection files stay on the server with restricted access. Never publish them in Git or copy them into test reports. Keep the original immutable workload/canonical receipt evidence; reporting copies contain only results and hashes.

The history resource guard stops indexing if free disk falls below 80 GiB or available memory below 8 GiB. It does not automatically resume. Diagnose growth and retain chain headroom before resuming.

Rollback: retain `compose.pre-purehistory.json` and the prior source directory. Gracefully stop the current indexer, restore the prior compose and API configuration, then restart history services. The prior upstream voter route must remain guarded because it does not support PureEOS votersv2. Never reset the chain or overwrite its WASM as part of history rollback.

Full backups must capture persistent databases consistently, the source/version manifest and protected configuration separately. Retaining test evidence is not a database disaster-recovery backup.
