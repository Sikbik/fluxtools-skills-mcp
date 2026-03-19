---
name: flux-app-deployments
description: Use for Flux app spec generation, verification, pricing, registration, updates, renewals, signing flows, Git deployments, payment handling, and propagation checks.
---

# Flux App Deployments

Use this skill for any network-level app delivery workflow.

## CLI-first workflow

Prefer:

- `flux apps generate-spec ... --json`
- `flux apps verify-registration --spec-file <path> --json`
- `flux apps verify-update --spec-file <path> --json`
- `flux apps calculate-price --spec-file <path> --json`
- `flux apps plan-registration --spec-file <path> --json`
- `flux apps plan-update --spec-file <path> --json`
- `flux apps plan-renew <appname> --json`
- `flux apps register ... --signature <sig> --json`
- `flux apps update ... --signature <sig> --json`
- `flux apps register-and-verify ... --signature <sig> --confirm --json`
- `flux apps update-and-verify ... --signature <sig> --confirm --json`
- `flux apps wait-propagation <hash> --json`
- `flux apps messages <hash> --json`

Git deploy flow:

- `flux git generate-spec ... --json`
- `flux git plan-registration ... --json`
- `flux git register-and-verify --plan-resource-uri <uri> --signature <sig> --confirm --json`

## Rules

- always sign the canonicalized plan output, not a hand-edited copy
- reuse plan artifacts and message resources instead of rebuilding payloads inline
- keep owner signing separate from API auth
- prefer direct nodes for auth and submission workflows

## Payment and launchers

- prefer returned payment or signing launchers when available
- current signing UX supports both Zelcore and SSP Wallet

## When to use MCP instead

Use MCP only when:

- the user explicitly asked for MCP
- the CLI is blocked
- an MCP `resource_link` flow is materially easier than continuing in the shell

Relevant MCP tools:

- `flux_generate_app_spec_v8`
- `flux_apps_verify_registration_spec`
- `flux_apps_verify_update_spec`
- `flux_apps_calculate_price`
- `flux_apps_plan_registration`
- `flux_apps_plan_update`
- `flux_apps_plan_renew`
- `flux_apps_register`
- `flux_apps_update`
- `flux_apps_register_and_verify`
- `flux_apps_update_and_verify`
- `flux_apps_wait_for_propagation`
- `flux_apps_get_messages`
- `flux_git_deploy_generate_spec_v8`
- `flux_git_deploy_plan_registration`
- `flux_git_deploy_register_and_verify`

## References

- [README.md](/home/stache/projects/flux-skills/fluxos-cli/README.md)
- [register-update.md](/home/stache/projects/flux-skills/claude/flux-cloud/references/register-update.md)
- [app-spec-v8.md](/home/stache/projects/flux-skills/codex/flux-cloud/references/app-spec-v8.md)
- [git-deployments.md](/home/stache/projects/flux-skills/codex/flux-cloud/references/git-deployments.md)
- [signing.md](/home/stache/projects/flux-skills/codex/flux-cloud/references/signing.md)
