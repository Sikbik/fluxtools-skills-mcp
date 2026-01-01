# Flux MCP

An MCP (Model Context Protocol) server that exposes **Flux Cloud / FluxOS node API** workflows as tools.

This server is designed to be the “execution layer” behind the Claude/Codex skills in this repo:

- deterministic outputs for signing flows
- safe-by-default behavior for state changes
- endpoint discovery/search for the full node API surface

## Safety model

FluxOS exposes many endpoints as `GET` routes (including state-changing actions). This MCP server is built to reduce accidental mutations:

- High-level mutating tools require **`confirm=true`**.
- The generic escape hatch (`flux_request`) requires **`allowMutation=true`** for mutating endpoints.

## Requirements

- Node.js >= 18

## Install & build

```bash
cd flux-mcp
npm install
npm run build
```

Run:

```bash
FLUX_API_BASE_URL="http://<node-ip>:16127" node dist/index.js
# or, via the public gateway:
# FLUX_API_BASE_URL="https://api.runonflux.io" node dist/index.js
```

## Connect from Claude Code

```bash
claude mcp add --transport stdio flux -- \
  node /absolute/path/to/flux-skills/flux-mcp/dist/index.js
```

Useful commands:

```bash
claude mcp list
claude mcp get flux
```

## Connect from Claude Desktop

```json
{
  "mcpServers": {
    "flux": {
      "command": "node",
      "args": ["/absolute/path/to/flux-skills/flux-mcp/dist/index.js"],
      "env": {
        "FLUX_API_BASE_URL": "http://<node-ip>:16127"
      }
    }
  }
}
```

## Configuration

Environment variables:

- `FLUX_API_BASE_URL`:
  - direct node API (recommended): `http://<node-ip>:16127`
  - public gateway: `https://api.runonflux.io`
- `FLUX_ZELIDAUTH` (optional): pre-set auth header value (JSON string)
- `FLUX_HTTP_TIMEOUT_MS` (optional): default `30000`
- `FLUX_ENDPOINTS_PATH` (optional): override the bundled endpoints inventory path

You can also set base URL and `zelidauth` at runtime via tools.

## Common workflow: authenticate once

1) Set the node base URL (if not set via env):

- `flux_set_base_url`

2) Get a login phrase:

- `flux_get_login_phrase`

3) User signs the phrase in their wallet, then build + store `zelidauth`:

- `flux_build_zelidauth`
- `flux_set_zelidauth`

## Tool catalog

### Session + auth

- `flux_get_state` — show base URL + whether `zelidauth` is present.
- `flux_set_base_url` — set `http://<node-ip>:16127`.
- `flux_get_login_phrase` — fetch phrase for ZelID signing.
- `flux_build_zelidauth` — create header JSON string.
- `flux_set_zelidauth` / `flux_clear_zelidauth` — manage stored auth.

### Endpoint discovery

- `flux_list_endpoint_categories` — counts by category (daemon/apps/flux/syncthing/etc).
- `flux_search_endpoints` — keyword search over paths/comments/access.

### Generic API caller

- `flux_request`
  - `path`: `/flux/info`, `/apps/applog`, etc.
  - `method`: defaults to `GET`.
  - `query`: object → query string.
  - `body`: JSON body for POST.
  - `allowMutation=true`: required for mutating calls.
  - `responseType=base64`: for downloads (returns base64 + headers).

### Node

- `flux_node_health` — fetch `/flux/version`, `/flux/info`, `/flux/isarcaneos`.

### Apps: discovery + metadata

- `flux_apps_list_running` — `GET /apps/listrunningapps`.
- `flux_apps_list_all` — `GET /apps/listallapps`.
- `flux_apps_get_spec` — `GET /apps/appspecifications/<appname>`.
- `flux_apps_get_owner` — `GET /apps/appowner/<appname>`.
- `flux_apps_registration_information` — `GET /apps/registrationinformation`.
- `flux_apps_deployment_information` — `GET /apps/deploymentinformation`.

### Apps: create/verify/price/register/update (network-level)

- `flux_generate_app_spec_v8` — generate a minimal v8 single-component spec.
- `flux_apps_verify_registration_spec` — canonicalize for registration.
- `flux_apps_verify_update_spec` — canonicalize for update.
- `flux_apps_calculate_price` — price estimate.

High-level signing workflow helpers:

- `flux_apps_plan_registration` — verify + price + build `messageToSign` and payload scaffold.
- `flux_apps_register` — submit `POST /apps/appregister` (requires owner signature + `zelidauth`).
- `flux_apps_plan_update` — verify + price + build `messageToSign` and payload scaffold.
- `flux_apps_update` — submit `POST /apps/appupdate` (requires owner signature + `zelidauth`).
- `flux_apps_get_messages` — check `temporarymessages` / `permanentmessages` for a hash.

### Apps: lifecycle (requires `confirm=true`)

- `flux_apps_start`
- `flux_apps_stop`
- `flux_apps_restart`
- `flux_apps_redeploy`
- `flux_apps_redeploy_component`

### Apps: observability

- `flux_apps_logs`
- `flux_apps_inspect`
- `flux_apps_stats`
- `flux_apps_top`
- `flux_apps_monitor`
- `flux_apps_exec` (requires `confirm=true`)

### Apps: files (volume browser)

Read-only:

- `flux_apps_list_folder`
- `flux_apps_download_file` (base64)
- `flux_apps_download_folder` (base64 zip)

Mutating (requires `confirm=true`):

- `flux_apps_create_folder`
- `flux_apps_rename_object`
- `flux_apps_remove_object`

### Syncthing

Read-only:

- `flux_syncthing_metrics`
- `flux_syncthing_metrics_health`
- `flux_syncthing_system_status`
- `flux_syncthing_list_folders`
- `flux_syncthing_list_devices`
- `flux_syncthing_db_browse`

Mutating (requires `confirm=true` and usually admin/fluxteam privileges):

- `flux_syncthing_db_scan`
- `flux_syncthing_restart`

## Common workflow: register a new app

1) Build or provide a v8 spec:

- `flux_generate_app_spec_v8`

2) Plan the registration (canonicalize + price + signing payload):

- `flux_apps_plan_registration`

3) User signs the returned `messageToSign` with the OWNER ZelID.

4) Submit registration:

- `flux_apps_register`

5) Monitor message propagation:

- `flux_apps_get_messages`

## Common workflow: update an app

1) Fetch current spec:

- `flux_apps_get_spec`

2) Modify desired fields.

3) Plan update:

- `flux_apps_plan_update`

4) User signs `messageToSign`.

5) Submit update:

- `flux_apps_update`

## Troubleshooting

- “Base URL not set” → call `flux_set_base_url` or set `FLUX_API_BASE_URL`.
- Auth failures → get a fresh phrase, re-sign, and update `zelidauth`.
- Signature mismatch → always use verify endpoints (`flux_apps_plan_*`) so JSON canonicalization matches what the node verifies.
- Download too large → increase `maxBytes` for `*_download_*` tools or download a smaller path.
