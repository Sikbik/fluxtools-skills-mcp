---
name: flux-cloud
description: Operate Flux Cloud/FluxOS nodes and Flux apps via API: ZelID/zelidauth auth, v8 app specs, pricing, appregister/appupdate signing flow, lifecycle (start/stop/redeploy), logs/inspect/stats, and troubleshooting.
---

# Flux Cloud — LLM Operations Skill (Groundwork)

This document is a reusable “skill” spec for any LLM (Claude/ChatGPT/Gemini/Codex) to operate Flux Cloud / FluxOS nodes, create and manage applications, and troubleshoot deployments using the API.

Source-of-truth code references use the public repo: `https://github.com/RunOnFlux/flux` (no local clone required).

## Contents

- [API Basics](#api-basics)
- [Authentication](#authentication)
- [App Discovery](#app-discovery-read-only)
- [Creating an Application (v8)](#creating-an-application-flux-app-specs-v8)
- [Validate/Canonicalize Specs](#canonicalizevalidate-a-spec-do-this-before-signing)
- [Build the Message to Sign](#build-the-message-to-sign-practical)
- [Calculate Price](#calculate-price-flux--usd)
- [Register a New App](#register-a-new-app-network-level)
- [Update an Existing App](#update-an-existing-app-network-level)
- [Manage an App on a Node](#manage-an-app-on-a-node-lifecycle--observability)
- [App Files & Persistence](#app-files--persistence)
- [ArcaneOS & Enterprise Apps](#arcaneos--enterprise-apps-v8)
- [Troubleshooting](#troubleshooting-playbook-high-signal-checks)
- [Snippets](#snippets-safe-defaults)
- [References](#references)

## Operating Principles (What the LLM Must Do)

1. **Confirm scope + authorization**: Ask who owns the node/app and what changes are allowed.
2. **Prefer deterministic targets**: Use direct node IPs when debugging; gateways can be load‑balanced.
3. **Be reproducible**: Provide exact API calls (curl) and expected shapes; avoid hand‑waving.
4. **Handle secrets safely**: Never ask for or store private keys; redact `zelidauth`, signatures, passwords, and `repoauth`.

## Mental Model

- **Node**: A FluxOS instance exposing a UI port (commonly `16126`) and API port (commonly `16127`).
- **App**: A named deployment owned by a Flux/ZelID address; consists of one or more **components**.
- **Component**: A container definition (image + ports + env + storage + resources).
- **App message**: A signed, hashed payload used to register/update an app on the network (separate from `zelidauth` login).

## API Basics

### Base URLs

- **Gateway**
  - UI: `https://cloud.runonflux.com`
  - API: `https://api.runonflux.io`
- **Direct node** (recommended for debugging)
  - UI: `http://<node-ip>:16126/`
  - API: `http://<node-ip>:16127/`

### Response Envelope

Most endpoints return:

```json
{ "status": "success", "data": ... }
```

### Quick Health Checks

```bash
curl -sS http://<node-ip>:16127/flux/version
curl -sS http://<node-ip>:16127/flux/info
curl -sS http://<node-ip>:16127/flux/id
curl -sS http://<node-ip>:16127/flux/isarcaneos
```

### Cache Notes

Many read-only endpoints are cached (see `cache(...)` in [`ZelBack/src/routes.js`](https://github.com/RunOnFlux/flux/blob/master/ZelBack/src/routes.js)). To force a fresh read during troubleshooting:

```bash
curl -sS "http://<node-ip>:16127/flux/info?ts=$(date +%s)"
```

## Authentication

Flux uses a header named `zelidauth` containing JSON: `{ zelid, signature, loginPhrase }`.

### ZelID “login phrase” flow (for API calls that require user/app privileges)

1. Fetch phrase:
   ```bash
   curl -sS http://<node-ip>:16127/id/loginphrase
   ```
2. User signs the phrase in their wallet/tooling.
3. Send `zelidauth` header:
   ```bash
   curl -H 'zelidauth: {"zelid":"<ZELID>","signature":"<SIG>","loginPhrase":"<PHRASE>"}' ...
   ```

### Important distinction: `zelidauth` vs app registration/update signatures

- `zelidauth` authenticates the *API request*.
- App registration/update also requires a *separate signature* over a specific message string (documented below).

## App Discovery (Read-Only)

```bash
curl -sS http://<node-ip>:16127/apps/listrunningapps
curl -sS http://<node-ip>:16127/apps/installedapps
curl -sS http://<node-ip>:16127/apps/appspecifications/<appname>
curl -sS http://<node-ip>:16127/apps/appowner/<appname>
```

Useful follow-ups:

```bash
curl -sS http://<node-ip>:16127/apps/fluxusage
curl -sS http://<node-ip>:16127/apps/appsresources
curl -sS http://<node-ip>:16127/apps/locations
curl -sS http://<node-ip>:16127/apps/installinglocations
curl -sS http://<node-ip>:16127/apps/installingerrorslocations
curl -sS http://<node-ip>:16127/apps/whitelistedrepositories
curl -sS http://<node-ip>:16127/apps/latestspecificationversion
```

## Creating an Application (Flux App Specs v8)

Flux currently supports multiple spec versions; **v8** is the latest (see [`ZelBack/src/services/appRequirements/appValidator.js`](https://github.com/RunOnFlux/flux/blob/master/ZelBack/src/services/appRequirements/appValidator.js) and [`ZelBack/src/services/utils/appUtilities.js`](https://github.com/RunOnFlux/flux/blob/master/ZelBack/src/services/utils/appUtilities.js)).

### v8 top-level schema (template)

```json
{
  "version": 8,
  "name": "my-app",
  "description": "Short description (<=256 chars)",
  "owner": "t1YourFluxAddress",
  "compose": [
    {
      "name": "web",
      "description": "Web component",
      "repotag": "nginx:alpine",
      "ports": [31111],
      "domains": [""],
      "environmentParameters": [],
      "commands": [],
      "containerPorts": [80],
      "containerData": "/data",
      "cpu": 1,
      "ram": 2000,
      "hdd": 10,
      "repoauth": ""
    }
  ],
  "instances": 3,
  "contacts": [],
  "geolocation": [],
  "expire": 22000,
  "nodes": [],
  "staticip": false,
  "enterprise": ""
}
```

### Naming rules (v8)

- App `name`:
  - Allowed: `a-z`, `A-Z`, `0-9`, and `-` (hyphens not first/last).
  - Max length: 63.
  - Must not start with `flux` or `zel`.
- Component `compose[].name`:
  - Alphanumeric only (`a-zA-Z0-9`), no hyphens.
  - Unique within the app.

### Common limits (validated server-side)

These are useful when translating user requirements into a spec (see [`ZelBack/src/services/appRequirements/appValidator.js`](https://github.com/RunOnFlux/flux/blob/master/ZelBack/src/services/appRequirements/appValidator.js)):

- `description`: <= 256 characters
- `compose[].repotag`: <= 200 characters
- `compose[].containerData`: 2–200 characters
- `compose[].ports`: max 5 ports per component
- `compose[].environmentParameters`: max 20 entries, each <= 400 chars
- `compose[].commands`: max 20 entries, each <= 400 chars
- `contacts`: max 5 entries, each <= 75 chars
- `geolocation`: max 10 entries, each <= 50 chars
- `nodes`: max 120 entries, each <= 70 chars

### Ports/domains/containerPorts must align

Per component:

- `ports[]` (external) and `containerPorts[]` (internal) must have the same length.
- `domains[]` length must match `ports[]`.
- Maximum 5 ports per component.
- Allowed port ranges depend on chain height and banned lists; validate with the API (next section).
  - Tip: `GET /apps/registrationinformation` includes `portMin`, `portMax`, `bannedPorts`, and `enterprisePorts`.
  - If you use an “enterprise port” (e.g., low ports like `80`), expect different pricing rules (see `enterprisePorts`).

### Environment variables and commands

- `environmentParameters`: array of `KEY=VALUE` strings (max 20).
- `commands`: array of strings (max 20). Use `[]` if you want the image default.

### Storage (`containerData`)

- Must be a string (length 2–200). If you want no persistence, use `"/tmp"`.
- Supports multiple mounts via pipe-separated syntax; see:
  - [`docs/multiple-mounts-guide.md`](https://github.com/RunOnFlux/flux/blob/master/docs/multiple-mounts-guide.md)
  - [`docs/multiple-mounts-api-reference.md`](https://github.com/RunOnFlux/flux/blob/master/docs/multiple-mounts-api-reference.md)

Internal-only components (databases, caches) can use empty port arrays:

- `ports: []`
- `containerPorts: []`
- `domains: []`

### Inter-component networking (compose apps)

Flux creates a per-app Docker network named `fluxDockerNetwork_<appname>` (see `createFluxAppDockerNetwork` in [`ZelBack/src/services/dockerService.js`](https://github.com/RunOnFlux/flux/blob/master/ZelBack/src/services/dockerService.js)). Components can usually reach each other over that network using the Flux container identifier:

- `flux<component>_<appname>` (for composed apps)

Example: if the component is `db` in app `my-app`, the container name is typically `fluxdb_my-app` (use this as an internal hostname where appropriate).

### Private registries (`repoauth`)

For v8, `compose[].repoauth` is always present as a **string**, but it must be empty unless the app is enterprise (see validation rules in [`ZelBack/src/services/appRequirements/appValidator.js`](https://github.com/RunOnFlux/flux/blob/master/ZelBack/src/services/appRequirements/appValidator.js)).

See:

- [`docs/registry-auth/QUICKSTART.md`](https://github.com/RunOnFlux/flux/blob/master/docs/registry-auth/QUICKSTART.md)
- [`docs/registry-auth/REPOAUTH_STRING_FORMAT.md`](https://github.com/RunOnFlux/flux/blob/master/docs/registry-auth/REPOAUTH_STRING_FORMAT.md)
- [`docs/registry-auth/SECURITY.md`](https://github.com/RunOnFlux/flux/blob/master/docs/registry-auth/SECURITY.md)

### Instances and expiration

- Instances:
  - Network minimum is usually 3; v8 can allow 1 instance only after a configured fork height.
  - Always validate against the current chain height via the node’s verifier endpoint (below).
- Expire:
  - Expressed in blocks; min/max and interval rules vary by fork height (validated server-side).

## Canonicalize/Validate a Spec (Do This Before Signing)

Because the backend verifies a signature over `JSON.stringify(appSpec)`, **key order matters**. The safest workflow is:

1. POST your draft spec to the verifier endpoint.
2. Use the returned formatted spec for signing and registration/update.

Practical rule: **avoid tools that may reorder JSON keys** when preparing the spec you sign. The verifier endpoint exists to give you the backend’s canonical shape.

### Validate for registration

```bash
curl -sS -X POST "http://<node-ip>:16127/apps/verifyappregistrationspecifications" \
  -H 'Content-Type: application/json' \
  -d @app-spec.json
```

### Validate for update

```bash
curl -sS -X POST "http://<node-ip>:16127/apps/verifyappupdatespecifications" \
  -H 'Content-Type: application/json' \
  -d @app-spec.json
```

## Build the Message to Sign (Practical)

Registration/update signatures are over `type + version + JSON.stringify(appSpec) + timestamp`. To avoid “almost right” JSON issues, treat `JSON.stringify(...)` as the source of truth.

Workflow (example uses registration):

1. Validate your spec and save the response:
   ```bash
   API="http://<node-ip>:16127"
   curl -sS -X POST "$API/apps/verifyappregistrationspecifications" \
     -H 'Content-Type: application/json' \
     -d @app-spec.json > verify.json
   ```
2. Extract the formatted spec and print the exact `JSON.stringify(spec)` (Node preserves key insertion order from JSON text):
   ```bash
   node -e 'const fs=require("fs");const r=JSON.parse(fs.readFileSync("verify.json","utf8"));process.stdout.write(JSON.stringify(r.data));' > spec.formatted.json
   SPEC_JSON="$(node -e 'const fs=require(\"fs\");const s=JSON.parse(fs.readFileSync(\"spec.formatted.json\",\"utf8\"));process.stdout.write(JSON.stringify(s));')"
   ```
3. Build the message string:
   ```bash
   TYPE="fluxappregister"
   TYPE_VERSION="1"
   TIMESTAMP="$(node -e 'process.stdout.write(String(Date.now()))')"
   MESSAGE_TO_SIGN="${TYPE}${TYPE_VERSION}${SPEC_JSON}${TIMESTAMP}"
   printf '%s' "$MESSAGE_TO_SIGN"
   ```
4. Have the app owner sign `MESSAGE_TO_SIGN` (exact bytes; no extra quotes/newlines).

## Calculate Price (Flux + USD)

```bash
curl -sS -X POST "http://<node-ip>:16127/apps/calculatefiatandfluxprice" \
  -H 'Content-Type: application/json' \
  -d @app-spec.json
```

To see registration parameters and network addresses:

```bash
curl -sS http://<node-ip>:16127/apps/registrationinformation
```

## Register a New App (Network-Level)

### Overview

1. Validate and obtain **formatted** specs (`/apps/verifyappregistrationspecifications`).
2. Build the message string and have the owner sign it.
3. POST `/apps/appregister` with `zelidauth`.
4. Receive a 64‑char `hash`.
5. Complete payment on-chain with the `hash` as the transaction message.
6. Confirm via `/apps/permanentmessages` and spec queries.

### Message to sign (registration)

Backend verification (see [`ZelBack/src/services/appMessaging/messageVerifier.js`](https://github.com/RunOnFlux/flux/blob/master/ZelBack/src/services/appMessaging/messageVerifier.js)) uses:

```
type + version + JSON.stringify(appSpec) + timestamp
```

For registration:

- `type`: `fluxappregister` (or `zelappregister`)
- `version`: `1`
- `timestamp`: milliseconds since epoch (must be recent; clock drift causes failure)

Timestamp rules enforced by the API (see [`ZelBack/src/services/appDatabase/registryManager.js`](https://github.com/RunOnFlux/flux/blob/master/ZelBack/src/services/appDatabase/registryManager.js)):

- Too old: more than ~1 hour.
- Too far in the future: more than ~5 minutes.

### POST /apps/appregister payload (template)

```json
{
  "type": "fluxappregister",
  "version": 1,
  "appSpecification": { "...": "use the formatted spec you validated" },
  "timestamp": 1700000000000,
  "signature": "SIGNATURE_OF_MESSAGE_TO_SIGN"
}
```

### POST /apps/appregister (example curl)

```bash
API="http://<node-ip>:16127"
ZELIDAUTH='{"zelid":"<ZELID>","signature":"<SIG>","loginPhrase":"<PHRASE>"}'

curl -sS -X POST "$API/apps/appregister" \
  -H 'Content-Type: application/json' \
  -H "zelidauth: $ZELIDAUTH" \
  -d @appregister.json
```

### Confirm the app message is visible to the node

```bash
HASH="<returned-hash>"
curl -sS "http://<node-ip>:16127/apps/temporarymessages/$HASH"
```

### On-chain payment (high level)

- Use `GET /apps/registrationinformation` to obtain:
  - the accepted payment address(es),
  - current `minPrice`,
  - current port rules.
- The chain scanner looks for an `OP_RETURN` message whose decoded text is exactly the 64‑character `hash` (see [`ZelBack/src/services/explorerService.js`](https://github.com/RunOnFlux/flux/blob/master/ZelBack/src/services/explorerService.js)).

### Confirm on-chain acceptance (after payment)

```bash
curl -sS "http://<node-ip>:16127/apps/permanentmessages/$HASH"
curl -sS "http://<node-ip>:16127/apps/globalappsspecifications/$HASH"
```

## Update an Existing App (Network-Level)

### Compatibility rules to keep in mind

From [`ZelBack/src/services/appLifecycle/advancedWorkflows.js`](https://github.com/RunOnFlux/flux/blob/master/ZelBack/src/services/appLifecycle/advancedWorkflows.js):

- Upgrades to v8 are allowed.
- For v4–v7 apps, component **count and names must not change** (repotag can change).
- For v8 apps, component structure is flexible (changes trigger a hard redeploy).

### Update flow

1. Fetch current spec:
   ```bash
   curl -sS http://<node-ip>:16127/apps/appspecifications/<appname>
   ```
2. Edit to desired new spec (prefer v8).
3. Validate and canonicalize:
   ```bash
   curl -sS -X POST "http://<node-ip>:16127/apps/verifyappupdatespecifications" \
     -H 'Content-Type: application/json' \
     -d @app-spec.json
   ```
4. Sign message string using:
   - `type`: `fluxappupdate` (or `zelappupdate`)
   - `version`: `1`
   - same `type + version + JSON.stringify(appSpec) + timestamp` pattern
5. POST `/apps/appupdate` with `zelidauth`.
6. Complete on-chain payment (if price > 0) and confirm via `/apps/permanentmessages`.

### POST /apps/appupdate (example curl)

```bash
API="http://<node-ip>:16127"
ZELIDAUTH='{"zelid":"<ZELID>","signature":"<SIG>","loginPhrase":"<PHRASE>"}'

curl -sS -X POST "$API/apps/appupdate" \
  -H 'Content-Type: application/json' \
  -H "zelidauth: $ZELIDAUTH" \
  -d @appupdate.json
```

## Manage an App on a Node (Lifecycle + Observability)

Most lifecycle and observability endpoints require app-owner privileges (`zelidauth`) and accept either:

- `<appname>` to operate on all components of a composed app, or
- `<component>_<appname>` to target a single component container.

### Lifecycle controls

```bash
ZELIDAUTH='{"zelid":"<ZELID>","signature":"<SIG>","loginPhrase":"<PHRASE>"}'
curl -sS -H "zelidauth: $ZELIDAUTH" http://<node-ip>:16127/apps/appstart/<appname>
curl -sS -H "zelidauth: $ZELIDAUTH" http://<node-ip>:16127/apps/appstop/<appname>
curl -sS -H "zelidauth: $ZELIDAUTH" http://<node-ip>:16127/apps/apprestart/<appname>
curl -sS -H "zelidauth: $ZELIDAUTH" http://<node-ip>:16127/apps/apppause/<appname>
curl -sS -H "zelidauth: $ZELIDAUTH" http://<node-ip>:16127/apps/appunpause/<appname>
curl -sS -H "zelidauth: $ZELIDAUTH" http://<node-ip>:16127/apps/redeploy/<appname>
curl -sS -H "zelidauth: $ZELIDAUTH" http://<node-ip>:16127/apps/redeploycomponent/<appname>/<componentName>
```

### Install checks (useful when debugging deployability)

These endpoints require login and, for non-temporary apps, elevated privileges (see [`ZelBack/src/services/appLifecycle/appInstaller.js`](https://github.com/RunOnFlux/flux/blob/master/ZelBack/src/services/appLifecycle/appInstaller.js)).

```bash
ZELIDAUTH='{"zelid":"<ZELID>","signature":"<SIG>","loginPhrase":"<PHRASE>"}'
curl -sS -H "zelidauth: $ZELIDAUTH" http://<node-ip>:16127/apps/testappinstall/<appname>
curl -sS -H "zelidauth: $ZELIDAUTH" http://<node-ip>:16127/apps/installapplocally/<appname>
```

### Logs, inspect, and metrics

```bash
ZELIDAUTH='{"zelid":"<ZELID>","signature":"<SIG>","loginPhrase":"<PHRASE>"}'
curl -sS -H "zelidauth: $ZELIDAUTH" http://<node-ip>:16127/apps/applog/<appname>/200
curl -sS -H "zelidauth: $ZELIDAUTH" http://<node-ip>:16127/apps/applogpolling/<appname>/200/<sinceTimestamp>
curl -sS -H "zelidauth: $ZELIDAUTH" http://<node-ip>:16127/apps/appinspect/<appname>
curl -sS -H "zelidauth: $ZELIDAUTH" http://<node-ip>:16127/apps/appstats/<appname>
curl -sS -H "zelidauth: $ZELIDAUTH" http://<node-ip>:16127/apps/apptop/<appname>
curl -sS -H "zelidauth: $ZELIDAUTH" http://<node-ip>:16127/apps/appmonitor/<appname>/24h
```

### Exec into a container (app owner)

`POST /apps/appexec` expects `appname` and `cmd[]` (see [`ZelBack/src/services/appManagement/appInspector.js`](https://github.com/RunOnFlux/flux/blob/master/ZelBack/src/services/appManagement/appInspector.js)):

```bash
curl -sS -X POST "http://<node-ip>:16127/apps/appexec" \
  -H 'Content-Type: application/json' \
  -H 'zelidauth: {"zelid":"<ZELID>","signature":"<SIG>","loginPhrase":"<PHRASE>"}' \
  -d '{"appname":"<appname-or-flux0_appname>","cmd":["/bin/sh","-lc","id; ls -la"],"env":[]}'
```

## App Files & Persistence

### Host paths and identifiers (useful for debugging)

- Container identifier is typically:
  - single component: `flux<appname>`
  - composed component: `flux<component>_<appname>`
- Host storage root is typically:
  - `~/zelflux/ZelApps/` (or `FLUXOS_PATH/ZelApps/` on ArcaneOS)
- Primary data mount maps to:
  - `.../flux<identifier>/appdata/`
- Additional mounts created by `containerData` live alongside `appdata/` under the same app directory (see [`ZelBack/src/services/utils/volumeConstructor.js`](https://github.com/RunOnFlux/flux/blob/master/ZelBack/src/services/utils/volumeConstructor.js)).

### Volume browser API (app owner)

Routes (see [`ZelBack/src/routes.js`](https://github.com/RunOnFlux/flux/blob/master/ZelBack/src/routes.js)) require `zelidauth` and use `<appname>` + `<component>`:

- List folder contents: `GET /apps/getfolderinfo/<appname>/<component>/<folder>`
- Create folder: `GET /apps/createfolder/<appname>/<component>/<folder>`
- Rename: `GET /apps/renameobject/<appname>/<component>/<oldpath>/<newname>`
- Remove: `GET /apps/removeobject/<appname>/<component>/<object>`
- Download file: `GET /apps/downloadfile/<appname>/<component>/<file>`
- Download folder: `GET /apps/downloadfolder/<appname>/<component>/<folder>`

Tip: prefer query parameters for paths that may need URL encoding:

```bash
ZELIDAUTH='{"zelid":"<ZELID>","signature":"<SIG>","loginPhrase":"<PHRASE>"}'
curl -sS -H "zelidauth: $ZELIDAUTH" \
  "http://<node-ip>:16127/apps/getfolderinfo?appname=<appname>&component=<component>&folder=appdata"
```

## ArcaneOS & Enterprise Apps (v8)

Flux exposes `GET /flux/isarcaneos` to detect Arcane nodes. Enterprise v8 apps use the `enterprise` field to indicate enterprise behavior.

High-level behavior (see [`ZelBack/src/services/utils/enterpriseHelper.js`](https://github.com/RunOnFlux/flux/blob/master/ZelBack/src/services/utils/enterpriseHelper.js) and validation in [`ZelBack/src/services/appRequirements/appValidator.js`](https://github.com/RunOnFlux/flux/blob/master/ZelBack/src/services/appRequirements/appValidator.js)):

- On enterprise v8 apps, parts of the spec may be provided in an encrypted blob stored in `enterprise`.
- Enterprise spec validation/decryption is only available on Arcane nodes.
- Private registry pulls (`repoauth` non-empty) are only allowed for enterprise apps.
- Arcane nodes are `amd64` only; ensure all component images support `amd64`.

## Automation Notes (FluxMCP-style flows)

If you’re building an LLM automation layer (MCP tool, CLI, or bot), implement these primitives:

1. `get_login_phrase(node)` → user signs → build `zelidauth`.
2. `validate_spec(node, spec, mode=register|update)` → returns formatted spec (canonical).
3. `price(node, formatted_spec)` → returns USD/FLUX price estimate.
4. `build_message(type, formatted_spec, timestamp)` → produce exact string for signing.
5. `appregister/appupdate(node, zelidauth, payload)` → returns `hash`.
6. `poll_messages(node, hash)` → `/apps/temporarymessages`, then `/apps/permanentmessages` after payment.
7. `lifecycle(node, zelidauth, action, appname)` → start/stop/redeploy, logs, inspect, exec.

## Troubleshooting Playbook (High-Signal Checks)

### “Daemon not yet synced”

- Confirm `/flux/info` and wait for sync; registration/update/price may fail while unsynced.

### “Not enough outgoing/incoming peers”

- App registration/update requires minimum peer connectivity on the node performing the API call.

### “Received signature is invalid” / “specifications are not properly formatted”

- Canonicalize first via `/apps/verifyappregistrationspecifications` or `/apps/verifyappupdatespecifications`.
- Ensure your signed message uses the **formatted** spec and a fresh `timestamp`.

### Port/domain mismatch errors

- Ensure `ports[]`, `containerPorts[]`, and `domains[]` are the same length per component.
- Ensure ports are within allowed ranges and not banned; validate via the verifier endpoint.

### “Private repositories are only allowed for Enterprise Applications”

- For v8 non-enterprise apps, set `repoauth` to `""` and use a public image; enterprise apps are required for private image pulls.

## Snippets (Safe Defaults)

### Bash: get a login phrase (avoid printing signatures)

```bash
API="http://<node-ip>:16127"
PHRASE="$(curl -sS "$API/id/loginphrase" | sed -n 's/.*\"data\":\"\\([^\"]*\\)\".*/\\1/p')"
echo "Sign this phrase in your wallet:"
echo "$PHRASE"
```

### Node.js: simple API call with `zelidauth`

```js
import axios from "axios";

const api = "http://<node-ip>:16127";
const zelidauth = JSON.stringify({ zelid: "<ZELID>", signature: "<SIG>", loginPhrase: "<PHRASE>" });

const res = await axios.get(`${api}/apps/listrunningapps`, { headers: { zelidauth } });
console.log(res.data);
```

## References

All source links below point to `https://github.com/RunOnFlux/flux` (branch: `master`).

- API routing overview: [`ZelBack/src/routes.js`](https://github.com/RunOnFlux/flux/blob/master/ZelBack/src/routes.js)
- App spec formatter (canonical key order): [`ZelBack/src/services/utils/appUtilities.js`](https://github.com/RunOnFlux/flux/blob/master/ZelBack/src/services/utils/appUtilities.js)
- App spec validation rules: [`ZelBack/src/services/appRequirements/appValidator.js`](https://github.com/RunOnFlux/flux/blob/master/ZelBack/src/services/appRequirements/appValidator.js)
- App message signature verification: [`ZelBack/src/services/appMessaging/messageVerifier.js`](https://github.com/RunOnFlux/flux/blob/master/ZelBack/src/services/appMessaging/messageVerifier.js)
- On-chain message extraction (OP_RETURN decoding): [`ZelBack/src/services/explorerService.js`](https://github.com/RunOnFlux/flux/blob/master/ZelBack/src/services/explorerService.js)
- Enterprise/Arcane spec decryption: [`ZelBack/src/services/utils/enterpriseHelper.js`](https://github.com/RunOnFlux/flux/blob/master/ZelBack/src/services/utils/enterpriseHelper.js)
- Multiple mounts guide: [`docs/multiple-mounts-guide.md`](https://github.com/RunOnFlux/flux/blob/master/docs/multiple-mounts-guide.md)
- Multiple mounts API reference: [`docs/multiple-mounts-api-reference.md`](https://github.com/RunOnFlux/flux/blob/master/docs/multiple-mounts-api-reference.md)
- Syncthing monitoring reference: [`docs/syncthing-health-monitor.md`](https://github.com/RunOnFlux/flux/blob/master/docs/syncthing-health-monitor.md)
- Registry auth (private images): [`docs/registry-auth/README.md`](https://github.com/RunOnFlux/flux/blob/master/docs/registry-auth/README.md)
