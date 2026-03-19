# Fluxtools: Flux CLI, MCP, and Skills

> Production-focused Flux tooling for CLI-first agents, with MCP and skill adapters for Flux Cloud / FluxOS.

This project turns the Flux node API into a safer operational surface for agents and operators. It combines a shell-native CLI, a Node.js MCP server, a shared skills library, thin platform adapters, generated endpoint inventories, and workflow helpers for app deployment, app maintenance, blockchain inspection, daemon and network APIs, storage, backups, enterprise flows, Syncthing administration, and signing and payment flows that support both Zelcore and SSP Wallet.

This repo is built for people who want to do real work on Flux infrastructure from a shell-native automation surface or an MCP client instead of hand-assembling raw REST calls.

For agent workflows, the intended execution order is:

1. use `fluxos-cli`
2. use `flux-mcp` when interactive MCP resources are a better fit or the CLI needs help
3. use raw HTTP only as a last resort

## Product Shape

Fluxtools is now structured as one cross-client plugin with multiple adapters:

- shared skills in `skills/`
- primary execution surface in `fluxos-cli/`
- MCP fallback surface in `flux-mcp/`
- platform adapters in `.codex/`, `.opencode/`, `.claude-plugin/`, `.cursor-plugin/`, and `GEMINI.md`

That keeps the project cohesive while letting the CLI, MCP server, and skills remain independently useful.

## What This Repo Gives You

| Area | What you can do |
| --- | --- |
| App delivery | Generate v8 specs, verify payloads, price deployments, plan registration and updates, sign messages, register apps, renew apps, and monitor propagation. |
| App operations | Start, stop, restart, redeploy, inspect, monitor, and troubleshoot running apps and components. |
| Logs and runtime | Tail logs, inspect containers, view stats and process lists, collect monitoring data, and execute commands inside app containers. |
| Storage and backups | Browse app volumes, download files and folders, mutate directories, inspect backup sizes, list local backups, download archives, and manage FluxDrive backup tasks. |
| Blockchain and explorer | Check chain sync state, balances, block height, rescan and reindex explorer data, and inspect daemon, mempool, peer, and network information. |
| Auth and enterprise | Run ZelID auth flows, launch signing and payment flows through Zelcore or SSP Wallet, build `zelidauth`, decrypt enterprise payloads, generate enterprise keys, and work with Arcane-specific app metadata. |
| Discovery and search | Search the generated Flux endpoint inventory, inspect categories, and fall back to safe escape hatches when you need direct endpoint access. |

## Capability Map

### Deploy, register, update, and renew apps

- Generate minimal v8 app specs with `flux_generate_app_spec_v8`.
- Generate Git-based deployment specs with `flux_git_deploy_generate_spec_v8`.
- Verify and canonicalize registration and update payloads with `flux_apps_verify_registration_spec` and `flux_apps_verify_update_spec`.
- Calculate pricing with `flux_apps_calculate_price`.
- Plan registration, update, and renew flows with `flux_apps_plan_registration`, `flux_apps_plan_update`, and `flux_apps_plan_renew`.
- Build exact signing payloads and checksums with `flux_build_message_to_sign`.
- Launch browser-friendly signing flows with `flux_auth_login`, `flux_write_sign_launcher`, and `flux_build_zelcore_sign_link`, with support for both Zelcore and SSP Wallet.
- Submit register and update operations with `flux_apps_register`, `flux_apps_update`, `flux_apps_register_and_verify`, and `flux_apps_update_and_verify`.
- Validate network propagation with `flux_apps_get_messages` and `flux_apps_wait_for_propagation`.
- Run post-registration install checks with `flux_apps_test_install`.
- Handle Git-driven register-and-verify flows with `flux_git_deploy_plan_registration` and `flux_git_deploy_register_and_verify`.
- Attach backup and restore tasks directly to app specs with `flux_apps_append_backup_task` and `flux_apps_append_restore_task`.

