# PureHistory

[简体中文](README.md)

PureHistory provides indexed blocks, transactions, inline actions, account history and state APIs for **PureEOS and legacy EOS**. Current version: **1.0.0**.

It is derived from [Hyperion 4.1.0](https://github.com/eosrio/hyperion-history-api), with the original attribution and [MIT license](license.md) retained.

- Source: [MatrixCoreX/PureHistory](https://github.com/MatrixCoreX/PureHistory)
- History API: **https://purehistory-api.matrixai.one**
- Block explorer: https://aic.matrixai.one

## How it works

PureHistory consumes blocks, execution traces and state deltas from the node's State History Plugin (SHIP). It indexes the decoded data in Elasticsearch and MongoDB, using RabbitMQ for the indexing pipeline and Redis for caching.

The node and system contract remain authoritative for chain rules, balances, rewards, BP penalties and finality. The history service reads these results; it does not recompute voting policy or decide producer bans.

## PureEOS and legacy EOS compatibility

| System | System tables | Voting API |
| --- | --- | --- |
| PureEOS | `globalv2`, `producersv2`, `votersv2` | `vote_schema=integer-v2`; exact decimal strings in smallest token units |
| Legacy EOS | `global`, `producers`, `voters` | `vote_schema=legacy-eosio`; preserve numeric weights, proxy and producer lists |

The adapter detects the deployed system ABI. Unknown voting layouts fail explicitly rather than returning a misleading empty list.

PureEOS keeps single-choice voting without proxies or time weighting. Its `weight`, `last_vote_amount` and `staked` fields are strings, avoiding floating-point conversion. At precision 4, `100.1234 AIC` means `1001234` smallest units. Unsafe JavaScript integer inputs are rejected.

Legacy EOS `weight` and `staked` remain numeric. Proxy and weighted values are read as recorded on-chain; PureHistory does not recalculate time weighting or migrate votes.

## Build

Use Node.js **22+**, npm, and Linux with compatible native `node-abieos` and uWebSockets libraries. The qualified deployment builds and runs in a pinned Node **22.23.4 / Debian trixie** container on Ubuntu **24.04.5 LTS**, avoiding host glibc mismatches.

PureHistory itself has not been natively qualified on Ubuntu 26.04. PureEOS node operating-system qualification is recorded separately.

```bash
git clone https://github.com/MatrixCoreX/PureHistory.git
cd PureHistory
npm ci
npm run build
npm run test:compat
```

## Configure and run

Create `config/chains`. Copy `references/connections.ref.json` to `config/connections.json`, and `references/config.ref.json` to your chain configuration, such as `config/chains/aic.config.json`.

Configure authenticated, loopback-bound Elasticsearch, RabbitMQ, Redis and MongoDB, together with the node RPC and SHIP connections. Keep credentials readable only by the service user and outside Git. Voter state routes require MongoDB and `features.tables.voters` to be enabled.

```bash
export CONFIG_JSON=config/chains/aic.config.json
node --enable-source-maps build/indexer/launcher.js
```

Run the API in another managed process:

```bash
export CONFIG_JSON=config/chains/aic.config.json
node --enable-source-maps build/api/server.js
```

When enabling voting support on an existing index, synchronize the matching system table. The synchronizer pauses the corresponding consumers, reads the table selected by the system ABI, and resumes indexing. Do not start two indexer groups against the same queues.

```bash
node build/cli/hyp-control.js sync voters aic
```

## API examples

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

Ascending action history requires a block, date or sequence bound. Once indexing has caught up, a transaction ID query needs no block hint.

A current header height alone does not prove completed action backfill; check queues and actual transaction IDs. Current account/voter writes protect against delayed older deliveries and retain deletion tombstones. Database failures requeue the submitted batch. These controls do not replace fork reconciliation.

## Deployment and qualification scope

The public deployment exposes read-only HTTPS routes with CORS and rate limits. Administration and dependencies remain on loopback. Qualification covers the running PureEOS chain and authentic legacy EOS ABI, mocked RPC, serialization and queue components. Offline legacy evidence is not certification of every legacy EOS network.

See [qualification](docs/QUALIFICATION_20261031.md) for build/test scope, retained failures and follow-up items. See [operations](docs/OPERATIONS.md) for service paths, resource protection, certificate renewal and rollback.

The optional PureEOS full-chain BP and maintenance counter is documented in [BP summary](scripts/pureeos-producer-summary/README.md). It is integrated by a separate observer and is not automatically installed in the core API.

The read-only batch endpoint for registered BP total, self and other votes is documented in [Vote breakdown](scripts/pureeos-producer-votes/README.md). It checks the qualified PureEOS integer-vote profile and preserves exact amounts. Unqualified legacy EOS breakdowns remain unavailable; existing historical interfaces stay compatible.
