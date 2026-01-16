# Flux Cloud / FluxOS API — Overview

All source links below point to `https://github.com/RunOnFlux/flux` (branch: `master`).

Routes are defined in [`ZelBack/src/routes.js`](https://github.com/RunOnFlux/flux/blob/master/ZelBack/src/routes.js).

For a complete, generated endpoint list (all 400+ routes), see:

- `references/endpoints-inventory.md`
- `references/endpoints.json`

## Base URLs and ports

- UI gateway: `https://cloud.runonflux.com`
- API gateway: `https://api.runonflux.io`
- Direct node (recommended for debugging):
  - UI: `http://<node-ip>:16126/`
  - API: `http://<node-ip>:16127/`

Tip: prefer a direct node for auth and troubleshooting; gateways can time out or route to different nodes.

## Response envelope + exceptions

Most endpoints respond with:

```json
{ "status": "success", "data": ... }
```

Notes:

- For automation, treat `data` as the real payload; `status` is usually `success`/`error`.
- Some routes may return a plain object/array (older/proxy routes). In MCP we normalize by unwrapping when possible.
- Transport success (HTTP 200) can still mean Flux-level failure (`status: "error"`).

## Gateway vs direct node tradeoffs

- Gateways (`https://api.runonflux.io`) are convenient but can be less reliable for some auth flows and may route to a different backing node over time.
- Direct node (`http://<node-ip>:16127`) is preferred for debugging and consistent state.
- In MCP, `flux_set_base_url_from_gateway` resolves the current node and sets the base URL.

## GET routes that mutate

Some Flux APIs use `GET` for actions that change state (service restarts, redeploys, explorer maintenance). Treat these as mutations even though they’re GET.

In MCP:

- lifecycle/maintenance tools require `confirm=true`
- generic calls via `flux_request` require `allowMutation=true`

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

## Authentication and privilege levels

API authentication uses the `zelidauth` header.

- Get a login phrase: `GET /id/loginphrase` (or `GET /id/emergencyphrase` if loginphrase fails)
- Sign it with your ZelID
- Send API calls with:

`zelidauth: {"zelid":"<ZELID>","signature":"<SIG>","loginPhrase":"<PHRASE>"}`

Privileges vary by endpoint. Common labels you’ll see in the inventory:

- `PUBLIC`: no auth
- `USER`: requires a valid `zelidauth`
- `OWNER`: requires the app owner’s ZelID
- `FluxTeam`: elevated privileges

See: `references/auth-zelidauth.md`.

### Playbook: Auth not working

1) Prefer a direct node base URL for troubleshooting: `http://<node-ip>:16127`

2) Quick node sanity:

```bash
curl -sS http://<node-ip>:16127/flux/version
curl -sS http://<node-ip>:16127/flux/info
```

3) Get a login phrase (fallback if it fails):

```bash
curl -sS http://<node-ip>:16127/id/loginphrase
curl -sS http://<node-ip>:16127/id/emergencyphrase
```

4) Sign the phrase with your ZelID and verify login:

- MCP-first:
  - `flux_get_login_phrase` (or `flux_get_emergency_phrase`)
  - user signs phrase
  - `flux_verify_login`
  - `flux_build_zelidauth` + `flux_set_zelidauth`

5) Validate privileges:

- `flux_check_privilege`

6) Common failure modes:

- Using the API gateway (`https://api.runonflux.io`) for loginphrase can fail intermittently; resolve a node and retry.
- Timestamp/login phrase mismatch: ensure you sign the exact returned phrase.
- Wrong ZelID signing method: confirm the wallet is signing plain text, not hashing it first.

### Playbook: My apps (global) vs running apps (node)

Flux has two different sources of truth depending on the question:

- “What apps do I own (registered on the network)?” → global registry
- “What is this specific node currently running?” → node-local runtime

#### Global apps (owned by a ZelID)

- MCP-first:
  - `flux_apps_list_by_zelid_with_expiry { zelid?, includeExpired? }`
  - `flux_apps_global_status { zelid?, appname? }` (adds propagation + (optionally) location/runtime correlation)

- curl:

```bash
curl -sS "http://<node-ip>:16127/apps/globalappsspecifications?owner=<ZELID>"
```

If you care about propagation or deployment, start with:

- `flux_apps_global_status { zelid, appname }`

#### Node-local running apps

This answers “what containers are running on the node I’m talking to?”

- MCP-first:
  - `flux_apps_list_running`

- curl:

```bash
curl -sS http://<node-ip>:16127/apps/listrunningapps
```

#### When they disagree

- It’s normal for “registered globally” but “not running on this node” (the app may be on other nodes).
- Use `flux_apps_global_status { appname }` to see:
  - whether the app is expiring
  - whether messages are propagated (temp/permanent)
  - whether the current node reports it as running

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
