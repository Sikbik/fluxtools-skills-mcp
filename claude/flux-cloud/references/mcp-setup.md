# Flux MCP Setup (Claude Code / Claude Desktop / OpenCode)

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

## 2) Connect your client

### Claude Code

Example (stdio transport):

```bash
claude mcp add --transport stdio flux -- \
  node /absolute/path/to/flux-skills/flux-mcp/dist/index.js
```

Verify:

```bash
claude mcp list
claude mcp get flux
```

### Claude Desktop

Add an MCP server entry (example):

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

### OpenCode

OpenCode reads MCP servers from `opencode.json` / `opencode.jsonc`.

You can configure it globally:
- `~/.config/opencode/opencode.json`

Or per-project (recommended):
- `./opencode.json`
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
- If tools don’t show up, increase `timeout`.

## 3) First tool calls

- `flux_get_state`
- If you didn’t set `FLUX_API_BASE_URL`: `flux_set_base_url { "baseUrl": "http://<node-ip>:16127" }`
- If starting from gateway:
  - `flux_set_base_url_from_gateway { "gatewayBaseUrl": "https://api.runonflux.io" }`
- Auth plan (recommended):
  - `flux_auth_flow { "gatewayBaseUrl": "https://api.runonflux.io" }`
- Quick health check:
  - `flux_node_health`

## 4) Working with resource links

Many tools return `resource_link` blocks to keep chat output compact.

- To inspect a resource in clients that support MCP resources, use `resources/read` with the given URI.
- If your client UI doesn’t expose resources well, use `flux_resource_read` with the same URI.
