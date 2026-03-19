# FluxOS CLI Architecture

`fluxos-cli` is now the primary execution surface for agent workflows in this repository.

This file describes how the CLI fits into the broader plugin model. The shared routing contract lives in [docs/execution-surface-policy.md](/home/stache/projects/flux-skills/docs/execution-surface-policy.md).

## Long-term model

The preferred long-term architecture is:

- `fluxos-cli` is the default operational surface for agents and automation
- `flux-mcp` remains an optional interactive surface and recovery path
- `shared-runtime` carries shared Flux operational behavior where reuse is worth it
- top-level Fluxtools skills in `skills/` route users to the CLI
- Codex, Claude, OpenCode, Gemini, and future adapters stay thin and primarily route users to the CLI

This repository should not evolve into:

- skills that try to drive CLI and MCP in parallel
- MCP wrapping the CLI by default
- a CLI that becomes a thin shell over chat-oriented prompts
- multiple surfaces that implement different auth, signing, mutation, or planning semantics

## Why the CLI is primary

`fluxos-cli` is the better default for LLM-driven execution because it has:

- lower context overhead than MCP tool catalogs
- stable `--json` contracts
- shell-native composition with files, pipes, and exit codes
- better fit for CI, task runners, and scripted operations
- easier recovery patterns when a workflow needs retries or incremental validation

## Role of MCP

`flux-mcp` remains valuable, but in a narrower role:

- interactive MCP-capable clients
- workflows that benefit from `resource_link` behavior
- environments where shell execution is unavailable or undesirable
- fallback when the CLI is blocked or needs troubleshooting help

## Routing rules

The operational rules are:

1. default to the CLI
2. keep one primary execution surface per workflow
3. switch surfaces only for a concrete reason
4. use raw HTTP only as the last fallback

Valid reasons to switch away from the CLI:

- the user explicitly requested MCP
- the current client has excellent MCP support and the workflow benefits from it
- the CLI is unavailable, failing, or stuck
- a narrow MCP resource handoff is materially better than continuing in the shell

## Adapter model

This repo should behave like one Flux plugin with multiple adapters:

- core routing policy: [docs/execution-surface-policy.md](/home/stache/projects/flux-skills/docs/execution-surface-policy.md)
- shared skills: `skills/`
- shared behavior: `shared-runtime/`
- CLI adapter: `fluxos-cli/`
- MCP adapter: `flux-mcp/`
- client wrappers and plugin surfaces: `codex/flux-cloud/`, `claude/flux-cloud/`, `.codex/`, `.opencode/`, `.claude-plugin/`, `.cursor-plugin/`, and `GEMINI.md`

The wrappers should not each invent their own workflow model. They should mainly:

- choose the surface
- keep prompts small
- teach the right command family
- expose the fallback path when needed

## Context control

To keep agents from burning tokens:

- do not narrate both CLI and MCP flows unless the user asked for options
- do not list every command family on every task
- do not repeat the same operation across surfaces
- prefer persisted artifacts and resource URIs to long inline payloads
- prefer targeted `flux` commands over generic explanations about the entire platform

## Shared-runtime boundary

The preferred split remains:

- CLI owns parsing, output, state persistence, profiles, file contracts, and shell UX
- MCP owns tool schemas, resource transport, and interactive session behavior
- shared runtime owns Flux operational behavior where divergence would be dangerous

This means some duplication is acceptable:

- CLI routing and formatting
- skill-specific examples
- MCP-specific resource guidance

This duplication is still worth avoiding:

- auth semantics
- signing payload construction
- mutation gating
- registration/update/renew logic
- endpoint classification rules

## Current decision

Current repository direction:

- CLI-first by default
- MCP-compatible and kept healthy
- skills act as routing and guidance layers, not execution engines
- shared behavior is reused when it meaningfully reduces maintenance cost
