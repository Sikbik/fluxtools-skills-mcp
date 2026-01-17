---
name: flux-cloud
description: "Operate Flux Cloud/FluxOS nodes and Flux apps via API: authentication (zelidauth), v8 app specs, pricing, signing, lifecycle ops, logs/inspect/stats, files, syncthing, daemon RPC proxy, explorer, backup, and troubleshooting."
---

# Flux Cloud (FluxOS) — Skill

Use this skill to help users operate Flux nodes and Flux apps via the HTTP API.

Source-of-truth code references use the public repo: `https://github.com/RunOnFlux/flux`.

## Ask first (required context)

- Node API base URL (direct node preferred): `http://<node-ip>:16127`
- What you’re allowed to do (read-only vs lifecycle/system changes)
- App name (and component name for composed apps)
- App owner’s ZelID/Flux address (never ask for private keys)

## Quick health checks

If the MCP server is connected, prefer:
- `flux_node_health`
- `flux_auth_diagnose`
- `flux_app_health_report`

## Standard operating procedure (SOP)

- Prefer dedicated `flux_*` tools over `flux_request`.
- When a tool returns `resource_link`, read it (MCP `resources/read`) and summarize.
- If the client UI does not expose MCP resources, use `flux_resource_read` with the same URI.
- Keep chat output compact: summarize first, then only quote relevant snippets.

```bash
API="http://<node-ip>:16127"

curl -sS "$API/flux/version"
curl -sS "$API/flux/info"
curl -sS "$API/flux/isarcaneos"
```

## Authentication (two layers)

- API auth uses the `zelidauth` header (signed login phrase).
- App registration/update also requires a separate signature over an exact message string.

Use:
- `references/auth-zelidauth.md`
- `references/signing.md`

## Endpoint discovery (complete)

- Full inventory (human): `references/endpoints-inventory.md`
- Machine-readable inventory: `references/endpoints.json`

These are generated from `ZelBack/src/routes.js` in the public Flux repo.

## Workflow index

### 1) Node + daemon diagnostics

- Start with `/flux/*` for node health and FluxOS services.
- Use `/daemon/*` for daemon/RPC-style queries (chain, network, wallet, etc).

Use:
- `references/flux-api.md`
- `references/daemon-api.md`

### 2) Create a v8 app spec

- Build a v8 spec, then canonicalize/validate server-side before signing.

Use: `references/app-spec-v8.md`.

### 3) Estimate price

- POST the spec to the pricing endpoint.
- Use registration info to understand port rules and constraints.

Use: `references/api-endpoints.md`.

### 4) Register/update an app (network-level)

- Prefer `flux_apps_plan_registration` / `flux_apps_plan_update` (auto-canonicalizes the spec).
- Prefer direct node base URLs; if starting from a gateway, use tools with `resolveGateway=true` (now default).
- Submit `flux_apps_register` / `flux_apps_update` with the owner signature.
- `flux_apps_test_install` with the registration hash (requires `confirm=true`).
- Payment: use `flux_apps_register_and_verify.payment.address` (or `flux_apps_plan_registration.payment.address`). Amount is `payment.amountFlux`. Memo must be the registration hash.

Use:
- `references/signing.md`
- `scripts/build-app-message.js`

### 5) Operate an app (lifecycle + observability)

Use: `references/lifecycle-observability.md`.

### 6) Files and persistence

Use: `references/storage-mounts.md`.

### 7) Syncthing + node services

Use: `references/syncthing-api.md`.

### 8) Explorer + payments

Use:
- `references/explorer-api.md`
- `references/payment-api.md`

### 9) Backups, benchmarks, maintenance

Use:
- `references/backup-api.md`
- `references/benchmark-api.md`

## References (load as needed)

- `references/api-endpoints.md` — quick overview + key endpoints
- `references/endpoints-inventory.md` — full generated route list
- `references/auth-zelidauth.md` — login phrase + `zelidauth` header
- `references/flux-api.md` — `/flux/*` node APIs
- `references/daemon-api.md` — `/daemon/*` RPC proxy APIs
- `references/syncthing-api.md` — `/syncthing/*` service APIs
- `references/explorer-api.md` — `/explorer/*` chain data APIs
- `references/payment-api.md` — `/payment/*` helpers
- `references/backup-api.md` — `/backup/*` helpers
- `references/benchmark-api.md` — `/benchmark/*` helpers
- `references/ioutils-api.md` — `/ioutils/*` upload helper
- `references/app-spec-v8.md` — schema, rules, examples
- `references/signing.md` — canonicalization + message-to-sign workflow
- `references/lifecycle-observability.md` — lifecycle, logs, inspect, exec
- `references/storage-mounts.md` — containerData, mounts, volume browser
- `references/arcane-enterprise.md` — Arcane detection + enterprise constraints
- `references/troubleshooting.md` — common failure modes + checklists
