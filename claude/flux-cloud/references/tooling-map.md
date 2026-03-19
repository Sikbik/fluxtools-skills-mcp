# Tooling Map (CLI-first)

Use one primary surface per workflow.

Default order:

1. `fluxos-cli` / `flux`
2. `flux-mcp`
3. raw HTTP

## Prefer the CLI for most work

These command families should be the normal first choice:

- Session and auth:
  - `flux node resolve-gateway`
  - `flux node use-gateway`
  - `flux node use-base-url`
  - `flux auth phrase`
  - `flux auth login`
  - `flux auth status`
  - `flux auth diagnose`
- App discovery and ownership:
  - `flux apps list-global`
  - `flux apps global-status`
  - `flux apps list-running`
  - `flux apps by-zelid`
  - `flux apps get-owner`
  - `flux apps get-spec`
  - `flux apps get-spec-full`
- Planning and submission:
  - `flux apps generate-spec`
  - `flux apps verify-registration`
  - `flux apps verify-update`
  - `flux apps calculate-price`
  - `flux apps plan-registration`
  - `flux apps plan-update`
  - `flux apps register`
  - `flux apps update`
  - `flux apps register-and-verify`
  - `flux apps update-and-verify`
  - `flux apps messages`
  - `flux apps wait-propagation`
  - `flux git generate-spec`
  - `flux git plan-registration`
  - `flux git register-and-verify`
- Runtime and lifecycle:
  - `flux apps troubleshoot`
  - `flux apps health`
  - `flux apps logs`
  - `flux apps inspect`
  - `flux apps stats`
  - `flux apps top`
  - `flux apps monitor`
  - `flux apps exec`
  - `flux apps start`
  - `flux apps stop`
  - `flux apps restart`
  - `flux apps redeploy`
  - `flux apps redeploy-component`
- Files, backup, and FluxDrive:
  - `flux files list`
  - `flux files download`
  - `flux files download-folder`
  - `flux files mkdir`
  - `flux files rename`
  - `flux files remove`
  - `flux backup volume-data`
  - `flux backup list-local`
  - `flux backup download-local`
  - `flux fluxdrive task-status`
- Explorer, daemon, and Syncthing:
  - `flux explorer status`
  - `flux explorer height`
  - `flux daemon info`
  - `flux daemon network-info`
  - `flux daemon peer-info`
  - `flux syncthing metrics-health`
  - `flux syncthing system-status`
  - `flux syncthing list-folders`

## Use MCP when the CLI is not the right fit

Prefer MCP when:

- the user explicitly wants MCP
- the client already has strong MCP support
- the task benefits from `resource_link` behavior
- the CLI is unavailable, failing, or stuck

Key MCP fallback tools:

- Session and auth:
  - `flux_get_state`
  - `flux_auth_login`
  - `flux_auth_flow`
  - `flux_auth_diagnose`
- App planning and submission:
  - `flux_apps_plan_registration`
  - `flux_apps_plan_update`
  - `flux_apps_register`
  - `flux_apps_update`
  - `flux_apps_register_and_verify`
  - `flux_apps_update_and_verify`
- Runtime and lifecycle:
  - `flux_apps_troubleshoot`
  - `flux_app_health_report`
  - `flux_apps_logs`
  - `flux_apps_inspect`
  - `flux_apps_exec`
  - `flux_apps_start`
  - `flux_apps_stop`
  - `flux_apps_restart`
  - `flux_apps_redeploy`
- Files and services:
  - `flux_apps_list_folder`
  - `flux_apps_download_file`
  - `flux_backup_list_local`
  - `flux_explorer_status`
  - `flux_daemon_get_info`
  - `flux_syncthing_metrics_health`

## Use generic escape hatches sparingly

CLI:

- `flux tool list --json`
- `flux tool call <tool-name> --args-file <path> --json`
- `flux resource read <uri> --json`

MCP:

- prefer dedicated `flux_*` tools before `flux_request`
- use `flux_resource_read` when a returned `resource_link` needs to be read explicitly

## Rules

- Keep `--json` as the default contract for machine-consumed CLI output.
- Mutations still require explicit confirmation.
- Do not repeat the same operation on CLI and MCP unless there is a real fallback reason.
