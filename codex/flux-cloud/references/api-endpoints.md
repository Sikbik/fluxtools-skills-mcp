# Flux Cloud / FluxOS API — Overview

All source links below point to `https://github.com/RunOnFlux/flux` (branch: `master`).

Routes are defined in [`ZelBack/src/routes.js`](https://github.com/RunOnFlux/flux/blob/master/ZelBack/src/routes.js).

For a complete, generated endpoint list (all 400+ routes), see:

- `references/endpoints-inventory.md`
- `references/endpoints.json`

## Base URLs

- UI gateway: `https://cloud.runonflux.com`
- API gateway: `https://api.runonflux.io`
- Direct node (recommended for debugging):
  - UI: `http://<node-ip>:16126/`
  - API: `http://<node-ip>:16127/`

## Response envelope

Most endpoints respond with:

```json
{ "status": "success", "data": ... }
```

Notes:

- For automation, treat `data` as the real payload; `status` is usually `success`/`error`.
- Some endpoints may return a plain object/array (especially on proxies or older routes). In MCP we normalize by unwrapping when possible.

## Error behavior

Common patterns you’ll see:

- Privilege/auth errors when `zelidauth` is missing or invalid (user/owner/fluxteam).
- Gateway timeouts (notably `https://api.runonflux.io`) for some auth calls; direct node APIs are more reliable.
- Large payloads (logs, specs, monitoring) which are unwieldy to print in chat; MCP returns `resource_link` for these.

## Quick node health

```bash
curl -sS http://<node-ip>:16127/flux/version
curl -sS http://<node-ip>:16127/flux/info
curl -sS http://<node-ip>:16127/flux/isarcaneos
```

## Authentication

- Get a login phrase: `GET /id/loginphrase` (or `GET /id/emergencyphrase` if loginphrase fails)
- Sign it with your ZelID
- Send API calls with:

`zelidauth: {"zelid":"<ZELID>","signature":"<SIG>","loginPhrase":"<PHRASE>"}`

See: `references/auth-zelidauth.md`.

## App essentials

Discovery:

```bash
# Node-local runtime state (what this node is running)
curl -sS http://<node-ip>:16127/apps/listrunningapps
curl -sS http://<node-ip>:16127/apps/listallapps

# Global registry state (apps registered on the network)
# Use owner to list apps under a ZelID:
curl -sS "http://<node-ip>:16127/apps/globalappsspecifications?owner=<ZELID>"

# Fetch a specific app spec (from this node’s local view)
curl -sS http://<node-ip>:16127/apps/appspecifications/<appname>
```

## Global vs node-local apps

Flux has two different “app list” concepts:

- Node-local lists (`/apps/listrunningapps`, `/apps/listallapps`): containers/apps running on the specific node you’re talking to.
- Global registry (`/apps/globalappsspecifications`): apps registered under a ZelID on the network (what most users mean by “my apps”).

In MCP, `flux_apps_list_by_zelid_with_expiry` uses the global registry and computes expiry from chain height.

Spec validation (canonicalization):

- `POST /apps/verifyappregistrationspecifications`
- `POST /apps/verifyappupdatespecifications`

Pricing:

- `POST /apps/calculateprice`
- `POST /apps/calculatefiatandfluxprice`
- `GET /apps/registrationinformation`

Network register/update:

- `POST /apps/appregister` → returns a `hash`
- `POST /apps/appupdate` → returns a `hash`

Confirm message propagation:

- `GET /apps/temporarymessages/<hash>`
- `GET /apps/permanentmessages/<hash>`

See: `references/signing.md`.
