---
name: flux-cloud
description: Use when working with Flux Cloud or FluxOS from Claude. This adapter routes work into the shared Fluxtools skills library and keeps execution CLI-first with MCP fallback.
---

# Flux Cloud (Claude Adapter)

This is the Claude-facing adapter for the shared Fluxtools skills library.

If the top-level `skills/` library has been installed into native skill discovery, prefer those skills directly. If not, use this adapter and read the shared skill files below as needed.

## Start here

Always begin with:

- [using-fluxtools](/home/stache/projects/flux-skills/skills/using-fluxtools/SKILL.md)

That skill sets the routing rules:

- CLI-first with `fluxos-cli`
- one primary surface per workflow
- MCP only when explicitly useful or needed as fallback

## Skill map

After loading `using-fluxtools`, load the relevant shared skill:

- auth, signer setup, gateway/base URL targeting:
  - [flux-auth-session](/home/stache/projects/flux-skills/skills/flux-auth-session/SKILL.md)
- app deploy, update, renew, Git deploy, signing, propagation:
  - [flux-app-deployments](/home/stache/projects/flux-skills/skills/flux-app-deployments/SKILL.md)
- logs, inspect, monitor, lifecycle, runtime debugging:
  - [flux-runtime-operations](/home/stache/projects/flux-skills/skills/flux-runtime-operations/SKILL.md)
- files, backups, FluxDrive:
  - [flux-storage-backups](/home/stache/projects/flux-skills/skills/flux-storage-backups/SKILL.md)
- explorer, daemon, node analytics, Syncthing:
  - [flux-network-services](/home/stache/projects/flux-skills/skills/flux-network-services/SKILL.md)
- MCP-only fallback and `resource_link` handling:
  - [flux-mcp-fallback](/home/stache/projects/flux-skills/skills/flux-mcp-fallback/SKILL.md)

## Claude defaults

- prefer `flux ... --json`
- keep results compact
- reuse resource URIs and plan artifacts instead of pasting long JSON
- do not run the same workflow across CLI and MCP unless there is a specific fallback reason

## MCP note

Claude may be running with Flux MCP already connected. That does not make MCP the default. Stay CLI-first unless the shared routing policy says to switch.

## References

- [execution-surface-policy.md](/home/stache/projects/flux-skills/docs/execution-surface-policy.md)
- [fluxos-cli README](/home/stache/projects/flux-skills/fluxos-cli/README.md)
- [flux-mcp README](/home/stache/projects/flux-skills/flux-mcp/README.md)
- [MCP setup](/home/stache/projects/flux-skills/claude/flux-cloud/references/mcp-setup.md)
