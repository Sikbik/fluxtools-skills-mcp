# `/syncthing/*` — Syncthing Service APIs

FluxOS integrates Syncthing for data synchronization. The node API exposes status/configuration helpers under `/syncthing/*`.

See the full list in `references/endpoints-inventory.md` (category: `syncthing`).

## Quick health

```bash
API="http://<node-ip>:16127"

curl -sS "$API/syncthing/metrics"
curl -sS "$API/syncthing/metrics/health"
```

## Common operations

Examples (availability may depend on node version and access level):

- View status/config: `GET /syncthing/status`, `GET /syncthing/config`
- Devices/folders: `GET /syncthing/devices`, `GET /syncthing/folders`
- Restart/repair: `GET /syncthing/restart`, `GET /syncthing/rescan`, `GET /syncthing/upgrade`

Use `references/endpoints-inventory.md` for the authoritative list and access section labels.
