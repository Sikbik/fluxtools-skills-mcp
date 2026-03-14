# FluxOS CLI

`fluxos-cli` is the shell-native execution surface for Flux operations in this repository.

It complements `flux-mcp` instead of replacing it:

- use MCP when the client already supports tool calling cleanly
- use the CLI when you want shell access, CI integration, scripts, cron, or agent workflows that do not speak MCP

Architecture guidance for how the CLI fits with MCP and skills lives in [`ARCHITECTURE.md`](./ARCHITECTURE.md).

## What it does

The CLI exposes first-class commands for:

- auth and session management
- profile and state management
- app discovery, troubleshooting, lifecycle control, and deployment
- git-driven deployment flows
- explorer queries and explorer maintenance
- daemon/network inspection
- app files, backups, and FluxDrive operations
- Syncthing administration
- generic shared-tool execution through `flux tool`
- persisted resource artifacts for large JSON payloads and reusable workflow outputs

## Current workflow model

The CLI is built around a few stable ideas:

- `--json` is the primary machine contract
- mutations keep explicit confirmation semantics
- reusable outputs can be persisted as CLI resources
- command composition should not require hand-written raw API calls
- CLI surface code can be CLI-specific, but Flux operational behavior stays aligned with the shared MCP runtime

## Build and run

```bash
npm --prefix fluxos-cli ci
npm --prefix fluxos-cli run build
node fluxos-cli/dist/index.js --help
```

For local development:

```bash
npm --prefix fluxos-cli test
npm --prefix fluxos-cli run build
```

## Output and automation contract

Use the CLI like this in automation:

- prefer `--json` for anything machine-consumed
- use `--pretty` for humans
- use `--raw` only when you want the underlying payload without the CLI envelope
- expect non-zero exit codes for validation, auth, confirm, network, and Flux failures
- treat stderr as operational/error text and stdout as the main contract surface

## Composition helpers

Invocation-scoped workflow helpers:

- `--profile <name>` selects a persisted profile without changing the saved active profile
- `--base-url <url>` overrides the effective Flux node base URL for just one command
- `--no-state` disables persisted session hydration and persistence for one invocation
- `--output-file <path>` mirrors stdout to a file after the command completes
- `--from-resource-uri <uri>` lets compatible commands reuse a persisted CLI artifact directly

Supported `--from-resource-uri` paths:

- `flux tool call ...`
- spec-oriented app commands such as verify, price, and plan
- app submission commands such as register/update/register-and-verify/update-and-verify
- `flux git register-and-verify`

## Large payload strategy

The CLI already supports large payload inputs without requiring huge inline shell strings:

- `flux tool call ... --args-file path.json`
- app commands that accept `--spec-file`
- resource-backed composition via `--from-resource-uri`
- file mirroring through `--output-file`

## Examples

Examples live here:

- [`examples/agent/README.md`](./examples/agent/README.md)
- [`examples/ci/README.md`](./examples/ci/README.md)
- [`examples/bash/README.md`](./examples/bash/README.md)
- [`examples/github-actions/README.md`](./examples/github-actions/README.md)

## Shell mode decision

`flux shell` is explicitly deferred for v1.

Reasoning:

- the current priority is a stable one-command JSON contract for agents and automation
- persistent shell state would add a second UX model before the first one is fully hardened
- the CLI already has profile, state, resource, and composition features that cover the highest-value non-interactive workflows

The current decision is:

- no interactive shell mode for v1
- no REPL-style session reuse for v1
- no in-process resource retention mode for v1

If that changes later, it should happen after release hardening and only if it clearly improves automation rather than complicating it.
