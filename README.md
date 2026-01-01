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

Server location: `flux-mcp/`.

Key features:

- **Safe-by-default**: mutating API calls require `confirm=true` (for high-level tools) or `allowMutation=true` (for `flux_request`).
- **Workflow tools**: app register/update signing flow, lifecycle ops, logs, files, syncthing.
- **Endpoint discovery**: bundled endpoint inventory + keyword search.
- **Binary downloads**: file/folder downloads return base64 + metadata.

Build:

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

Package into a distributable `.skill`:

```bash
python3 scripts/package_skill.py codex/flux-cloud dist
# (If you have Codex installed, you can also use:
# python3 ~/.codex/skills/.system/skill-creator/scripts/package_skill.py codex/flux-cloud dist)
```

## API coverage: generated endpoint inventory

Flux node routes are defined in the public Flux repo in `ZelBack/src/routes.js`.

This project includes:

- `codex/flux-cloud/references/endpoints-inventory.md` (human)
- `codex/flux-cloud/references/endpoints.json` (machine-readable)
- `flux-mcp/data/endpoints.json` (bundled into MCP for search)

Regenerate from the public repo:

```bash
cd codex/flux-cloud
node scripts/generate-endpoints.js --ref master --also-mcp
```

## Repo layout

- `claude/flux-cloud/` — Claude Code Agent Skill (MCP-first workflows)
- `codex/flux-cloud/` — Codex skill (workflows + references + scripts)
- `flux-mcp/` — MCP server (tools for Flux node API)
- `dist/` — packaged skill artifacts (optional)

## Links

- Flux UI: `https://cloud.runonflux.com/`
- Flux repo (API source-of-truth): `https://github.com/RunOnFlux/flux`