### Operate and maintain live apps

- List running apps, all apps, and global specs with `flux_apps_list_running`, `flux_apps_list_all`, and `flux_apps_list_global_specs`.
- Inspect ownership, public keys, registration info, deployment info, and full decrypted specs with `flux_apps_get_owner`, `flux_apps_get_public_key`, `flux_apps_registration_information`, `flux_apps_deployment_information`, and `flux_apps_get_spec_full`.
- Track app health and runtime state with `flux_app_health_report`, `flux_apps_global_status`, and `flux_apps_troubleshoot`.
- View app expiry by ZelID with `flux_apps_list_by_zelid_with_expiry`.
- Start, stop, restart, redeploy, and component-redeploy with `flux_apps_start`, `flux_apps_stop`, `flux_apps_restart`, `flux_apps_redeploy`, and `flux_apps_redeploy_component`.
- Follow maintenance workflows with `flux_maintenance_checklist`.

### Debug containers, processes, and runtime behavior

- Tail logs with `flux_logs_tail` and `flux_apps_logs`.
- Resolve the correct runtime node and container automatically with `flux_apps_resolve_runtime_target`.
- Inspect containers with `flux_apps_inspect`.
- Review resource usage with `flux_apps_stats`, `flux_apps_top`, and `flux_apps_monitor`.
- Execute commands inside a running app container with `flux_apps_exec`.

### Work with app files, volumes, backups, and FluxDrive

- Browse app volumes with `flux_apps_list_folder`.
- Download individual files and whole folders with `flux_apps_download_file` and `flux_apps_download_folder`.
- Create folders, rename objects, and remove objects with `flux_apps_create_folder`, `flux_apps_rename_object`, and `flux_apps_remove_object`.
- Inspect backup volume usage with `flux_backup_get_volume_data`.
- Check remote backup sizes with `flux_backup_get_remote_file_size`.
- List, remove, and download local backup archives with `flux_backup_list_local`, `flux_backup_remove_file`, and `flux_backup_download_local_file`.
- Upload local files and URL-sourced files with `flux_ioutils_file_upload` and `flux_ioutils_file_upload_from_url`.
- Manage FluxDrive backup operations with `flux_fluxdrive_set_base_url`, `flux_fluxdrive_register_backup_file`, `flux_fluxdrive_get_task_status`, `flux_fluxdrive_get_backup_list`, and `flux_fluxdrive_remove_checkpoint`.

### Analyze the Flux blockchain, node state, and explorer

- Check overall node health with `flux_node_health`.
- Inspect explorer height and sync status with `flux_explorer_height_info` and `flux_explorer_status`.
- Query balances with `flux_explorer_balance_summary`.
- Operate explorer services with `flux_explorer_restart`, `flux_explorer_stop`, `flux_explorer_reindex`, and `flux_explorer_rescan`.
- Access raw daemon RPC-style functionality through `flux_daemon_call`.
- Use prebuilt daemon helpers for `getinfo`, blockchain info, network info, peer info, mempool info, raw mempool, block count, connection count, and difficulty.

### Reach daemon, network, and maintenance APIs without losing safety

- Use `flux_request` as a controlled escape hatch for endpoints not yet wrapped by a dedicated tool.
- Enforce `allowMutation=true` for direct mutating calls.
- Keep high-level lifecycle and file mutations behind `confirm=true`.
- Search upstream-generated endpoint metadata with `flux_search_endpoints` and `flux_list_endpoint_categories`.

### Handle authentication, signing, and enterprise app workflows

