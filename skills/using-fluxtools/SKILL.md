---
name: using-fluxtools
description: Use at the start of any Flux Cloud or FluxOS task. Routes the work to the right Fluxtools skill, enforces CLI-first execution, and keeps one primary surface per workflow.
---

# Using Fluxtools

Use this skill first for any Flux Cloud or FluxOS task.

## Core rules

- Default to `fluxos-cli`.
- Keep one primary execution surface per workflow.
- Use `flux-mcp` only when:
  - the user explicitly wants MCP
  - MCP resources are materially better for the task
  - the CLI is unavailable, stuck, or needs help
- Use raw HTTP only when neither wrapped surface covers the task.

Read [docs/execution-surface-policy.md](/home/stache/projects/flux-skills/docs/execution-surface-policy.md) if you need the full routing policy.

## Working style

- Prefer `flux ... --json` for machine-consumed output.
- Use `--pretty` only for human-facing terminal output.
- Use `--base-url <url>` for one-off target changes.
- Use `--no-state` for one-off reads that should not persist session data.
- Reuse persisted CLI artifacts with `--from-resource-uri <uri>` instead of pasting large JSON back into chat.
- Summarize results. Do not dump large payloads unless the user asked.

## Skill routing

Load the relevant follow-up skill before doing substantive work:

- Authentication, base URL selection, ZelID login, and signer/session setup:
  - `skills/flux-auth-session/SKILL.md`
- Spec generation, registration, updates, renewals, Git deploys, signing, and propagation:
  - `skills/flux-app-deployments/SKILL.md`
- Logs, inspect, stats, monitor, exec, lifecycle control, and app troubleshooting:
  - `skills/flux-runtime-operations/SKILL.md`
- Volume files, backups, FluxDrive, and persistent app data workflows:
  - `skills/flux-storage-backups/SKILL.md`
- Explorer, daemon, network analytics, node targeting, and Syncthing:
  - `skills/flux-network-services/SKILL.md`
- Interactive MCP fallback workflows and `resource_link` handling:
  - `skills/flux-mcp-fallback/SKILL.md`

## Safety rules

- Do not perform mutations without explicit confirmation.
- Do not ask the user to sign anything until the exact message-to-sign has been produced by the wrapped workflow.
- Keep API auth signatures and app owner signatures clearly separated.
- Prefer direct nodes for auth, lifecycle operations, and deep troubleshooting.

## Product model

Treat this repository as one Fluxtools plugin with multiple adapters:

- shared skills in `skills/`
- primary execution surface in `fluxos-cli/`
- MCP fallback surface in `flux-mcp/`
- shared behavior in `shared-runtime/`
- thin platform adapters in `.codex/`, `.opencode/`, `.claude-plugin/`, and related client folders
