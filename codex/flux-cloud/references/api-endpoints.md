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

## Quick node health

```bash
curl -sS http://<node-ip>:16127/flux/version
curl -sS http://<node-ip>:16127/flux/info
curl -sS http://<node-ip>:16127/flux/isarcaneos
```

## Authentication

- Get a login phrase: `GET /id/loginphrase`
- Sign it with your ZelID
- Send API calls with:

`zelidauth: {"zelid":"<ZELID>","signature":"<SIG>","loginPhrase":"<PHRASE>"}`

See: `references/auth-zelidauth.md`.

## App essentials

Discovery:

```bash
curl -sS http://<node-ip>:16127/apps/listrunningapps
curl -sS http://<node-ip>:16127/apps/listallapps
curl -sS http://<node-ip>:16127/apps/appspecifications/<appname>
```

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
