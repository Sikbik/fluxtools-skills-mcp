---
name: flux-auth-session
description: Use for Flux node targeting, gateway resolution, ZelID authentication, session state, launcher flows, and signer setup before any owner or privileged workflow.
---

# Flux Auth And Session

Use this skill for:

- choosing a direct node or gateway
- resolving gateway to a direct node
- ZelID login phrase flows
- `zelidauth` session setup and diagnostics
- signer/session preflight before deploy or owner workflows

## CLI-first workflow

Prefer:

- `flux node resolve-gateway [<gateway-base-url>] --json`
- `flux node use-gateway [<gateway-base-url>] --json`
- `flux node use-base-url <base-url> --json`
- `flux auth phrase --zelid <zelid> --json`
- `flux auth login --zelid <zelid> --json`
- `flux auth login --zelid <zelid> --login-phrase <phrase> --signature <sig> --json`
- `flux auth status --json`
- `flux auth diagnose --json`
- `flux state show --json`

## Important distinctions

- `zelidauth` authenticates API calls.
- app registration and update require a separate owner signature over the exact message-to-sign.
- do not conflate these signatures.

## Launcher guidance

If the auth workflow returns a launcher URL, prefer it over copying long signing text manually. Current launcher UX supports both Zelcore and SSP Wallet.

## When to use MCP instead

Use MCP only when:

- the user explicitly wants the MCP flow
- you need MCP `resource_link` handling
- the CLI auth path is blocked or not available

Relevant MCP tools:

- `flux_get_state`
- `flux_resolve_gateway_node`
- `flux_set_base_url_from_gateway`
- `flux_set_base_url`
- `flux_auth_flow`
- `flux_auth_login`
- `flux_auth_diagnose`

## References

- [docs/execution-surface-policy.md](/home/stache/projects/flux-skills/docs/execution-surface-policy.md)
- [README.md](/home/stache/projects/flux-skills/fluxos-cli/README.md)
- [auth-zelidauth.md](/home/stache/projects/flux-skills/codex/flux-cloud/references/auth-zelidauth.md)
- [signing.md](/home/stache/projects/flux-skills/codex/flux-cloud/references/signing.md)
