# Flux Cloud / FluxOS API Overview

## Base URLs

- UI gateway: `https://cloud.runonflux.com`
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

## Authentication (`zelidauth`)

1) Get a login phrase:

```bash
curl -sS "$API/id/loginphrase"
```

2) Sign the phrase with your ZelID.

3) Send requests with the header:

```text
zelidauth: {"zelid":"<ZELID>","signature":"<SIG>","loginPhrase":"<PHRASE>"}
```
