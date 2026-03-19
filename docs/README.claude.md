# Fluxtools For Claude

Claude support in this repo currently uses the documented standalone Claude surfaces:

- shared skills installed in `~/.claude/skills/fluxtools`
- a user-scoped Claude MCP entry added with `claude mcp add`
- a valid Claude plugin package rooted at this repository for future marketplace or plugin-based distribution

## Install

```bash
npm i -g fluxtools
fluxtools install claude
fluxtools doctor claude
```

## What this does

- copies the shared Fluxtools skills into Claude's standalone skill directory
- adds a user-scoped `flux` MCP server that points at the packaged `flux-mcp/dist/index.js`
- validates the repo root as a Claude plugin package with `claude plugin validate`

## Important distinction

Claude's standalone install flow and Claude's plugin marketplace flow are different things.

- `fluxtools install claude` installs standalone skills plus MCP for immediate local use
- `.claude-plugin/plugin.json` is the packaged plugin manifest for validation and future distribution
- it does not perform `claude plugin install`, because Claude plugin installation is marketplace-based

## Verify

```bash
claude mcp get flux
ls ~/.claude/skills/fluxtools
fluxtools doctor claude
```
