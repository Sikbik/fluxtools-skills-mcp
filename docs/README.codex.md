# Fluxtools For Codex

Fluxtools works best in Codex as:

- shared native skills from `skills/`
- `fluxos-cli` as the primary execution surface
- optional `flux-mcp` as an interactive fallback

## Install

Packaged install:

- `npm i -g fluxtools`
- `fluxtools install codex`
- `fluxtools doctor codex`

Manual or repo-local setup:

- [.codex/INSTALL.md](/home/stache/projects/flux-skills/.codex/INSTALL.md)

## Expected behavior

- `using-fluxtools` should route Flux work to focused domain skills
- the skills should default to `flux ... --json`
- MCP should only be used when explicitly requested or when it is the better fallback surface

## Read next

- [execution-surface-policy.md](/home/stache/projects/flux-skills/docs/execution-surface-policy.md)
- [fluxos-cli README](/home/stache/projects/flux-skills/fluxos-cli/README.md)
- [flux-mcp README](/home/stache/projects/flux-skills/flux-mcp/README.md)
