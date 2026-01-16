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

## Quickstart (pick your setup)

Flux Skills can be used in a few ways, depending on which “agent client” you use.

All setups share the same core building block:
- `flux-mcp/` — an MCP server you run locally (Node.js >= 20)

### 0) Prereqs (all setups)

- Node.js >= 20
- A Flux node API base URL:
  - Direct node (recommended): `http://<node-ip>:16127`
  - Public gateway (works, but not always ideal): `https://api.runonflux.io`

Common gotcha:
- `https://cloud.runonflux.com/` is the UI, not the node API base URL.

### 1) Build the Flux MCP server (one-time)

From the repo root (this creates the MCP entrypoint used below):

```bash
cd flux-mcp
npm ci
npm run build
```

(If you prefer `npm install`, that also works — `npm ci` is just reproducible.)

This produces: `flux-mcp/dist/index.js`

### 2) Connect your client (choose one)

#### A) Claude Code (MCP)

Connect via stdio:

```bash
claude mcp add --transport stdio flux -- \
  node /absolute/path/to/flux-skills/flux-mcp/dist/index.js
```

Verify:

```bash
claude mcp list
claude mcp get flux
```

#### B) Claude Desktop (MCP)

Add to your Claude Desktop MCP config:

```json
{
  "mcpServers": {
    "flux": {
      "command": "node",
      "args": ["/absolute/path/to/flux-skills/flux-mcp/dist/index.js"],
      "env": {
        "FLUX_API_BASE_URL": "http://<node-ip>:16127"
      }
    }
  }
}
```

Restart Claude Desktop.

#### C) OpenCode (MCP)

OpenCode reads MCP servers from `opencode.json` / `opencode.jsonc`.

You can configure it globally:
- `~/.config/opencode/opencode.json`

Or per-project (recommended):
- `./opencode.json` (in your project root)
- or `./.opencode/opencode.json`

Example config (local/stdio MCP server):

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "mcp": {
    "flux": {
      "type": "local",
      "command": [
        "node",
        "/absolute/path/to/flux-skills/flux-mcp/dist/index.js"
      ],
      "environment": {
        "FLUX_API_BASE_URL": "http://<node-ip>:16127"
      },
      "timeout": 30000
    }
  }
}
```

Restart OpenCode.

Notes:
- Use an absolute path for `flux-mcp/dist/index.js`.
- If tools don’t show up, increase `timeout` (first load has to start Node + list tools).
- If you see permission prompts for every MCP tool call, configure OpenCode permissions to allow `mcp-*` for your workflow.

### 3) (Optional) Install the Claude Code “Skill” wrapper

This is only for Claude Code’s skill system (it’s not required for MCP usage).

- Personal install:

```bash
mkdir -p ~/.claude/skills
cp -R claude/flux-cloud ~/.claude/skills/flux-cloud
```

- Project install:

```bash
mkdir -p .claude/skills
cp -R claude/flux-cloud .claude/skills/flux-cloud
```

Restart Claude Code, then verify:

```text
What Skills are available?
```

### 4) First tool calls (works in any MCP client)

- `flux_get_state`
- If you didn’t set `FLUX_API_BASE_URL`: `flux_set_base_url { "baseUrl": "http://<node-ip>:16127" }`
- If starting from gateway:
  - `flux_set_base_url_from_gateway { "gatewayBaseUrl": "https://api.runonflux.io" }`
- Auth plan (recommended):
  - `flux_auth_flow { "gatewayBaseUrl": "https://api.runonflux.io" }`
- Quick health check:
  - `flux_node_health`

### 5) Resource links (large outputs)

Many tools return `resource_link` blocks to keep chat output compact.

- If your client supports MCP resources, use `resources/read` with the given URI.
- Otherwise, call `flux_resource_read { "uri": "..." }`.

## Flux MCP server (Flux-tuned tools)

Server location: `flux-mcp/`.

Key features:

- **Safe-by-default**: mutating API calls require `confirm=true` (for high-level tools) or `allowMutation=true` (for `flux_request`).
- **Workflow tools**: app register/update signing flow, lifecycle ops, logs, files, syncthing.
- **Endpoint discovery**: bundled endpoint inventory + keyword search.
- **Binary downloads**: file/folder downloads return base64 + metadata.

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
