# Flux App Spec v8 — Schema and Rules

Source of truth:

- Formatter: [`ZelBack/src/services/utils/appUtilities.js`](https://github.com/RunOnFlux/flux/blob/master/ZelBack/src/services/utils/appUtilities.js)
- Validation: [`ZelBack/src/services/appRequirements/appValidator.js`](https://github.com/RunOnFlux/flux/blob/master/ZelBack/src/services/appRequirements/appValidator.js)

## Contents

- [Template](#template)
- [Required Keys](#required-keys)
- [Naming Rules](#naming-rules)
- [Limits](#limits)
- [Ports and Domains](#ports-and-domains)
- [Resources](#resources)
- [Storage (containerData)](#storage-containerdata)
- [Private Registries (repoauth)](#private-registries-repoauth)

## Template

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
      "environmentParameters": ["NODE_ENV=production"],
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

## Required Keys

Top-level keys:

- `version` (must be `8`)
- `name`, `description`, `owner`
- `compose` (array of components)
- `instances`, `contacts`, `geolocation`, `expire`, `nodes`, `staticip`, `enterprise`

Component keys:

- `name`, `description`, `repotag`
- `ports`, `domains`, `containerPorts`
- `environmentParameters`, `commands`
- `containerData`
- `cpu`, `ram`, `hdd`
- `repoauth` (string)

## Naming Rules

- App `name`:
  - Allowed: letters, digits, hyphen; hyphen cannot be first/last.
  - Length: <= 63.
  - Must not start with `flux` or `zel`.
- Component `name`:
  - Alphanumeric only (no hyphen).
  - Unique within the app.

## Limits

Common limits validated server-side:

- `description`: <= 256 characters
- `compose[]`: must contain at least 1 component
- `compose[].repotag`: <= 200 characters
- `compose[].containerData`: 2–200 characters
- `compose[].ports`: max 5 ports per component
- `compose[].environmentParameters`: max 20 entries, each <= 400 chars
- `compose[].commands`: max 20 entries, each <= 400 chars
- `contacts`: max 5 entries, each <= 75 chars
- `geolocation`: max 10 entries, each <= 50 chars
- `nodes`: max 120 entries, each <= 70 chars

## Ports and Domains

Per component:

- `ports.length === containerPorts.length === domains.length`
- External ports must be in allowed range and not banned.

Get the current rules from:

- `GET /apps/registrationinformation`

Internal-only components can use empty arrays:

```json
{ "ports": [], "containerPorts": [], "domains": [] }
```

## Resources

- `cpu` must be in 0.1 increments (e.g., `0.5`, `1.2`).
- `ram` must be a multiple of 100 (MB).
- `hdd` must be an integer (GB).
- For composed apps, total resources across components must fit node limits.

## Storage (containerData)

- Persistent primary mount: `"/data"`
- No persistence: `"/tmp"`
- Multi-mount syntax is supported via `|`.

See:

- `references/storage-mounts.md`
- [`docs/multiple-mounts-guide.md`](https://github.com/RunOnFlux/flux/blob/master/docs/multiple-mounts-guide.md)

## Private Registries (repoauth)

- `repoauth` must be a string.
- For v8 non-enterprise apps, it must be empty.
- Private image pulls require enterprise.

See:

- [`docs/registry-auth/QUICKSTART.md`](https://github.com/RunOnFlux/flux/blob/master/docs/registry-auth/QUICKSTART.md)
- [`docs/registry-auth/REPOAUTH_STRING_FORMAT.md`](https://github.com/RunOnFlux/flux/blob/master/docs/registry-auth/REPOAUTH_STRING_FORMAT.md)
