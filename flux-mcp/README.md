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

- Node.js >= 20
- A Flux node API base URL:
  - Direct node (recommended): `http://<node-ip>:16127`
  - Public gateway: `https://api.runonflux.io`

Common gotcha:
- `https://cloud.runonflux.com/` is the UI, not the node API base URL.

## Build (one-time)

From the repo root:

```bash
cd flux-mcp
npm ci
npm run build
```

(If you prefer `npm install`, that also works — `npm ci` is just reproducible.)

This produces: `dist/index.js`

Default behavior: if `FLUX_API_BASE_URL` is not set, the MCP server uses `https://api.runonflux.io`.

## Connect your MCP client

### Claude Code (CLI)

```bash
claude mcp add --transport stdio \
  --env FLUX_API_BASE_URL=https://api.runonflux.io \
  flux -- \
  node /absolute/path/to/flux-skills/flux-mcp/dist/index.js
```

Verify:

```bash
claude mcp list
claude mcp get flux
```

In the Claude Code UI, you can also run:

```
/mcp
```

### Claude Desktop

Open Claude Desktop, then:

1) Settings -> Developer -> Edit Config
2) Add a server entry (example below)
3) Restart Claude Desktop

```json
{
  "mcpServers": {
    "flux": {
      "command": "node",
      "args": ["/absolute/path/to/flux-skills/flux-mcp/dist/index.js"],
      "env": {
        "FLUX_API_BASE_URL": "https://api.runonflux.io"
      }
    }
  }
}
```

### Gemini CLI

Option A: use the CLI command (writes settings for you):

```bash
gemini mcp add -s user \
  -e FLUX_API_BASE_URL=https://api.runonflux.io \
  flux node /absolute/path/to/flux-skills/flux-mcp/dist/index.js
```

Option B: edit your settings file directly:

- User scope: `~/.gemini/settings.json`
- Project scope: `.gemini/settings.json`

```json
{
  "mcpServers": {
    "flux": {
      "command": "node",
      "args": ["/absolute/path/to/flux-skills/flux-mcp/dist/index.js"],
      "env": {
        "FLUX_API_BASE_URL": "https://api.runonflux.io"
      }
    }
  }
}
```

Verify:

```bash
gemini mcp list
```

In Gemini CLI, you can also run:

```
/mcp
```

Notes:
- Use an absolute path for `dist/index.js`.
- If `gemini mcp` is not available yet, use the settings file method.

### Codex (CLI + IDE)

Codex supports MCP in both the CLI and IDE extension. Configuration is shared via `~/.codex/config.toml`.

Option A: use the CLI:

```bash
codex mcp add flux \
  --env FLUX_API_BASE_URL=https://api.runonflux.io -- \
  node /absolute/path/to/flux-skills/flux-mcp/dist/index.js
```

Verify:

```bash
codex mcp list
```

In the Codex TUI, use:

```
/mcp
```

Note: `/mcp` is list-only in the Codex TUI. To add or edit servers, use `codex mcp` or edit `~/.codex/config.toml`.

Option B: edit `~/.codex/config.toml`:

```toml
[mcp_servers.flux]
command = "node"
args = ["/absolute/path/to/flux-skills/flux-mcp/dist/index.js"]

[mcp_servers.flux.env]
FLUX_API_BASE_URL = "https://api.runonflux.io"
```

### Other MCP clients (stdio)

If your client supports stdio MCP servers, point it at:

- Command: `node /absolute/path/to/flux-skills/flux-mcp/dist/index.js`
- Environment: `FLUX_API_BASE_URL=https://api.runonflux.io`

## Run standalone (debug)

```bash
FLUX_API_BASE_URL="https://api.runonflux.io" node dist/index.js
# or, direct node:
# FLUX_API_BASE_URL="http://<node-ip>:16127" node dist/index.js
```

## Configuration

Environment variables:

- `FLUX_API_BASE_URL` (default: `https://api.runonflux.io`)
  - direct node API: `http://<node-ip>:16127`
- `FLUX_ZELIDAUTH` (optional): pre-set auth header value (JSON string)
- `FLUX_ENTERPRISE_KEY` (optional): enterprise-key header value (base64 RSA-encrypted AES key)
- `FLUX_HTTP_TIMEOUT_MS` (optional): default `30000`
- `FLUX_ENDPOINTS_PATH` (optional): override the bundled endpoints inventory path

You can also set base URL and `zelidauth` at runtime via tools.

## Common workflow: authenticate once

Fastest path is to use the planner tool and follow its steps:

- `flux_auth_flow` (optionally pass `gatewayBaseUrl`)

Manual path:

1) Set the node base URL (if not set via env):

- `flux_set_base_url`

2) Get a login phrase:

- `flux_get_login_phrase` (or `flux_get_emergency_phrase`)

3) User signs the phrase in their wallet, then verify + store `zelidauth`:

- `flux_verify_login`
- `flux_build_zelidauth`
- `flux_set_zelidauth`

## Enterprise-key flow (Arcane nodes)

1) (If needed) get original owner:

- `flux_request { "path": "/apps/apporiginalowner/<app>" }`

2) Fetch RSA public key:

- `flux_apps_get_public_key { "owner": "<zelid>", "name": "<app>" }`

3) Generate header value:

- `flux_enterprise_key_generate { "publicKey": "<base64>" }`

4) Set header:

- `flux_set_enterprise_key { "enterpriseKey": "<base64>" }`

