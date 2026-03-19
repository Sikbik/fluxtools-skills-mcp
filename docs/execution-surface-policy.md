# Execution Surface Policy

This repository should behave like one Flux operations plugin with multiple adapters, not like three competing products.

## Product model

- `fluxos-cli` is the primary execution surface for LLMs, automation, CI, scripts, and shell-native workflows.
- `flux-mcp` remains a supported interactive surface for clients that have strong MCP support or need resource-backed tool sessions.
- `shared-runtime` remains the source of truth for Flux operational behavior where reuse is practical.
- shared skills in `skills/` should own workflow guidance.
- client wrappers for Codex, Claude, OpenCode, Gemini, and other clients should stay thin and route users to one surface at a time.
- packaged installs may provision MCP alongside the CLI, but skills should still keep the workflow CLI-first unless MCP is clearly the better fit.

## Routing rules

1. Default to `fluxos-cli`.
2. Use one primary execution surface per workflow.
3. Switch surfaces only for a concrete reason:
   - the user explicitly asked for MCP
   - the client has strong MCP support and the task benefits from interactive tools or MCP resources
   - the CLI is blocked, stuck, or unavailable
   - a narrow artifact handoff is materially easier on the other surface
4. Use raw HTTP only when neither `fluxos-cli` nor `flux-mcp` covers the required operation.

## When to prefer the CLI

Prefer `fluxos-cli` when:

- the agent has shell access
- the task is automation-oriented
- stable `--json` output is the best contract
- the workflow needs pipes, files, exit codes, or retries
- the task is large enough that MCP tool schema and resource narration would waste context

## When to prefer MCP

Prefer `flux-mcp` when:

- the user explicitly wants MCP
- the client already has excellent MCP tool and resource support
- the workflow benefits from interactive `resource_link` handling
- the CLI is not installed, is misbehaving, or cannot be used safely in the current environment

## Context discipline

To prevent context bloat:

- do not explain MCP, CLI, and raw HTTP in parallel unless the user asked for options
- do not repeat the same read or mutation on multiple surfaces "just in case"
- do not enumerate every tool or command family unless the user asked for a catalog
- prefer one concrete command or tool sequence over broad capability dumps
- summarize large results instead of pasting payloads
- prefer persisted artifacts and resource URIs over long inline JSON

## Skill responsibilities

Skills should:

- route to the right surface first
- keep the user on that surface for the whole workflow
- expose MCP as a fallback, not as a shadow copy of the CLI workflow
- keep surface-specific instructions short and operational
- avoid teaching client-specific ceremony unless setup is the task

## Independence requirements

Each surface must remain useful on its own:

- `fluxos-cli` must remain usable without MCP
- `flux-mcp` must remain usable without the CLI
- skills must not become a hidden runtime layer

## Current repository direction

The current direction is:

- CLI-first for agentic execution
- MCP-compatible for interactive clients and recovery paths
- shared behavior where it reduces real maintenance cost
- thin adapters per client so the repo can function like one plugin across multiple LLM environments
