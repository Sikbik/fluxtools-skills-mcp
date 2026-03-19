# Flux MCP

Flux MCP is the interactive MCP surface in this repo's broader Flux tooling stack. It exposes Flux Cloud / FluxOS workflows as MCP tools with safer defaults, higher-level planning helpers, signing support, endpoint discovery, and resource-backed outputs for large payloads.

It is designed for day-to-day operations, not just toy demos. You can use it to deploy apps, renew apps, inspect live containers, browse volumes, manage backups, query daemon and explorer data, operate Syncthing, and work through enterprise app flows from one MCP server. Signing and payment helpers support both Zelcore and SSP Wallet.

In the current repository model, `fluxos-cli` is the default surface for agentic shell workflows, while `flux-mcp` remains the supported option for interactive MCP clients, `resource_link`-heavy sessions, and recovery paths when the CLI is unavailable or needs help.

See [docs/execution-surface-policy.md](/home/stache/projects/flux-skills/docs/execution-surface-policy.md) for the shared routing policy.

## Capability Surface

| Domain | What the server covers |
| --- | --- |
| Auth and session control | ZelID login flow, `zelidauth` management, privilege checks, gateway pinning, browser-friendly signing launchers for Zelcore and SSP Wallet, and enterprise-key workflows. |
| App delivery | Spec generation, Git deploy planning, verification, pricing, exact signing payloads, registration, update, renew, payment guidance, and propagation checks. |
| App operations | Running and global app discovery, lifecycle controls, runtime resolution, troubleshooting, health reporting, and maintenance helpers. |
| Runtime observability | Logs, container inspect, stats, top, monitoring, and in-container command execution. |
| Storage and backups | App volume browsing and mutation, local backup operations, FluxDrive task management, and upload helpers. |
| Chain and daemon analytics | Explorer height and sync checks, balances, rescans, reindex/restart controls, and daemon, network, peer, mempool, and difficulty queries. |
| Syncthing | Metrics, health, folder and device inventory, DB browsing, scan triggers, and restarts. |
| Endpoint discovery | Generated route inventory search and category summaries sourced from upstream Flux routes. |

## Safety Model

FluxOS exposes a lot of power behind HTTP endpoints, including mutating endpoints that are still represented as `GET` routes. This server adds guardrails:

- High-level mutating tools require `confirm=true`.
- The generic escape hatch, `flux_request`, requires `allowMutation=true` for mutating requests.
- Large outputs are moved into MCP resources instead of dumping raw payloads into the conversation.
- Auth flows can resolve the gateway to its active direct node before you sign and bind credentials.

## Requirements

- Node.js 20+
- A Flux node API base URL:
  - direct node: `http://<node-ip>:16127`
  - public gateway: `https://api.runonflux.io`

Common gotcha:

- `https://cloud.runonflux.com/` is the Flux UI, not the node API base URL.

## One-Command Setup

Packaged Codex install:

```bash
npm i -g fluxtools
fluxtools install codex
fluxtools install claude
fluxtools install opencode
fluxtools install gemini
```

Repo-local setup:

From the repo root:

```bash
node scripts/setup.js
```

This will build `flux-mcp` if needed and print ready-to-paste configuration snippets for supported MCP clients.

## Build

From the repo root:

```bash
cd flux-mcp
npm ci
npm run build
```

This produces `dist/index.js`.

Default behavior:

- if `FLUX_API_BASE_URL` is not set, the server uses `https://api.runonflux.io`

## Connect Your MCP Client

### Claude Code

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

### Claude Desktop

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

CLI:

```bash
gemini mcp add -s user \
  -e FLUX_API_BASE_URL=https://api.runonflux.io \
  flux node /absolute/path/to/flux-skills/flux-mcp/dist/index.js
```

Or `~/.gemini/settings.json` / `.gemini/settings.json`:

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

If you use the packaged toolkit, `fluxtools install gemini` installs an extension bundle that already declares the bundled Flux MCP server.

### Codex

CLI:

```bash
codex mcp add flux \
  --env FLUX_API_BASE_URL=https://api.runonflux.io -- \
  node /absolute/path/to/flux-skills/flux-mcp/dist/index.js
```

Or `~/.codex/config.toml`:

