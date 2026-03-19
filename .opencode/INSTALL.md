# Installing Fluxtools For OpenCode

Fluxtools supports OpenCode with:

- shared skills from `skills/`
- an OpenCode plugin bootstrap from `.opencode/plugins/fluxtools.js`
- a global OpenCode MCP entry in `~/.config/opencode/opencode.json`

## Install

Preferred packaged flow:

```bash
npm i -g fluxtools
fluxtools install opencode
fluxtools doctor opencode
```

Repo checkout flow:

1. Clone this repository to a stable path.

2. Register the plugin:

```bash
mkdir -p ~/.config/opencode/plugins
ln -s /absolute/path/to/flux-skills/.opencode/plugins/fluxtools.js ~/.config/opencode/plugins/fluxtools.js
```

3. Register the skills:

```bash
mkdir -p ~/.config/opencode/skills
ln -s /absolute/path/to/flux-skills/skills ~/.config/opencode/skills/fluxtools
```

4. Register the MCP fallback in `~/.config/opencode/opencode.json`:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "mcp": {
    "flux": {
      "type": "local",
      "command": ["node", "/absolute/path/to/flux-skills/flux-mcp/dist/index.js"],
      "enabled": true,
      "environment": {
        "FLUX_API_BASE_URL": "https://api.runonflux.io"
      }
    }
  }
}
```

5. Restart OpenCode.

## What this gives you

- `using-fluxtools` bootstrap context at session start
- native discovery of the shared Fluxtools skills
- a bundled Flux MCP fallback server registered in OpenCode config
- CLI-first routing with MCP fallback

## Verify

Check the symlinks:

```bash
ls -l ~/.config/opencode/plugins/fluxtools.js
ls -l ~/.config/opencode/skills/fluxtools
cat ~/.config/opencode/opencode.json
```

Then ask OpenCode to list skills or ask whether Fluxtools is available.
