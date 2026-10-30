# PureHistory 4.1.0-purehistory.1 qualification

The adapter targets the running PureEOS AIC system contract and standard legacy EOS table layouts. It changes the history service only; it does not deploy chain contracts or alter voting, rewards, resource caps, BP duties or finality.

## Code and component evidence

- Clean `npm ci` and TypeScript build: PASS on the retained Ubuntu 24.04.5 host in pinned Node 22.23.4 / Debian trixie.
- 18 offline compatibility/failure checks: PASS. These include the actual PureEOS ABI, the unchanged EOS system v1.8.3 ABI, alias/inheritance handling, int64 boundaries, unsafe-number rejection, single-choice/no-proxy validation, legacy proxy/weight preservation, real Fastify serialization, both voter-scope paths, deserializer-to-queue owner identity/deletions, Mongo failure propagation and ES batch/duplicate-ID acknowledgments.
- Real MongoDB integration: PASS for stale-after-new deliveries, deletion tombstones, retries/replays, concurrent updates and exact vote strings. Its isolated qualification collection is removed after testing.
- Original 930,000 pure and 650,000 mixed transaction IDs: PASS, all unique with original canonical block positions. Ten actual ID-only transaction lookups include AMM, NFT, REX and PowerUp inline actions. Ascending account history passes with an explicit range.
- PureEOS voter state: all **1,608** authoritative rows match Mongo and the API exactly, including producer selection and string-encoded smallest-unit stakes/votes.
- Dependency audit: initially 17 findings (13 high, 2 moderate, 2 low); after pinned updates and a clean rebuild, **0 high, 0 moderate, 2 low** remain. The remaining advisories concern `@wharfkit/antelope` and its `elliptic` dependency. Replacing the legacy SDK major version requires separate compatibility work; this deployment exposes no signing endpoint.

## Deployment qualification and migration

Current-token state reconstruction completed successfully before application promotion. The original upstream account-state writer allowed delayed older rows to replace newer state and acknowledged failed/unsubmitted batches. The first comparison flagged **9,840** entries out of **16,023** original canonical balances. Five were correctly absent zero-balance rows that the initial verifier treated too strictly; current RPC confirmed zero. The remaining **9,835** entries contained stale state. Sample mismatches were independently confirmed against current node RPC. Indexed transaction receipts themselves passed the full ID audit.

This version adds monotonic account/voter updates, deletion tombstones, correct error propagation and per-message batch acknowledgments. Existing wrong rows must still be repaired: these guards cannot retroactively restore previously overwritten values. A bounded, read-only node RPC scan rebuilt **16,021** token-account rows while the old history indexer was gracefully stopped. All **16,016** nonzero AIC balances matched original settled evidence, and all **7** zero balances were independently checked through RPC. The final verifier checks all **16,023** original accounts with correct absent-zero semantics. Nodeos remains running. Final deployment status and current-state revalidation are recorded separately in the deployment receipt under `performance-results/`.

Original failed checks are retained: an unbounded ascending-history query, a dependency override conflict, missing test-fixture configuration, a verifier startup race, protected evidence-file permissions and the real stale-account discovery. They are not counted as passes; corrected checks are recorded separately.

## Scope limits

Legacy EOS qualification is fixture/RPC-mock/component evidence, not a live old EOS network or all third-party system-contract forks. PureEOS is tested against the running chain. No new pressure workload or node TPS measurement is part of this history qualification. The source remains derived from Hyperion 4.1.0 (`a11de79438a26434ea9024a89d877efa8272e22d`), with attribution/license and existing parsing paths retained.

Monotonic writes protect against delivery reordering; they do not redesign upstream canonical-fork reconciliation. Permission/dynamic-table ordering, publisher confirms/persistence throughout all downstream queues, full action-pipeline watermarks, multi-chain Redis namespaces and chain-specific BP monitoring remain review items. BP monitoring stays disabled because legacy missed-slot metrics are not the PureEOS permanent-ban authority. A current header height is not sufficient proof of completed action backfill.

The source/build/test logs and full result JSON stay on the retained server at `/opt/purehistory-dual-compat-20261031`; protected connection files and database credentials are excluded from Git and reports.
