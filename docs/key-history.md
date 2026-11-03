# Public-key wallet history

`GET /v2/history/get_key_transactions?public_key=PUB_K1_...`

Read-only history of `eosio.key` custody-wallet events, scoped to the selected
K1 public key. Legacy `EOS...` and `PUB_K1_...` encodings share one identity.
Native accounts using that key remain separate accounts and balances.

Optional parameters: `asset=contract:precision,SYMBOL`,
`kind=all|deposit|ksend|withdraw|cancel`, `direction=all|in|out`,
`after`/`before` (ISO timestamps), and `cursor`. Pages contain at most 20 events.
Cursor bindings include the chain, key, filters, index generation and upper
receipt sequence. They are pagination boundaries, not immutable database snapshots.

Each event identifies the native transaction and receipt action ordinal, both
parties, token contract/precision/symbol, exact atomic principal delta, exact
application fee, fee payer, relay BP and owner-request memo. All atomic amounts
and sequences are decimal strings. A recipient does not pay the sender's fee.
An AIC asset filter includes a USD sender's AIC fee; the USD recipient's view
does not include that AIC charge. Native fee-credit funding/refunds and relay
earnings claims do not become virtual-key ledger entries.

The off-chain projector runs `scripts/index-key-history.mjs` with
`HISTORY_ROOT`, `HISTORY_CHAIN`, `EXPECTED_CHAIN_ID` and
`EXPECTED_KEY_CODE_HASH`. It reads existing private connection configuration
in place, consumes indexed wallet receipts, checks successful canonical
transactions in referenced irreversible blocks, resolves public keys through
wallet tables and writes idempotent per-participant documents to
`<chain>-key-history-v1`. No contract tables, on-chain RAM, signatures or payments
are added. Only the API process needs a restart to load the new route.

Run the worker as a single managed instance with a CPU/memory limit. The initial
version repeats bounded receipt passes (default 25 receipts per request, 10-second
spacing, at least 30 seconds between passes) to reconcile late source indexing.
This trades freshness for low load as the receipt set grows. Before serving a
larger production chain, qualify throughput and incremental reconciliation;
current TEST deployment is not a history-service capacity benchmark.

An initial or missing index returns 503, not an empty successful history.
Source/contract identity changes pause projection for explicit compatibility
review. Previously published events remain available with a paused/stale marker.
`indexing.scanned_irreversible_block` describes a completed pass over the source
index, not proof that source history is complete. The response always labels
coverage as `indexed_receipts` and `complete_lifetime_history: false`.

Validation: compile with the qualified Node/TypeScript runtime and run
`npm run test:compat`; live acceptance must compare API events with canonical
receipts and verify the source chain and wallet code pins.
