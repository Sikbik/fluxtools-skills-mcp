# Fluxtools For OpenCode

Fluxtools works in OpenCode as:

- an OpenCode plugin bootstrap from `.opencode/plugins/fluxtools.js`
- shared native skills from `skills/`
- `fluxos-cli` as the primary execution surface
- `flux-mcp` provisioned through OpenCode config as an interactive fallback

## Install

Packaged install:

- `npm i -g fluxtools`
- `fluxtools install opencode`
- `fluxtools doctor opencode`

Manual or repo-local setup:

- [.opencode/INSTALL.md](/home/stache/projects/flux-skills/.opencode/INSTALL.md)

## Expected behavior

- the OpenCode plugin injects the `using-fluxtools` bootstrap skill content
- shared Fluxtools skills remain discoverable through OpenCode's native skill system
- `fluxtools install opencode` writes a global MCP entry to `~/.config/opencode/opencode.json`
- the skills stay CLI-first and use MCP only when it is the better fallback surface

## Read next

- [execution-surface-policy.md](/home/stache/projects/flux-skills/docs/execution-surface-policy.md)
- [fluxos-cli README](/home/stache/projects/flux-skills/fluxos-cli/README.md)
- [flux-mcp README](/home/stache/projects/flux-skills/flux-mcp/README.md)
