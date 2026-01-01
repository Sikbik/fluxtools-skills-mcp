# `/daemon/*` — Daemon RPC Proxy APIs

The `/daemon/*` routes expose a large set of RPC-style methods (chain, mempool, network, wallet, etc.).

See the full list in `references/endpoints-inventory.md` (category: `daemon`).

## Typical read-only diagnostics

```bash
API="http://<node-ip>:16127"

curl -sS "$API/daemon/getinfo"
curl -sS "$API/daemon/getblockchaininfo"
curl -sS "$API/daemon/getnetworkinfo"
curl -sS "$API/daemon/getmempoolinfo"

# Flux node network data
curl -sS "$API/daemon/getfluxnodestatus"
curl -sS "$API/daemon/listfluxnodes"
```

## Wallet and transaction endpoints (high impact)

Some daemon routes can create/sign/broadcast transactions or affect wallet state. Treat these as **mutating** operations and require explicit confirmation.

To find them quickly, search `references/endpoints-inventory.md` for:

- `send`, `wallet`, `sign`, `rawtransaction`, `import`, `dump`, `key`

## Route shapes

Many daemon routes accept optional path parameters:

- `GET /daemon/getblock/<hashheight?>/<verbosity?>`
- `GET /daemon/getrawtransaction/<txid?>/<verbose?>`

Prefer URL-encoding when passing hashes/txids in path parameters.