- Resolve and pin a direct node behind the gateway with `flux_resolve_gateway_node` and `flux_set_base_url_from_gateway`.
- Run guided auth with `flux_auth_flow`, `flux_auth_login`, and `flux_auth_diagnose`.
- Fetch login phrases with `flux_get_login_phrase` and `flux_get_emergency_phrase`.
- Verify auth and privilege with `flux_verify_login` and `flux_check_privilege`.
- Build, set, clear, and inspect `zelidauth` with `flux_build_zelidauth`, `flux_set_zelidauth`, `flux_clear_zelidauth`, and `flux_get_state`.
- Build browser launchers for signing and payment flows with `flux_write_sign_launcher` and `flux_build_payment_launcher`, supporting both Zelcore and SSP Wallet where applicable.
- Generate enterprise headers and decrypt enterprise payloads with `flux_enterprise_key_generate`, `flux_set_enterprise_key`, `flux_clear_enterprise_key`, `flux_enterprise_preflight`, and `flux_enterprise_decrypt`.

### Operate Syncthing from the same interface

- Read metrics and health with `flux_syncthing_metrics` and `flux_syncthing_metrics_health`.
- Inspect system status, folders, devices, and DB contents with `flux_syncthing_system_status`, `flux_syncthing_list_folders`, `flux_syncthing_list_devices`, and `flux_syncthing_db_browse`.
- Trigger scans and restarts with `flux_syncthing_db_scan` and `flux_syncthing_restart`.

## Why Operators Use This Instead Of Raw Endpoints

- Safe-by-default mutations: high-level mutating tools require `confirm=true`, and direct mutating requests require `allowMutation=true`.
- Better signing UX: long signing messages can be stored as MCP resources, written to disk, opened in Zelcore, or launched through local browser pages that support both Zelcore and SSP Wallet.
- Less chat spam: large outputs come back as `resource_link` references instead of flooding the conversation with logs or JSON.
- Gateway-aware auth: the server can resolve the current gateway node and pin you to the direct node before authentication.
- Enterprise support: the server handles Arcane public key retrieval, enterprise-key generation, and local enterprise payload decryption.
- Endpoint discovery built in: the generated Flux route inventory is searchable from inside the MCP session.
- Works with MCP, CLI, and skills: you can use the same operational surface from Codex, Claude, Gemini, shell scripts, CI jobs, or any other stdio MCP client.

## Quick Start

### Install the packaged toolkit

```bash
npm i -g fluxtools
fluxtools install codex
fluxtools install claude
fluxtools install cursor --project-dir /path/to/project
fluxtools install opencode
fluxtools install gemini
fluxtools doctor codex
```

That gives you:

- the `flux` CLI on `PATH`
- shared Fluxtools skills and MCP in Codex
- shared Fluxtools skills and user-scoped MCP in Claude
- project-scoped Cursor rules and commands plus global Cursor MCP config
- packaged OpenCode plugin bootstrap, shared skills, and global OpenCode MCP config
- packaged Gemini extension bundle with bundled Flux MCP fallback

### Repo-local setup

From the repo root:

```bash
node scripts/setup.js
```

This will:

- build `flux-mcp` if needed
- install the Codex and Claude compatibility adapters in project scope
- print ready-to-paste MCP configuration snippets with absolute paths

User-scoped install:

```bash
node scripts/setup.js --scope user
```

### Manual build

```bash
cd flux-mcp
npm ci
npm run build
```

This produces `flux-mcp/dist/index.js`.

### Use the CLI directly

```bash
npm --prefix fluxos-cli ci
npm --prefix fluxos-cli run build
node fluxos-cli/dist/index.js --help
```

CLI usage guidance and automation examples live in [fluxos-cli/README.md](fluxos-cli/README.md).

### Install the shared skills library manually

Codex:

- follow [.codex/INSTALL.md](.codex/INSTALL.md)

Claude:

- `fluxtools install claude`
- `fluxtools doctor claude`
- installs standalone shared skills into `~/.claude/skills/fluxtools`
- installs a user-scoped Claude MCP server entry
- validates the repo as a Claude plugin package, but does not perform marketplace plugin installation
- see [docs/README.claude.md](docs/README.claude.md)

Cursor:

