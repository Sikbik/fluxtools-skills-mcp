# `/flux/*` — Node + Flux Service APIs

This category exposes FluxOS/node-level information, connectivity, logs, and maintenance actions.

See the full list in `references/endpoints-inventory.md` (category: `flux`).

## Common read-only endpoints

```bash
API="http://<node-ip>:16127"

curl -sS "$API/flux/info"
curl -sS "$API/flux/version"
curl -sS "$API/flux/nodetier"
curl -sS "$API/flux/ip"
curl -sS "$API/flux/geolocation"
curl -sS "$API/flux/connectedpeers"
curl -sS "$API/flux/incomingconnections"
curl -sS "$API/flux/blockedports"
```

## ArcaneOS / enterprise detection

```bash
curl -sS http://<node-ip>:16127/flux/isarcaneos
```

See: `references/arcane-enterprise.md`.

## Logs

Flux exposes log helpers (often protected):

- `GET /flux/errorlog`, `GET /flux/warnlog`, `GET /flux/infolog`, `GET /flux/debuglog`
- Tail variants: `GET /flux/tailerrorlog`, `GET /flux/tailwarnlog`, ...

## Maintenance + updates (high impact)

Some `/flux/*` routes restart services or change node configuration (and are typically protected). Always confirm intent before invoking.

Examples:

- Restart Flux: `GET /flux/restart`
- Restart daemon: `GET /flux/restartdaemon`
- Update components: `GET /flux/updateflux`, `GET /flux/updatedaemon`, `GET /flux/updatebenchmark`
- Reindex daemon: `GET /flux/reindexdaemon`

Use `references/endpoints-inventory.md` to identify access level labels.
