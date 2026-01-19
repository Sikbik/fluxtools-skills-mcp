# Flux Skills

Tools and skills for operating Flux Cloud / FluxOS nodes and apps via MCP or Codex skills.

## Repo map

| Path | What it is |
| --- | --- |
| `flux-mcp/` | MCP server (Node.js 20+, ESM). The main execution layer. |
| `claude/flux-cloud/` | Claude Code skill wrapper and references. |
| `codex/flux-cloud/` | Codex skill, references, and helper scripts. |
| `scripts/` | Skill packaging helper. |

## What you can do

- Node health and diagnostics
- App spec v8 workflows (generate, verify, price)
- Register/update signing flow
- App lifecycle (start/stop/redeploy) with confirmation gating
- Logs, inspect, stats, top, monitoring
- File and volume browser (list, download, mutate)
- Syncthing health and control
- Daemon RPC proxy, explorer, backups
- Endpoint discovery from upstream Flux routes

## Quick start: MCP server (Claude, Gemini, other MCP clients)

### 1) Prereqs

- Node.js 20+
- A Flux node API base URL:
  - Direct node (recommended): `http://<node-ip>:16127`
  - Public gateway: `https://api.runonflux.io`

Common gotcha:
- `https://cloud.runonflux.com/` is the UI, not the node API base URL.

### 2) Build the MCP server (one time)

From the repo root:

```bash
cd flux-mcp
npm ci
npm run build
```

This produces: `flux-mcp/dist/index.js`

Default behavior: if `FLUX_API_BASE_URL` is not set, the MCP server uses `https://api.runonflux.io`.

### 3) Connect your client

#### Claude Code (CLI)

```bash
claude mcp add --transport stdio \
  --env FLUX_API_BASE_URL=https://api.runonflux.io \
  flux -- \
  node /absolute/path/to/flux-skills/flux-mcp/dist/index.js
```

Verify:

```bash
claude mcp list
claude mcp get flux
```

In the Claude Code UI, you can also run:

```
/mcp
```

#### Claude Desktop

Open Claude Desktop, then:

1) Settings -> Developer -> Edit Config
2) Add a server entry (example below)
3) Restart Claude Desktop

```json
{
  "mcpServers": {
    "flux": {
      "command": "node",
      "args": ["/absolute/path/to/flux-skills/flux-mcp/dist/index.js"],
      "env": {
        "FLUX_API_BASE_URL": "https://api.runonflux.io"
      }
    }
  }
}
```

#### Gemini CLI

Option A: use the CLI command (writes settings for you):

```bash
gemini mcp add -s user \
  -e FLUX_API_BASE_URL=https://api.runonflux.io \
  flux node /absolute/path/to/flux-skills/flux-mcp/dist/index.js
```

Option B: edit your settings file directly:

- User scope: `~/.gemini/settings.json`
- Project scope: `.gemini/settings.json`

```json
{
  "mcpServers": {
    "flux": {
      "command": "node",
      "args": ["/absolute/path/to/flux-skills/flux-mcp/dist/index.js"],
      "env": {
        "FLUX_API_BASE_URL": "https://api.runonflux.io"
      }
    }
  }
}
```

Verify:

```bash
gemini mcp list
```

In Gemini CLI, you can also run:

```
/mcp
```

Notes:
- Use an absolute path for `flux-mcp/dist/index.js`.
- If `gemini mcp` is not available yet, use the settings file method.

#### Codex (CLI + IDE)

Codex supports MCP in both the CLI and IDE extension. Configuration is shared via `~/.codex/config.toml`.

Option A: use the CLI:

```bash
codex mcp add flux \
  --env FLUX_API_BASE_URL=https://api.runonflux.io -- \
  node /absolute/path/to/flux-skills/flux-mcp/dist/index.js
```

Verify:

```bash
codex mcp list
```

In the Codex TUI, use:

```
/mcp
```

Option B: edit `~/.codex/config.toml`:

