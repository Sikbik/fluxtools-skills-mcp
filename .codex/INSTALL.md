# Installing Fluxtools For Codex

Enable Fluxtools in Codex as a packaged bundle of CLI, shared skills, and optional MCP.

## Quick install

Preferred packaged flow:

```bash
npm i -g fluxtools
fluxtools install codex
fluxtools doctor codex
```

That installs:

- the `flux` CLI on `PATH`
- shared Fluxtools skills under `~/.agents/skills/fluxtools`
- a `flux` MCP server entry in Codex that points at the packaged `flux-mcp`

## Repo checkout install

If you are working from a local clone instead of the published package, create a symlink from the shared `skills/` library into Codex skill discovery.

```bash
mkdir -p ~/.agents/skills
ln -s /absolute/path/to/flux-skills/skills ~/.agents/skills/fluxtools
```

Windows PowerShell:

```powershell
New-Item -ItemType Directory -Force -Path "$env:USERPROFILE\.agents\skills"
cmd /c mklink /J "$env:USERPROFILE\.agents\skills\fluxtools" "C:\absolute\path\to\flux-skills\skills"
```

3. Restart Codex.

## What this gives you

- shared Fluxtools skills from `skills/`
- CLI-first routing through `using-fluxtools`
- focused domain skills for auth, deployments, runtime ops, storage, network services, and MCP fallback

## Optional repo-local MCP setup

If you also want Flux MCP available in Codex:

```bash
codex mcp add flux \
  --env FLUX_API_BASE_URL=https://api.runonflux.io -- \
  node /absolute/path/to/flux-skills/flux-mcp/dist/index.js
```

The skills remain CLI-first even when MCP is installed.

## Verify

Check the symlink:

```bash
ls -la ~/.agents/skills/fluxtools
```

You should see it pointing at this repo's `skills/` directory.
