# ArcaneOS and Enterprise Apps (v8)

ArcaneOS is a hardened FluxOS variant used by some nodes. You can detect Arcane nodes via:

```bash
curl -sS http://<ip>:16127/flux/isarcaneos
```

Source of truth:

- Enterprise handling/decryption: [`ZelBack/src/services/utils/enterpriseHelper.js`](https://github.com/RunOnFlux/flux/blob/master/ZelBack/src/services/utils/enterpriseHelper.js)
- v8 validation rules: [`ZelBack/src/services/appRequirements/appValidator.js`](https://github.com/RunOnFlux/flux/blob/master/ZelBack/src/services/appRequirements/appValidator.js)

## Enterprise basics

- v8 apps include an `enterprise` field.
- Enterprise v8 apps are required for private image pulls (`repoauth` non-empty).
- Some enterprise spec handling/decryption is only available on Arcane nodes.

## Fetching Enterprise App Specs (v8)

FluxOS does not return `compose` and `contacts` for enterprise apps by default.

To retrieve them, the client performs a session-encryption exchange with an **Arcane** node:

1) `GET /apps/apporiginalowner/<appname>` to get the app’s original owner (Flux ID / ZelID).
2) `POST /apps/getpublickey` (requires `zelidauth`) to fetch the RSA public key for that app/owner.
3) Client generates a random 32-byte AES key and RSA-encrypts the **base64** form of that AES key (RSA-OAEP + SHA-256).
4) `GET /apps/appspecifications/<appname>/true` with headers:
   - `zelidauth: ...`
   - `enterprise-key: <base64 RSA-encrypted AES key>`
5) The response contains `enterprise: <base64 nonce+ciphertext+tag>` (AES-256-GCM). Decrypt with the AES key you generated to obtain JSON containing `compose` and `contacts`.

Notes:
- You must be authorized as the app owner (or fluxteam) for step 4.
- This flow is only supported on Arcane nodes (non-Arcane nodes typically return: “Application Specifications can only be validated on a node running Arcane OS.”).

### MCP Convenience

If you’re using this repo’s MCP server (`flux-mcp`), prefer:

- `flux_apps_get_spec_full { appname }`

It performs the full flow above (including local AES decrypt) and returns resource links for:
- base spec
- Arcane “enterprise encrypted” spec
- decrypted enterprise JSON
- merged inspection-friendly spec

## Architecture

Arcane nodes are `amd64` only; ensure all component images support `amd64`.
