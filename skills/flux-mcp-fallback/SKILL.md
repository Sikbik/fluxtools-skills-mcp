---
name: flux-mcp-fallback
description: Use when Flux tasks need to run through the MCP server instead of the CLI, especially for interactive resource flows, connected MCP clients, or recovery when the CLI is unavailable.
---

# Flux MCP Fallback

Use this skill only when the workflow should run through `flux-mcp` instead of `fluxos-cli`.

## When to use MCP

Use MCP when:

- the user explicitly asked for MCP
- the client already has Flux MCP connected and tool use is the natural surface
- `resource_link` handling is materially better than CLI resource artifacts
- the CLI is unavailable, blocked, or needs troubleshooting help

Do not switch to MCP just to duplicate a CLI workflow.

## MCP operating rules

- prefer dedicated `flux_*` tools over `flux_request`
- if a tool returns `resource_link`, read it and summarize it
- use `flux_resource_read` if the client does not expose MCP resources directly
- keep mutations behind `confirm=true`
- keep direct mutating escape-hatch calls behind `allowMutation=true`

## High-value MCP fallback tools

- session and auth:
  - `flux_get_state`
  - `flux_resolve_gateway_node`
  - `flux_set_base_url_from_gateway`
  - `flux_auth_login`
  - `flux_auth_flow`
  - `flux_auth_diagnose`
- deployments:
  - `flux_apps_plan_registration`
  - `flux_apps_plan_update`
  - `flux_apps_register_and_verify`
  - `flux_apps_update_and_verify`
  - `flux_git_deploy_plan_registration`
  - `flux_git_deploy_register_and_verify`
- runtime:
  - `flux_apps_troubleshoot`
  - `flux_app_health_report`
  - `flux_apps_logs`
  - `flux_apps_inspect`
  - `flux_apps_exec`
- files and services:
  - `flux_apps_list_folder`
  - `flux_backup_list_local`
  - `flux_explorer_status`
  - `flux_daemon_get_info`
  - `flux_syncthing_metrics_health`

## References

- [README.md](/home/stache/projects/flux-skills/flux-mcp/README.md)
- [docs/execution-surface-policy.md](/home/stache/projects/flux-skills/docs/execution-surface-policy.md)
