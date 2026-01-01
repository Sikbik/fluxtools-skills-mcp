# `/explorer/*` — Chain/Explorer APIs

Explorer routes provide blockchain-derived data (UTXOs, balances, transactions) and (for higher privileges) indexer controls.

See the full list in `references/endpoints-inventory.md` (category: `explorer`).

## Common read-only endpoints

```bash
API="http://<node-ip>:16127"

curl -sS "$API/explorer/balance/<address>"
curl -sS "$API/explorer/utxo/<address>"
curl -sS "$API/explorer/transactions/<address>"
curl -sS "$API/explorer/scannedheight"
```

## Indexer controls (protected)

Depending on the node and privilege level, routes may exist for:

- Reindexing: `GET /explorer/reindex/...`
- Rescanning: `GET /explorer/rescan/...`
- Start/stop processing: `GET /explorer/restart`, `GET /explorer/stop`

Always confirm intent before invoking these.