```toml
[mcp_servers.flux]
command = "node"
args = ["/absolute/path/to/flux-skills/flux-mcp/dist/index.js"]

[mcp_servers.flux.env]
FLUX_API_BASE_URL = "https://api.runonflux.io"
```

### 4) First tool calls (any MCP client)

- `flux_get_state`
- By default MCP uses the public gateway. To use a direct node:
  - `flux_set_base_url { "baseUrl": "http://<node-ip>:16127" }`
- To pin the gateway to its current node (avoids load balancing):
  - `flux_set_base_url_from_gateway { "gatewayBaseUrl": "https://api.runonflux.io" }`
- Auth plan (recommended):
  - `flux_auth_flow { "gatewayBaseUrl": "https://api.runonflux.io" }`
- Quick health check:
  - `flux_node_health`

### 5) Large outputs

Many tools return `resource_link` blocks to keep chat output small.

- If your client supports MCP resources, use `resources/read` with the given URI.
- Otherwise, call `flux_resource_read { "uri": "..." }`.

### 6) Troubleshooting (MCP)

- Tools not showing up: make sure Node.js 20+ is installed, run `npm ci && npm run build` in `flux-mcp/`, and restart your client.
- Base URL missing/invalid: set `FLUX_API_BASE_URL` or call `flux_set_base_url`.
- Connection errors: verify the node API is reachable at `http://<node-ip>:16127` (not the UI port `16126`).
- Auth errors: run `flux_auth_flow` to refresh `zelidauth`.
- Gateway weirdness: use a direct node URL or call `flux_set_base_url_from_gateway`.

## Codex skill

Codex supports skills. Install the Flux skill by copying the folder.

Repo scoped (recommended for teams):

```bash
mkdir -p .codex/skills
cp -R codex/flux-cloud .codex/skills/flux-cloud
```

User scoped (all projects):

```bash
mkdir -p "${CODEX_HOME:-$HOME/.codex}/skills"
cp -R codex/flux-cloud "${CODEX_HOME:-$HOME/.codex}/skills/flux-cloud"
```

Restart Codex to pick it up. Then run `/skills` or type `$flux-cloud`.

Package into a `.skill` artifact (optional):

```bash
python3 scripts/package_skill.py codex/flux-cloud dist --out-name flux-cloud-codex
```

## Optional: Claude Code skill wrapper

This is only for Claude Code's skill system (not required for MCP):

```bash
mkdir -p ~/.claude/skills
cp -R claude/flux-cloud ~/.claude/skills/flux-cloud
```

Or project scoped:

```bash
mkdir -p .claude/skills
cp -R claude/flux-cloud .claude/skills/flux-cloud
```

Restart Claude Code, then ask:

```
What skills are available?
```

## More docs

- `flux-mcp/README.md` - full tool catalog, safety model, and workflows
- `codex/flux-cloud/references/` - API references and signing details
- `claude/flux-cloud/references/` - Claude-specific prompts and MCP setup

## MCP server configuration

Environment variables:

- `FLUX_API_BASE_URL` (default): `https://api.runonflux.io`
  - For a direct node: `http://<node-ip>:16127`
- `FLUX_ZELIDAUTH` (optional): pre-set auth header value (JSON string)
- `FLUX_HTTP_TIMEOUT_MS` (optional): default `30000`
- `FLUX_ENDPOINTS_PATH` (optional): override bundled endpoints inventory path

You can also set base URL and `zelidauth` at runtime via tools.

## Endpoint inventory (generated)

Source of truth in the public Flux repo:
- `https://github.com/RunOnFlux/flux/blob/master/ZelBack/src/routes.js`

Generated outputs:
- `codex/flux-cloud/references/endpoints-inventory.md`
- `codex/flux-cloud/references/endpoints.json`
- `flux-mcp/data/endpoints.json`

Regenerate:

```bash
cd codex/flux-cloud
node scripts/generate-endpoints.js --ref master --also-mcp
```

## Helpful links

- Flux UI: `https://cloud.runonflux.com/`
- Flux repo (API source of truth): `https://github.com/RunOnFlux/flux`
