---
name: flux-cloud
description: Use when deploying, updating, operating, or troubleshooting Flux apps and FluxOS nodes. Prioritizes using the Flux MCP server tools for safe, deterministic API workflows (register/update signing flow, lifecycle ops, logs, files, syncthing), with curl fallbacks.
---

# Flux Cloud (FluxOS) — Claude Code Skill

Use this skill when the user wants to interact with Flux Cloud / FluxOS:

- Check node health / services
- Create, register, and update apps (v8 specs)
- Operate apps (start/stop/redeploy) and gather logs/inspect/stats
- Browse app volumes and download files
- Inspect Syncthing status and folder state

## Preferred toolchain: Flux MCP

If the Flux MCP server is available, prefer MCP tools over ad-hoc curl:

- Deterministic outputs (message-to-sign, payload scaffolds)
- Safer defaults (mutating calls require `allowMutation=true` or `confirm=true`)
- Endpoint discovery/search built in

Setup instructions: `references/mcp-setup.md`.

## First questions (always ask)

1) Node API base URL (direct node): `http://<node-ip>:16127`
2) What the user is allowed to do (read-only vs lifecycle/system changes)
3) App name and component name (if composed)
4) Owner ZelID/Flux address (never ask for private keys)

## Safety rules

- Do not run lifecycle/system actions unless the user explicitly confirms.
- Prefer the dedicated MCP tools for lifecycle and file mutations (they require `confirm=true`).
- For any generic API call that changes state, require `allowMutation=true`.

## Core workflows (MCP-first)

### 1) Node health

- Use `flux_node_health`.

### 2) Get ZelID login phrase and set `zelidauth`

- Use `flux_get_login_phrase` → user signs phrase → use `flux_build_zelidauth` + `flux_set_zelidauth`.

### 3) Create a v8 app spec

- Use `flux_generate_app_spec_v8` to build a minimal spec.
- Then canonicalize with `flux_apps_verify_registration_spec` or `flux_apps_verify_update_spec`.

Reference: `references/app-spec-v8.md`.

### 4) Register a new app (network-level)

1) `flux_apps_plan_registration` → returns `messageToSign` and `payload` scaffold.
2) User signs `messageToSign` with the OWNER ZelID.
3) `flux_apps_register` with `signature` + `timestamp`.
4) Use `flux_apps_get_messages` to watch propagation by hash.

Reference: `references/register-update.md`.

### 5) Update an existing app (network-level)

1) Fetch current spec (MCP: `flux_apps_get_spec`).
2) Edit desired fields.
3) `flux_apps_plan_update` → user signs → `flux_apps_update`.
4) `flux_apps_get_messages`.

### 6) Operate an app (lifecycle + observability)

- Lifecycle (requires confirmation): `flux_apps_start`, `flux_apps_stop`, `flux_apps_restart`, `flux_apps_redeploy`, `flux_apps_redeploy_component`.
- Observability: `flux_apps_logs`, `flux_apps_inspect`, `flux_apps_stats`, `flux_apps_top`, `flux_apps_monitor`.

### 7) Files (volume browser)

- List: `flux_apps_list_folder`
- Download (base64): `flux_apps_download_file`, `flux_apps_download_folder`
- Mutations (require confirmation): `flux_apps_create_folder`, `flux_apps_rename_object`, `flux_apps_remove_object`

### 8) Syncthing

- Health/metrics: `flux_syncthing_metrics`, `flux_syncthing_metrics_health`, `flux_syncthing_system_status`
- Folders/devices: `flux_syncthing_list_folders`, `flux_syncthing_list_devices`
- Browse DB: `flux_syncthing_db_browse`
- Trigger scan/restart (requires confirmation): `flux_syncthing_db_scan`, `flux_syncthing_restart`

## Fallback: direct HTTP calls

If MCP is not available, use curl against `http://<node-ip>:16127`.

- Quick overview: `references/api-overview.md`
- Full endpoint inventory (Flux source-derived): `https://github.com/RunOnFlux/flux/blob/master/ZelBack/src/routes.js`

## References

- `references/mcp-setup.md` — connect Flux MCP to Claude Code/Desktop
- `references/api-overview.md` — base URLs, auth header shape, health checks
- `references/app-spec-v8.md` — v8 spec template + rules
- `references/register-update.md` — signing + register/update flow

- `references/prompts.md` — example prompts
- `references/tooling-map.md` — which MCP tools to use