5) Fetch decrypted spec:

- `flux_apps_get_spec { "appname": "<app>", "decrypt": true }`

Shortcut: `flux_enterprise_preflight { "appname": "<app>" }` does steps 1–4 and can optionally verify decrypt.

Note: the `enterprise` field is AES-256-GCM encrypted; use the returned `aesKeyBase64` to decrypt it (nonce = first 12 bytes, tag = last 16 bytes).

## Signing tips

- Planning tools now return:
  - `messageToSignRaw` (exact bytes to sign)
  - `messageToSignSha256` (checksum)
  - `messageToSignBase64` (safe transport)
- To avoid terminal wrapping, use:
  - `flux_write_message_to_sign { "path": "./message-to-sign.txt", "messageToSign": "<raw>", "confirm": true }`

## Resources + large payloads

Many tools return `resource_link` blocks instead of dumping large JSON/log payloads into the chat.

- If your client supports MCP resources, use `resources/read` with the URI.
- Otherwise, use `flux_resource_read` with the same `uri`.
- Use `flux_resource_prune` to clear stored dynamic resources.

## Tool catalog

### Session + auth

- `flux_get_state` — show base URL + whether `zelidauth` is present + HTTP defaults.
- `flux_set_base_url` — set `http://<node-ip>:16127`.
- `flux_set_http_defaults` — set timeout/retry defaults.
- `flux_auth_flow` — plan a step-by-step auth flow.
- `flux_auth_diagnose` — preflight checks + actionable next steps.
- `flux_get_login_phrase` / `flux_get_emergency_phrase` — fetch phrase for ZelID signing.
- `flux_verify_login` — establish a node session.
- `flux_check_privilege` — confirm privilege level.
- `flux_build_zelidauth` — create header JSON string.
- `flux_set_zelidauth` / `flux_clear_zelidauth` — manage stored auth.
- `flux_set_enterprise_key` / `flux_clear_enterprise_key` — manage enterprise-key header for renewals.
- `flux_enterprise_key_generate` — create enterprise-key header value + AES key from a public key.
- `flux_enterprise_preflight` — fetch public key + generate enterprise-key + (optional) decrypt check.
- `flux_write_message_to_sign` — write raw messageToSign to a file (avoid terminal wrapping).
- `flux_resource_read` — read resource URI content.
- `flux_resource_prune` — prune/clear dynamic resources.

### Endpoint discovery

- `flux_list_endpoint_categories` — counts by category (daemon/apps/flux/syncthing/etc).
- `flux_search_endpoints` — keyword search over paths/comments/access (table + `resource_link`).

### Generic API caller

- `flux_request`
  - `path`: `/flux/info`, `/apps/applog`, etc.
  - `method`: defaults to `GET`.
  - `query`: object → query string.
  - `body`: JSON body for POST.
  - `allowMutation=true`: required for mutating calls.
  - `enterpriseKey`: override enterprise-key header for this request (optional).
  - `responseType=base64`: for downloads (returns base64 + headers).

### Node

- `flux_node_health` — fetch `/flux/version`, `/flux/info`, `/flux/isarcaneos`.

### Apps: discovery + metadata

- `flux_apps_list_running` — `GET /apps/listrunningapps`.
- `flux_apps_list_all` — `GET /apps/listallapps`.
- `flux_apps_list_global_specs` — `GET /apps/globalappsspecifications` (filter by `owner` to list apps registered under a ZelID).
- `flux_apps_list_by_zelid_with_expiry`
  - Default behavior uses `zelidauth.zelid` if set.
  - Options: `includeExpired` (default false), `limit` (default 50, max 200).
  - Output: Markdown table + JSON summary + `resource_link`.
- `flux_apps_get_spec` — `GET /apps/appspecifications/<appname>`.
- `flux_apps_get_public_key` — `POST /apps/getpublickey` (requires zelidauth + Arcane node).
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
- `flux_apps_register_and_verify` — submit + poll propagation (optional).
- `flux_apps_plan_update` — verify + price + build `messageToSign` and payload scaffold.
- `flux_apps_plan_renew` — compute expire + verify + price + build `messageToSign` and payload scaffold.
- `flux_apps_update` — submit `POST /apps/appupdate` (requires owner signature + `zelidauth`).
- `flux_apps_update_and_verify` — submit + poll propagation (optional).
- `flux_apps_get_messages` — check `temporarymessages` / `permanentmessages` for a hash.
- `flux_apps_wait_for_propagation` — poll temporary/permanent messages for a hash.

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
- `flux_syncthing_metrics_health` (table + `resource_link`)
- `flux_syncthing_system_status`
- `flux_syncthing_list_folders` (table + `resource_link`)
- `flux_syncthing_list_devices` (table + `resource_link`)
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

- MCP tools not showing: ensure Node.js 20+, run `npm ci && npm run build` in `flux-mcp/`, use an absolute path, then restart the client.
- Connection errors: verify the node API is reachable at `http://<node-ip>:16127` (not the UI port `16126`).
- Base URL missing/invalid → call `flux_set_base_url` or set `FLUX_API_BASE_URL`.
- Auth failures → get a fresh phrase, re-sign, and update `zelidauth`.
- Signature mismatch → always use verify endpoints (`flux_apps_plan_*`) so JSON canonicalization matches what the node verifies.
- Download too large → increase `maxBytes` for `*_download_*` tools or download a smaller path.
