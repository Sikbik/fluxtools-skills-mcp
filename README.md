# Flux Skills

A multi-target skills + tooling suite for interacting with **Flux Cloud / FluxOS** via AI.

This repo is designed to work well with:

- **Claude Code Skills** (Agent Skills)
- **Codex Skills**
- **MCP clients** (Claude Code, Claude Desktop, and other MCP-capable clients)

## What this project can do

- **Node health + diagnostics**: version/info/ArcaneOS detection, basic service checks.
- **App workflows (v8)**: generate specs, validate/canonicalize, price estimate, register/update message-to-sign workflow.
- **App operations**: start/stop/restart/redeploy (with explicit confirmation).
- **Observability**: logs, inspect, stats, top, monitoring snapshots.
- **App storage**: browse folders, download files/folders (base64), create/rename/remove paths (with explicit confirmation).
- **Syncthing**: metrics/status, folder/device listing, DB browse, scan/restart (with explicit confirmation + privileges).
- **Full API discovery**: a generated inventory of the node API routes extracted from Flux source.

## Claude Code Skill (recommended first)

Skill location: `claude/flux-cloud/`.

Install as a **personal skill**:

```bash
mkdir -p ~/.claude/skills
cp -R claude/flux-cloud ~/.claude/skills/flux-cloud
```

Or install as a **project skill** (share with a team) inside any repo:

```bash
mkdir -p .claude/skills
cp -R claude/flux-cloud .claude/skills/flux-cloud
```

Restart Claude Code, then verify:

```text
What Skills are available?
```

This Claude Skill is **MCP-first**: it prefers using the `flux-mcp` tools for deterministic, safe workflows.

## Flux MCP server (Flux-tuned tools)

Note: many tools return `resource_link` blocks for large payloads. Use MCP `resources/read` or the wrapper tool `flux_resource_read` to fetch full content.

## 5-minute quickstart (gateway → auth → “my apps”)

Prereqs: Node.js >= 20 and access to a Flux node API.

1) Build the MCP server:

```bash
cd flux-mcp
npm install
npm run build
```

2) Connect from Claude Code:

```bash
claude mcp add --transport stdio flux -- \
  node /absolute/path/to/flux-skills/flux-mcp/dist/index.js
```

3) If you want to start from the public gateway, resolve the real node behind it:

- Call `flux_resolve_gateway_node { "gatewayBaseUrl": "https://api.runonflux.io" }`
- Then call `flux_set_base_url { "baseUrl": "http://<resolved-ip>:16127" }`

4) Authenticate (ZelID → `zelidauth`):

- Call `flux_auth_flow { "gatewayBaseUrl": "https://api.runonflux.io" }` and follow the returned steps.
  - This flow uses the correct request encoding for Flux auth endpoints.

5) List your globally registered apps + expiry table:

- Call `flux_apps_list_by_zelid_with_expiry`
  - Optional: `{ "includeExpired": true, "limit": 100 }`

Tip: many tools return a `resource_link` with raw payloads; use `flux_resource_read` to fetch it.

Server location: `flux-mcp/`.

Key features:

- **Safe-by-default**: mutating API calls require `confirm=true` (for high-level tools) or `allowMutation=true` (for `flux_request`).
- **Workflow tools**: app register/update signing flow, lifecycle ops, logs, files, syncthing.
- **Endpoint discovery**: bundled endpoint inventory + keyword search.
- **Binary downloads**: file/folder downloads return base64 + metadata.

Build (Node.js >= 20):

```bash
cd flux-mcp
npm install
npm run build
```

Connect from Claude Code (stdio transport):

```bash
claude mcp add --transport stdio flux -- \
  node /absolute/path/to/flux-skills/flux-mcp/dist/index.js
```

Set `FLUX_API_BASE_URL` to a direct node API (recommended) like `http://<node-ip>:16127`, or the public gateway `https://api.runonflux.io`. (`https://cloud.runonflux.com/` is the UI, not the node API base URL.)

Docs: `flux-mcp/README.md`.

## Codex skill

Skill location: `codex/flux-cloud/`.

Install:

```bash
mkdir -p "${CODEX_HOME:-$HOME/.codex}/skills"
cp -R codex/flux-cloud "${CODEX_HOME:-$HOME/.codex}/skills/flux-cloud"
```

Restart Codex to pick it up.

Package into distributable `.skill` artifacts:

```bash
python3 scripts/package_skill.py codex/flux-cloud dist --out-name flux-cloud-codex
python3 scripts/package_skill.py claude/flux-cloud dist --out-name flux-cloud-claude
```

## API coverage: generated endpoint inventory

Flux node routes are defined in the public Flux repo in `ZelBack/src/routes.js`.

This project includes:

- `codex/flux-cloud/references/endpoints-inventory.md` (human, categorized)
- `codex/flux-cloud/references/endpoints.json` (machine-readable)
- `flux-mcp/data/endpoints.json` (bundled into MCP for search)

These references are intentionally exhaustive: they’re meant to be the “public knowledge” map of how the Flux node API behaves, so the MCP tools and skills can work fluently across the ecosystem.

Regenerate from the public repo:

```bash
cd codex/flux-cloud
node scripts/generate-endpoints.js --ref master --also-mcp
```

## API semantics (how calls behave)

Flux’s API surface has a few important traits that matter when automating it:

- Many state-changing actions are exposed as `GET` routes; treat them as mutations anyway.
- Authentication is `zelidauth` (signed login phrase), but some auth endpoints expect `application/x-www-form-urlencoded` payloads.
- Large responses are common (logs, specs, monitoring, inventories). The MCP server returns `resource_link` blocks to keep chat usable.

For category-by-category call behavior, see:

- `codex/flux-cloud/references/flux-api.md`
- `codex/flux-cloud/references/daemon-api.md`
- `codex/flux-cloud/references/explorer-api.md`
- `codex/flux-cloud/references/api-endpoints.md`
- `codex/flux-cloud/references/endpoints-inventory.md`

## Release notes (upcoming)

- Auth UX: `flux_auth_flow`, `flux_auth_diagnose`, `flux_get_emergency_phrase`, `flux_verify_login`, `flux_check_privilege`.
- My apps: `flux_apps_list_by_zelid_with_expiry` (global apps under a ZelID + expiry table).
- Safer operations: mutation gating stays strict (`confirm=true` / `allowMutation=true`).
- Compact outputs: large payload tools now return summaries + `resource_link` instead of dumping huge JSON.
- Resources: MCP `resources/list`/`resources/read` supported; convenience tool `flux_resource_read` added.

## Repo layout

- `claude/flux-cloud/` — Claude Code Agent Skill (MCP-first workflows)
- `codex/flux-cloud/` — Codex skill (workflows + references + scripts)
- `flux-mcp/` — MCP server (tools for Flux node API)
- `dist/` — packaged skill artifacts (optional)

## Links

- Flux UI: `https://cloud.runonflux.com/`
- Flux repo (API source-of-truth): `https://github.com/RunOnFlux/flux`
