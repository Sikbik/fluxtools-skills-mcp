# FluxOS CLI Architecture

## Long-term model

The preferred long-term architecture is:

- `flux-mcp` and `fluxos-cli` remain peer execution surfaces
- both reuse shared Flux operational behavior where it matters
- skills can recommend either surface depending on client capabilities

This repository should not evolve into:

- MCP wrapping the CLI by default
- the CLI reimplementing Flux business logic independently
- two divergent products with different auth, signing, mutation, or planning semantics

## Execution surface choice

Prefer `flux-mcp` when:

- the client supports MCP well
- tool calling and MCP resources are available
- the workflow benefits from interactive tool use inside the client

Prefer `fluxos-cli` when:

- the agent only has shell access
- the workflow runs in CI, cron, scripts, or task runners
- JSON-over-stdout is the easiest contract
- MCP is unavailable or inconvenient in the current environment

## Skill guidance

Skills should follow this order:

1. use MCP first when the client supports it
2. use `fluxos-cli` when shell execution is easier or MCP is unavailable
3. fall back to raw HTTP only when neither surface is available for the needed operation

## MCP-to-CLI fallback decision

Current decision:

- do not make MCP handlers shell out to `fluxos-cli`

Reasoning:

- it adds wrapper-on-wrapper indirection
- it complicates debugging and error attribution
- it weakens the boundary between transport and domain behavior
- it does not reduce maintenance enough yet to justify the extra coupling

If this decision is revisited later, it should be because a clearly shared runtime layer has reduced duplication enough to justify it, not because one surface temporarily lags behind the other.