- `fluxtools install cursor --project-dir /path/to/project`
- `fluxtools doctor cursor --project-dir /path/to/project`
- installs a project rule in `.cursor/rules/` and a helper command in `.cursor/commands/`
- installs a user-global Cursor MCP config in `~/.cursor/mcp.json`

OpenCode:

- `fluxtools install opencode`
- `fluxtools doctor opencode`
- installs the OpenCode plugin bootstrap at `~/.config/opencode/plugins/fluxtools.js`
- installs shared skills at `~/.config/opencode/skills/fluxtools`
- installs a global OpenCode MCP server entry in `~/.config/opencode/opencode.json`
- or follow [.opencode/INSTALL.md](.opencode/INSTALL.md)

Gemini:

- `fluxtools install gemini`
- `fluxtools doctor gemini`
- installs a Gemini extension bundle in `~/.gemini/extensions/fluxtools`
- bundles `GEMINI.md`, shared skills, and a packaged Flux MCP server in the extension manifest
- or install this repo as an extension and use [GEMINI.md](GEMINI.md) as the bootstrap context file
- see [docs/README.gemini.md](docs/README.gemini.md)

Claude and Cursor plugin scaffolding:

- manifests live in [.claude-plugin/plugin.json](.claude-plugin/plugin.json) and [.cursor-plugin/plugin.json](.cursor-plugin/plugin.json)
- hook bootstrap scaffolding lives in [hooks/hooks.json](hooks/hooks.json)

### Connect an MCP client

Codex example:

```bash
codex mcp add flux \
  --env FLUX_API_BASE_URL=https://api.runonflux.io -- \
  node /absolute/path/to/flux-skills/flux-mcp/dist/index.js
```

The same server works with Claude Code, Claude Desktop, Gemini CLI, and other stdio MCP clients. Full client-specific setup lives in [flux-mcp/README.md](flux-mcp/README.md).

### First calls worth trying

- `flux_get_state`
- `flux_node_health`
- `flux_search_endpoints { "query": "applog", "limit": 5 }`
- `flux_auth_flow { "gatewayBaseUrl": "https://api.runonflux.io" }`
- `flux_apps_list_global_specs { "owner": "<zelid>" }`

## Shared Skills And Adapter Packaging

### Shared skills library

The main skill source of truth now lives in:

- [skills/using-fluxtools/SKILL.md](skills/using-fluxtools/SKILL.md)
- [skills/flux-auth-session/SKILL.md](skills/flux-auth-session/SKILL.md)
- [skills/flux-app-deployments/SKILL.md](skills/flux-app-deployments/SKILL.md)
- [skills/flux-runtime-operations/SKILL.md](skills/flux-runtime-operations/SKILL.md)
- [skills/flux-storage-backups/SKILL.md](skills/flux-storage-backups/SKILL.md)
- [skills/flux-network-services/SKILL.md](skills/flux-network-services/SKILL.md)
- [skills/flux-mcp-fallback/SKILL.md](skills/flux-mcp-fallback/SKILL.md)

### Compatibility adapters

Compatibility wrappers remain in:

- [codex/flux-cloud/SKILL.md](codex/flux-cloud/SKILL.md)
- [claude/flux-cloud/SKILL.md](claude/flux-cloud/SKILL.md)

Package `.skill` artifacts:

```bash
python3 scripts/package_skill.py codex/flux-cloud dist --out-name flux-cloud-codex
python3 scripts/package_skill.py claude/flux-cloud dist --out-name flux-cloud-claude
```

## Repository Layout