```toml
[mcp_servers.flux]
command = "node"
args = ["/absolute/path/to/flux-skills/flux-mcp/dist/index.js"]

[mcp_servers.flux.env]
FLUX_API_BASE_URL = "https://api.runonflux.io"
```

### OpenCode

Add this to `~/.config/opencode/opencode.json`:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "mcp": {
    "flux": {
      "type": "local",
      "command": ["node", "/absolute/path/to/flux-skills/flux-mcp/dist/index.js"],
      "enabled": true,
      "environment": {
        "FLUX_API_BASE_URL": "https://api.runonflux.io"
      }
    }
  }
}
```

If you use the packaged toolkit, `fluxtools install opencode` writes that OpenCode MCP configuration for you.

### Other stdio MCP clients

Point the client at:

- command: `node /absolute/path/to/flux-skills/flux-mcp/dist/index.js`
- env: `FLUX_API_BASE_URL=https://api.runonflux.io`

## High-Value Workflows

### Authenticate once, then reuse the session

Recommended flow:

1. `flux_auth_login { "zelid": "<ZELID>" }`
2. Click the returned `signLauncherHttpUrl` or `zelcoreLauncherHttpUrl`.
3. Sign the login phrase.
4. `flux_auth_login { "zelid": "<ZELID>", "loginPhrase": "<PHRASE>", "signature": "<SIGNATURE>" }`

Alternative helpers:

- `flux_auth_flow`
- `flux_auth_diagnose`
- `flux_build_zelidauth`
- `flux_set_zelidauth`

### Plan and register a new app

1. Build or supply a v8 spec.
2. `flux_apps_plan_registration`
3. Open `messageToSignResourceUri` and sign the exact bytes.
4. `flux_apps_register`
5. Run `flux_apps_test_install`
6. Use `paymentLauncherHttpUrl` or `flux_build_payment_launcher`
7. Poll propagation with `flux_apps_get_messages` or `flux_apps_wait_for_propagation`

Related helpers:

- `flux_generate_app_spec_v8`
- `flux_git_deploy_generate_spec_v8`
- `flux_git_deploy_plan_registration`
- `flux_git_deploy_register_and_verify`

### Update or renew an existing app

1. `flux_apps_get_spec`
2. Apply the desired changes or renewal policy.
3. `flux_apps_plan_update` or `flux_apps_plan_renew`
4. Sign the returned `messageToSign`
5. `flux_apps_update` or `flux_apps_update_and_verify`

Useful companions:

- `flux_apps_verify_update_spec`
- `flux_apps_calculate_price`
- `flux_apps_global_status`

### Operate a live app

- `flux_app_health_report`
- `flux_apps_logs`
- `flux_apps_inspect`
- `flux_apps_stats`
- `flux_apps_top`
- `flux_apps_monitor`
- `flux_apps_exec`
- `flux_apps_start`
- `flux_apps_stop`
- `flux_apps_restart`
- `flux_apps_redeploy`
- `flux_apps_redeploy_component`

### Analyze chain and network state

- `flux_node_health`
- `flux_explorer_status`
- `flux_explorer_height_info`
- `flux_explorer_balance_summary`
- `flux_daemon_get_info`
- `flux_daemon_get_blockchain_info`
- `flux_daemon_get_network_info`
- `flux_daemon_get_peer_info`
- `flux_daemon_get_mempool_info`
- `flux_daemon_get_raw_mempool`
- `flux_daemon_get_block_count`
- `flux_daemon_get_connection_count`
- `flux_daemon_get_difficulty`

### Work with files, backups, and FluxDrive

- `flux_apps_list_folder`
- `flux_apps_download_file`
- `flux_apps_download_folder`
- `flux_apps_create_folder`
- `flux_apps_rename_object`
- `flux_apps_remove_object`
- `flux_backup_get_volume_data`
- `flux_backup_get_remote_file_size`
- `flux_backup_list_local`
- `flux_backup_remove_file`
- `flux_backup_download_local_file`
- `flux_fluxdrive_register_backup_file`
- `flux_fluxdrive_get_task_status`
- `flux_fluxdrive_get_backup_list`
- `flux_fluxdrive_remove_checkpoint`

## Signing, Launchers, and Payment UX

This server includes several quality-of-life features for signing-heavy Flux workflows.

