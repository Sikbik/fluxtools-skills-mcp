# Fluxtools For Cursor

Fluxtools works in Cursor as:

- project-scoped rules in `.cursor/rules/`
- a helper command in `.cursor/commands/`
- a user-global Cursor MCP config in `~/.cursor/mcp.json`
- `flux` CLI as the primary execution surface

## Install

Packaged install:

- `npm i -g fluxtools`
- `fluxtools install cursor --project-dir /path/to/project`
- `fluxtools doctor cursor --project-dir /path/to/project`

## Expected behavior

- the Cursor rule keeps Fluxtools CLI-first
- the Cursor command gives a slash-command style doctor entrypoint
- the MCP config is available as a fallback surface

## Read next

- [execution-surface-policy.md](/home/stache/projects/flux-skills/docs/execution-surface-policy.md)
- [fluxos-cli README](/home/stache/projects/flux-skills/fluxos-cli/README.md)
- [flux-mcp README](/home/stache/projects/flux-skills/flux-mcp/README.md)