| Path | Role |
| --- | --- |
| `skills/` | Shared Fluxtools skills library and bootstrap skill. |
| `flux-mcp/` | The main execution layer: MCP server, tool handlers, resources, and HTTP clients. |
| `fluxos-cli/` | Shell-native Flux CLI for agent workflows, CI, scripts, and operators who want JSON-over-stdout contracts. |
| `codex/flux-cloud/` | Codex compatibility adapter and references. |
| `claude/flux-cloud/` | Claude compatibility adapter and references. |
| `.codex/`, `.opencode/`, `.claude-plugin/`, `.cursor-plugin/` | Cross-client install and plugin adapter surfaces. |
| `hooks/` | Session bootstrap hook scaffolding for plugin-capable clients. |
| `scripts/` | Setup and skill packaging helpers. |
| `dist/` | Generated `.skill` artifacts. |
| `flux-mcp/data/endpoints.json` | Generated Flux endpoint inventory used by the MCP search tools. |

## Read Next

| Document | Why you would open it |
| --- | --- |
| [docs/execution-surface-policy.md](docs/execution-surface-policy.md) | Shared CLI-first routing policy for skills, adapters, and fallback behavior. |
| [docs/README.codex.md](docs/README.codex.md) | Codex-specific install and usage notes for the shared Fluxtools skills library. |
| [docs/README.cursor.md](docs/README.cursor.md) | Cursor-specific install notes for project rules, commands, and MCP wiring. |
| [docs/README.claude.md](docs/README.claude.md) | Claude-specific install notes for standalone skills, MCP, and plugin packaging. |
| [docs/README.gemini.md](docs/README.gemini.md) | Gemini-specific extension install notes and bundled MCP behavior. |
| [docs/README.opencode.md](docs/README.opencode.md) | OpenCode-specific install and plugin bootstrap notes. |
| [.codex/INSTALL.md](.codex/INSTALL.md) | Install the shared Fluxtools skills into Codex native skill discovery. |
| [.opencode/INSTALL.md](.opencode/INSTALL.md) | Install the OpenCode plugin bootstrap, shared Fluxtools skills, and MCP config. |
| [flux-mcp/README.md](flux-mcp/README.md) | Full MCP setup, technical workflows, configuration, and categorized tool catalog. |
| [fluxos-cli/README.md](fluxos-cli/README.md) | CLI usage, automation patterns, composition helpers, and examples. |
| [fluxos-cli/ARCHITECTURE.md](fluxos-cli/ARCHITECTURE.md) | Long-term execution-surface guidance: MCP vs CLI, shared runtime direction, and fallback decisions. |
| [codex/flux-cloud/SKILL.md](codex/flux-cloud/SKILL.md) | Codex-side workflow guidance and tool usage patterns. |
| [claude/flux-cloud/SKILL.md](claude/flux-cloud/SKILL.md) | Claude Code workflow guidance. |
| [codex/flux-cloud/references/](codex/flux-cloud/references/) | Detailed Flux API references, app spec notes, signing docs, and troubleshooting. |

## Endpoint Inventory

The endpoint inventory is generated from the public Flux source of truth:

- `https://github.com/RunOnFlux/flux/blob/master/ZelBack/src/routes.js`

Generated outputs in this repo:

- `codex/flux-cloud/references/endpoints-inventory.md`
- `codex/flux-cloud/references/endpoints.json`
- `flux-mcp/data/endpoints.json`

Regenerate:

```bash
cd codex/flux-cloud
node scripts/generate-endpoints.js --ref master --also-mcp
```

## Core Configuration

Important environment variables:

- `FLUX_API_BASE_URL` - node API base URL, defaults to `https://api.runonflux.io`
- `FLUX_ZELIDAUTH` - optional preloaded `zelidauth`
- `FLUX_ENTERPRISE_KEY` - optional preloaded enterprise-key header
- `FLUX_HTTP_TIMEOUT_MS` - request timeout override
- `FLUX_ENDPOINTS_PATH` - custom endpoint inventory path
- `FLUXDRIVE_MWS_BASE_URL` - FluxDrive MWS base URL override

Signing and launcher behavior can also be tuned from the MCP layer. See [flux-mcp/README.md](flux-mcp/README.md) for the full server configuration surface.
