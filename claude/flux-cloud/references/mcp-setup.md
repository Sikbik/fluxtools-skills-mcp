# Flux MCP Setup (Claude Code / Claude Desktop)

This repository includes an MCP server at `flux-mcp/`.

## Build the server

From the repo root:

```bash
cd flux-mcp
npm install
npm run build
```

## Connect from Claude Code

Example (stdio transport):

```bash
claude mcp add --transport stdio flux -- \
  node /absolute/path/to/flux-skills/flux-mcp/dist/index.js
```

You can confirm it’s installed:

```bash
claude mcp list
claude mcp get flux
```

## Connect from Claude Desktop

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

## First tool calls

- `flux_get_state`
- `flux_set_base_url` (if you didn’t set `FLUX_API_BASE_URL`)
- `flux_get_login_phrase` → sign phrase → `flux_build_zelidauth` → `flux_set_zelidauth`
- `flux_node_health`