- Planning tools return `messageToSignResourceUri`, `messageToSignSha256`, and `messageToSignBytes`.
- `flux_auth_login` returns browser-friendly launcher URLs when available.
- `flux_write_sign_launcher` writes an HTML signing page that supports both Zelcore and SSP Wallet.
- `flux_build_zelcore_sign_link` builds raw Zelcore deeplinks and can upload oversized payloads to Flux Storage.
- `flux_build_payment_launcher` builds a localhost payment page for SSP Wallet payment flows, while the broader signing UX still supports both Zelcore and SSP Wallet.
- `flux_write_message_to_sign` writes the exact signing bytes to disk when you want to avoid terminal wrapping.

Typical options:

- view the raw message via MCP resources
- use the localhost sign launcher
- use the localhost payment launcher
- use the raw Zelcore deeplink
- write the message to disk

## Resources and Large Payloads

Many tools return `resource_link` blocks instead of inlining huge payloads.

- If your client supports MCP resources, use `resources/read`.
- Otherwise use `flux_resource_read`.
- Use `flux_resource_prune` to clear or prune stored resources.

This is especially useful for:

- long logs
- decrypted specs
- message-to-sign payloads
- endpoint search results
- monitoring and inspect payloads
- backup and download metadata

## Configuration

Environment variables supported by the server and client layers:

- `FLUX_API_BASE_URL` - default node API base URL
- `FLUX_ZELIDAUTH` - optional preloaded `zelidauth`
- `FLUX_ENTERPRISE_KEY` - optional preloaded enterprise-key header
- `FLUX_ENDPOINTS_PATH` - override bundled endpoint inventory
- `FLUX_HTTP_TIMEOUT_MS` - default HTTP timeout
- `FLUX_HTTP_RETRY_COUNT` - default retry count
- `FLUX_HTTP_RETRY_BACKOFF_MS` - default retry backoff
- `FLUXDRIVE_MWS_BASE_URL` - FluxDrive MWS base URL override
- `FLUX_MCP_LOCAL_LAUNCHER` - enable or disable localhost launcher pages
- `FLUX_MCP_OSC8_LINKS` - enable or disable OSC8 terminal hyperlinks
- `FLUX_MCP_ALLOW_SECRETS` - allow or block secret-bearing env output in enterprise spec inspection
- `FLUX_MCP_RESOURCE_TTL_MS` - dynamic resource retention window
- `FLUX_MCP_RESOURCE_MAX_ENTRIES` - max number of stored dynamic resources
- `FLUX_MCP_VERBOSE_TOOL_SCHEMA` - return full tool schemas without compaction

Runtime setters are also available:

- `flux_set_base_url`
- `flux_set_base_url_from_gateway`
- `flux_set_http_defaults`
- `flux_fluxdrive_set_base_url`
- `flux_set_zelidauth`
- `flux_set_enterprise_key`

## Capability Catalog

### Session, auth, and enterprise

- `flux_get_state`
- `flux_resolve_gateway_node`
- `flux_set_base_url_from_gateway`
- `flux_set_http_defaults`
- `flux_auth_flow`
- `flux_auth_login`
- `flux_auth_diagnose`
- `flux_set_base_url`
- `flux_set_zelidauth`
- `flux_clear_zelidauth`
- `flux_get_login_phrase`
- `flux_get_emergency_phrase`
- `flux_verify_login`
- `flux_check_privilege`
- `flux_build_zelidauth`
- `flux_set_enterprise_key`
- `flux_clear_enterprise_key`
- `flux_enterprise_key_generate`
- `flux_enterprise_preflight`
- `flux_enterprise_decrypt`
- `flux_build_message_to_sign`
- `flux_build_zelcore_sign_link`
- `flux_write_message_to_sign`
- `flux_write_sign_launcher`
- `flux_build_payment_launcher`
- `flux_resource_read`
- `flux_resource_prune`

### Endpoint discovery and escape hatches

- `flux_list_endpoint_categories`
- `flux_search_endpoints`
- `flux_request`

### Node, explorer, and daemon analytics

