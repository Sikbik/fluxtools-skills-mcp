---
name: flux-runtime-operations
description: Use for Flux app runtime debugging, health checks, logs, inspect, stats, top, monitoring, exec, lifecycle actions, and troubleshooting live apps.
---

# Flux Runtime Operations

Use this skill for node-local app runtime work.

## CLI-first workflow

Prefer:

- `flux apps list-running --json`
- `flux apps list-all --json`
- `flux apps global-status --appname <appname> --json`
- `flux apps troubleshoot <appname> --json`
- `flux apps health <appname> --json`
- `flux apps logs <appname> --json`
- `flux apps inspect <appname> --json`
- `flux apps stats <appname> --json`
- `flux apps top <appname> --json`
- `flux apps monitor <appname> --json`
- `flux apps exec <appname> --cmd ... --confirm --json`
- `flux apps start <appname> --confirm --json`
- `flux apps stop <appname> --confirm --json`
- `flux apps restart <appname> --confirm --json`
- `flux apps redeploy <appname> --confirm --json`
- `flux apps redeploy-component <appname> <component> --confirm --json`

## Guidance

- use global views for network-level state and `list-running` for the current node
- summarize runtime issues from troubleshoot and health before reaching for raw inspect payloads
- keep lifecycle mutations behind explicit confirmation
- prefer direct nodes for deep troubleshooting

## When to use MCP instead

Use MCP only when:

- the CLI is blocked
- you need interactive resource-backed payloads
- the user explicitly wants the MCP path

Relevant MCP tools:

- `flux_apps_list_running`
- `flux_apps_troubleshoot`
- `flux_app_health_report`
- `flux_apps_logs`
- `flux_logs_tail`
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

## References

- [lifecycle-observability.md](/home/stache/projects/flux-skills/codex/flux-cloud/references/lifecycle-observability.md)
- [troubleshooting.md](/home/stache/projects/flux-skills/codex/flux-cloud/references/troubleshooting.md)
