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

## First questions (ask only if missing)

1) Node API base URL (direct node preferred for node-local ops): `http://<node-ip>:16127`
   - If the user didn’t provide it, start with `flux_get_state` and only ask if you can’t proceed.
2) What the user is allowed to do (read-only vs lifecycle/system changes)
3) App name and component name (if composed)
4) Owner ZelID/Flux address (never ask for private keys)

## Safety rules

- Do not run lifecycle/system actions unless the user explicitly confirms.
- Prefer the dedicated MCP tools for lifecycle and file mutations (they require `confirm=true`).
- For any generic API call that changes state, require `allowMutation=true`.

## Standard operating procedure (SOP)

- Prefer dedicated `flux_*` tools over `flux_request`.
- When a tool returns `resource_link`, read it (MCP `resources/read`) and summarize.
- If the client UI does not expose MCP resources, use `flux_resource_read` with the same URI.
- Keep chat output compact: summarize first, then only quote relevant snippets.

## Core workflows (MCP-first)

### 1) Node health

- Use `flux_node_health`.

### 2) Get ZelID login phrase and set `zelidauth`

- This signature is separate from the app registration/update signature; authenticate before asking the user to sign the app message.
- Prefer `flux_auth_login` (minimal steps): `flux_auth_login { zelid }` → user signs phrase → `flux_auth_login { zelid, loginPhrase, signature }`.
- Or use `flux_auth_flow` for a step-by-step plan (optionally pass `gatewayBaseUrl` to start from `https://api.runonflux.io` and resolve the current node).
- If the user’s terminal won’t open `zel:` links, use:
  - `flux_write_zelcore_launcher { messageResourceUri, confirm: true }` (returns a clickable `http://127.0.0.1:...` launcher URL).

### 3) Create a v8 app spec

- Use `flux_generate_app_spec_v8` to build a minimal spec.
- Then canonicalize with `flux_apps_verify_registration_spec` or `flux_apps_verify_update_spec`.

Reference: `references/app-spec-v8.md`.

### 4) Register a new app (network-level)

1) `flux_apps_plan_registration` → returns summary + `resource_link`:
   - `messageToSignResourceUri` (raw message to sign)
   - `resourceUri` (full plan)
2) User signs `messageToSign` (open `messageToSignResourceUri`) with the OWNER ZelID.
   - Optional (Zelcore): `flux_build_zelcore_sign_link { "messageResourceUri": "<messageToSignResourceUri>", "useFluxStorage": true, "confirm": true }`
3) `flux_apps_register` with `signature` + `timestamp`.
4) `flux_apps_test_install` with the registration hash (requires `confirm=true`).
5) Pay the registration fee to the address from `flux_apps_register_and_verify.payment.address` (or from `flux_apps_plan_registration.payment.address`). Amount is available as `payment.amountFlux`. Memo must be the registration hash.
6) Use `flux_apps_get_messages` to watch propagation by hash.

Reference: `references/register-update.md`.

### 4b) Git deployments (Orbit)

Flux Git deployments (formerly Orbit) register a normal v8 app spec that uses `runonflux/orbit:latest`.

- Prefer:
  - `flux_git_deploy_plan_registration`
- For private repos:
  - pass `repoToken` + `enterprise: true` + `confirm: true` (credentials are encrypted into `spec.enterprise`)
- After signing:
  - Prefer `flux_git_deploy_register_and_verify` (takes the plan `resourceUri`, so you don’t paste the spec)

Reference: `../../codex/flux-cloud/references/git-deployments.md`.

### 5) Update an existing app (network-level)

1) Fetch current spec (MCP: prefer `flux_apps_get_spec_full` so enterprise apps are handled automatically).
   - For enterprise v8+ apps, this returns decrypted `compose` + `contacts` for inspection (requires `zelidauth`).
   - Secrets (passwords/tokens) are redacted by default; only include them if the user explicitly asks:
     - Call with `{ includeSecrets: true, confirm: true }`.
     - Ops kill-switch: start the MCP server with `FLUX_MCP_ALLOW_SECRETS=0` to disable secrets output entirely.
2) Edit desired fields.
3) `flux_apps_plan_update` → user signs (open `messageToSignResourceUri`) → `flux_apps_update`.
4) `flux_apps_get_messages`.

### 6) Operate an app (lifecycle + observability)

- Lifecycle (requires confirmation): `flux_apps_start`, `flux_apps_stop`, `flux_apps_restart`, `flux_apps_redeploy`, `flux_apps_redeploy_component`.
- Observability: `flux_logs_tail`, `flux_app_health_report`, `flux_apps_logs`, `flux_apps_inspect`, `flux_apps_stats`, `flux_apps_top`, `flux_apps_monitor`.
  - Prefer `flux_apps_logs { appname: "<global app name>" }` to auto-resolve the correct container on the correct node.

### 7) Files (volume browser)

- List: `flux_apps_list_folder`
- Download (base64): `flux_apps_download_file`, `flux_apps_download_folder`
- Mutations (require confirmation): `flux_apps_create_folder`, `flux_apps_rename_object`, `flux_apps_remove_object`
  - `component` is the *compose component name* (e.g. `server`), not the Docker container name. If the user pastes a container name like `fluxserver_<appname>`, the MCP will try to derive the component automatically.

### 8) Syncthing

- Health/metrics: `flux_syncthing_metrics`, `flux_syncthing_metrics_health`, `flux_syncthing_system_status`
- Folders/devices: `flux_syncthing_list_folders`, `flux_syncthing_list_devices`
- Browse DB: `flux_syncthing_db_browse`
- Trigger scan/restart (requires confirmation): `flux_syncthing_db_scan`, `flux_syncthing_restart`

## Fallback: direct HTTP calls

If MCP is not available, use curl against `http://<node-ip>:16127`.

- Quick overview: `../../codex/flux-cloud/references/api-endpoints.md`
- Full endpoint inventory (Flux source-derived): `https://github.com/RunOnFlux/flux/blob/master/ZelBack/src/routes.js`

## References

- `references/mcp-setup.md` — connect Flux MCP to Claude Code/Desktop/Gemini CLI
- `../../codex/flux-cloud/references/api-endpoints.md` — base URLs, envelopes, auth/privilege, gateway tradeoffs, mutation semantics
- `references/app-spec-v8.md` — v8 spec template + rules
- `references/register-update.md` — signing + register/update flow
- `../../codex/flux-cloud/references/git-deployments.md` — Git deployments (Orbit) spec + workflow

- `references/prompts.md` — example prompts
- `references/tooling-map.md` — which MCP tools to use
