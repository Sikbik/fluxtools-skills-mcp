# Tooling map (MCP-first)

When the Flux MCP server is connected, prefer the dedicated tools first, then fall back to `flux_request`.

## Prefer dedicated tools

These tools encode Flux-specific workflow rules and safety checks:

- Auth/session: `flux_get_login_phrase`, `flux_build_zelidauth`, `flux_set_zelidauth`
- Node health: `flux_node_health`
- Register/update flow: `flux_apps_plan_registration`, `flux_apps_register`, `flux_apps_plan_update`, `flux_apps_update`, `flux_apps_get_messages`
- Lifecycle: `flux_apps_start/stop/restart/redeploy*` (require `confirm=true`)
- Observability: `flux_apps_logs/inspect/stats/top/monitor`
- Exec: `flux_apps_exec` (requires `confirm=true`)
- Files: `flux_apps_list_folder`, `flux_apps_download_*` (mutations require `confirm=true`)

## Use `flux_request` for edge cases

Use `flux_request` when:

- the API endpoint is not yet wrapped by a dedicated tool
- you need a niche daemon/flux/syncthing endpoint
- you are testing a new endpoint from the generated inventory

Rules:

- Mutating calls require `allowMutation=true`.
- Use `responseType=base64` for downloads.
