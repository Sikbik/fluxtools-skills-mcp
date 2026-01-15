# Flux Cloud / FluxOS API Overview

## Base URLs

- UI gateway: `https://cloud.runonflux.com`
- Public API gateway: `https://api.runonflux.io`
- Direct node:
  - UI: `http://<node-ip>:16126/`
  - API: `http://<node-ip>:16127/`

## Response envelope

Most endpoints respond with:

```json
{ "status": "success", "data": ... }
```

## Quick health checks

```bash
API="http://<node-ip>:16127"

curl -sS "$API/flux/version"
curl -sS "$API/flux/info"
curl -sS "$API/flux/isarcaneos"
```

## Global vs node-local apps

Flux has two different “app list” concepts:

- Node-local lists (`/apps/listrunningapps`, `/apps/listallapps`): containers/apps running on the specific node you’re talking to.
- Global registry (`/apps/globalappsspecifications`): apps registered under a ZelID on the network (what most users mean by “my apps”).

In MCP, prefer `flux_apps_list_by_zelid_with_expiry` for “my apps” (global + expiry).

## Authentication (`zelidauth`)

1) Get a login phrase:

```bash
curl -sS "$API/id/loginphrase"
```

If `/id/loginphrase` fails due to node health/DOS checks, use the emergency variant:

```bash
curl -sS "$API/id/emergencyphrase"
```

2) Sign the phrase with your ZelID.

3) Send requests with the header:

```text
zelidauth: {"zelid":"<ZELID>","signature":"<SIG>","loginPhrase":"<PHRASE>"}
```
