# Flux MCP Setup (Claude Code / Claude Desktop / Gemini CLI / Codex)

This repository includes an MCP server at `flux-mcp/`.

## 0) Prereqs

- Node.js >= 20
- A Flux node API base URL:
  - Direct node (recommended): `http://<node-ip>:16127`
  - Public gateway: `https://api.runonflux.io`

Common gotcha:
- `https://cloud.runonflux.com/` is the UI, not the node API base URL.

## 1) Build the server

From the repo root:

```bash
cd flux-mcp
npm ci
npm run build
```

(If you prefer `npm install`, that also works — `npm ci` is just reproducible.)

This produces: `flux-mcp/dist/index.js`

Default behavior: if `FLUX_API_BASE_URL` is not set, the MCP server uses `https://api.runonflux.io`.

## 2) Connect your client

### Claude Code (CLI)

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

### Claude Desktop

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

Restart Claude Desktop.

### Gemini CLI

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

### Codex (CLI + IDE)

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

Note: `/mcp` is list-only in the Codex TUI. To add or edit servers, use `codex mcp` or edit `~/.codex/config.toml`.

Option B: edit `~/.codex/config.toml`:

```toml
[mcp_servers.flux]
command = "node"
args = ["/absolute/path/to/flux-skills/flux-mcp/dist/index.js"]

[mcp_servers.flux.env]
FLUX_API_BASE_URL = "https://api.runonflux.io"
```

## 3) First tool calls

- `flux_get_state`
- By default MCP uses the public gateway. To use a direct node:
  - `flux_set_base_url { "baseUrl": "http://<node-ip>:16127" }`
- To pin the gateway to its current node (avoids load balancing):
  - `flux_set_base_url_from_gateway { "gatewayBaseUrl": "https://api.runonflux.io" }`
- Auth plan (recommended):
  - `flux_auth_flow { "gatewayBaseUrl": "https://api.runonflux.io" }`
- Quick health check:
  - `flux_node_health`

## 4) Working with resource links

Many tools return `resource_link` blocks to keep chat output compact.

- To inspect a resource in clients that support MCP resources, use `resources/read` with the given URI.
- If your client UI doesn’t expose resources well, use `flux_resource_read` with the same URI.

## 5) Troubleshooting

- Tools not showing: ensure Node.js 20+, run `npm ci && npm run build` in `flux-mcp/`, use an absolute path, and restart the client.
- Base URL missing/invalid: set `FLUX_API_BASE_URL` or call `flux_set_base_url`.
- Connection errors: verify `http://<node-ip>:16127` is reachable (not `16126`).
- Auth errors: run `flux_auth_flow` to refresh `zelidauth`.