- `flux_node_health`
- `flux_explorer_height_info`
- `flux_explorer_status`
- `flux_explorer_balance_summary`
- `flux_explorer_restart`
- `flux_explorer_stop`
- `flux_explorer_reindex`
- `flux_explorer_rescan`
- `flux_daemon_call`
- `flux_daemon_get_info`
- `flux_daemon_get_blockchain_info`
- `flux_daemon_get_network_info`
- `flux_daemon_get_peer_info`
- `flux_daemon_get_mempool_info`
- `flux_daemon_get_raw_mempool`
- `flux_daemon_get_block_count`
- `flux_daemon_get_connection_count`
- `flux_daemon_get_difficulty`

### App discovery and metadata

- `flux_apps_list_running`
- `flux_apps_list_all`
- `flux_apps_list_global_specs`
- `flux_apps_global_status`
- `flux_apps_troubleshoot`
- `flux_apps_list_by_zelid_with_expiry`
- `flux_apps_get_spec`
- `flux_apps_get_spec_full`
- `flux_apps_get_public_key`
- `flux_apps_get_owner`
- `flux_apps_registration_information`
- `flux_apps_deployment_information`

### Spec generation, Git deploy, pricing, and planning

- `flux_generate_app_spec_v8`
- `flux_git_deploy_generate_spec_v8`
- `flux_git_deploy_plan_registration`
- `flux_git_deploy_register_and_verify`
- `flux_apps_verify_registration_spec`
- `flux_apps_verify_update_spec`
- `flux_apps_calculate_price`
- `flux_apps_plan_registration`
- `flux_apps_signing_playbook`
- `flux_apps_plan_update`
- `flux_apps_plan_renew`
- `flux_apps_append_backup_task`
- `flux_apps_append_restore_task`
- `flux_maintenance_checklist`

### Registration, update, and propagation

- `flux_apps_register`
- `flux_apps_register_and_verify`
- `flux_apps_test_install`
- `flux_apps_update`
- `flux_apps_update_and_verify`
- `flux_apps_get_messages`
- `flux_apps_wait_for_propagation`

### Lifecycle, observability, and runtime control

- `flux_apps_start`
- `flux_apps_stop`
- `flux_apps_restart`
- `flux_apps_redeploy`
- `flux_apps_redeploy_component`
- `flux_apps_resolve_runtime_target`
- `flux_apps_logs`
- `flux_logs_tail`
- `flux_apps_inspect`
- `flux_apps_stats`
- `flux_apps_top`
- `flux_apps_monitor`
- `flux_apps_exec`
- `flux_app_health_report`

### Files, uploads, and backups

- `flux_apps_list_folder`
- `flux_apps_download_file`
- `flux_apps_download_folder`
- `flux_apps_create_folder`
- `flux_apps_rename_object`
- `flux_apps_remove_object`
- `flux_backup_get_volume_data`
- `flux_backup_get_remote_file_size`
- `flux_backup_list_local`
- `flux_backup_remove_file`
- `flux_backup_download_local_file`
- `flux_ioutils_file_upload`
- `flux_ioutils_file_upload_from_url`
- `flux_fluxdrive_set_base_url`
- `flux_fluxdrive_register_backup_file`
- `flux_fluxdrive_get_task_status`
- `flux_fluxdrive_get_backup_list`
- `flux_fluxdrive_remove_checkpoint`

### Syncthing

- `flux_syncthing_metrics`
- `flux_syncthing_metrics_health`
- `flux_syncthing_system_status`
- `flux_syncthing_list_folders`
- `flux_syncthing_list_devices`
- `flux_syncthing_db_browse`
- `flux_syncthing_db_scan`
- `flux_syncthing_restart`

## Troubleshooting

- Tools not showing up: run `npm ci && npm run build`, use an absolute path to `dist/index.js`, then restart the MCP client.
- Wrong node or gateway weirdness: set a direct node with `flux_set_base_url` or resolve one with `flux_set_base_url_from_gateway`.
- Auth problems: use `flux_auth_diagnose`, then fetch a fresh phrase and rebuild `zelidauth`.
- Signature mismatch: use the plan and verify helpers so the spec is canonicalized before signing.
- Launcher URLs not appearing: ensure `FLUX_MCP_LOCAL_LAUNCHER` is not disabled.
- Large JSON or logs overwhelming the chat: read the returned `resource_link` instead of expanding everything inline.
- Enterprise decrypt flow failing: confirm you are on an Arcane node and that the owner and public key resolution steps succeeded.
