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

## Architecture

Arcane nodes are `amd64` only; ensure all component images support `amd64`.
