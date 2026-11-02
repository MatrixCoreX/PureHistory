# Retained high-spec deployment source

This branch preserves the actual historical deployment source before retirement
of 66.245.195.50 on the user's instruction. It starts at
`2837894d40fb8e58866fb7c7def62717ad714785` and includes the server's producer-summary
allowlist for deployed BP-bond WASM
`b591ca661e8256b7d1c7370fe11e5825427c98b4f84eceb3cdf735c06e5e8170`.

The adjacent patch preserves the local Hyperion controller loopback binding
against upstream `eosrio/hyperion-history-api` commit
`a11de79438a26434ea9024a89d877efa8272e22d`.

These files were retrieved from the deployed server and retained without
rewriting later development branches or changing the low-cost testnet.
This is historical source retention, not a new release or qualification.
No chain/block/state databases, wallets or private configuration are included.
