# Git Deployments (Orbit)

Flux Git deployments (formerly **Orbit**) deploy a Git repository using the Orbit runtime image:

- `runonflux/orbit:latest`

From the Flux network’s perspective, this is a normal v8 app registration/update; the “Git deploy” behavior is driven by the container image + environment variables.

## Key Spec Shape (v8)

- `compose[0].repotag`: `runonflux/orbit:latest`
- `compose[0].containerPorts`: `[<APP_PORT>, 9001]`
  - `9001` is Orbit’s management UI port (internal).
- `compose[0].ports`: `[<EXPOSED_PORT>, <MGMT_EXPOSED_PORT>]`
  - pick random “safe” ports; avoid FluxOS banned ranges (e.g. 161xx, 261xx, 30000-30099, privileged 0-1023).
- `compose[0].domains`: `[<CUSTOM_DOMAIN_OR_EMPTY>, ""]`
  - second entry is for the management port (usually left empty).
- `compose[0].environmentParameters` must include:
  - `GIT_REPO_URL=https://github.com/<owner>/<repo>` (or gitlab/bitbucket)
  - `APP_PORT=<APP_PORT>`
  - Optional:
    - `GIT_BRANCH=<branch>` (if not `main`)
    - `PROJECT_PATH=/path` (for monorepos)

## Orbit Environment Variables (Common)

Orbit supports additional env vars (examples):

- `BUILD_COMMAND=...`
- `RUN_COMMAND=...`
- `INSTALL_COMMAND=...`
- `OUTPUT_DIR=...`
- `NODE_VERSION=20` (and other runtime version vars)
- `POLLING_INTERVAL=...`
- `WEBHOOK_SECRET=...`

The authoritative list evolves with the Orbit image; treat these as best-effort.

## Private Repos (Security)

For private repos, Orbit expects a repo URL with embedded credentials, e.g.:

- `https://<username>:<token>@github.com/<owner>/<repo>`

Do **not** register a non-enterprise app containing that URL (it leaks credentials into the spec).

Instead:

1. Use a **v8 enterprise spec**: encrypt `contacts + compose` into `spec.enterprise`
2. Clear `spec.compose` and `spec.contacts` in the plaintext spec

This repo ships MCP tools that do this safely.

## Recommended MCP Workflow

1. Set base URL to a node (Arcane OS required for enterprise public keys):
   - `flux_node_health` should report `isArcaneOs: true` for enterprise flows.
2. Authenticate (zelidauth):
   - Use `flux_auth_flow` then `flux_verify_login` + `flux_set_zelidauth`.
3. Plan Git deployment registration:
   - `flux_git_deploy_plan_registration`
   - For private repos: pass `repoToken` + `enterprise:true` + `confirm:true`
4. Sign the returned message:
   - Use `messageToSignResourceUri` + `flux_build_zelcore_sign_link { "messageResourceUri": "...", "useFluxStorage": true, "confirm": true }`
5. Submit registration:
   - Prefer: `flux_git_deploy_register_and_verify { "planResourceUri": "<resourceUri from plan>", "signature": "<signature>", "confirm": true }`
   - (Fallback) `flux_apps_register { "spec": <spec>, "signature": "<signature>", "timestamp": <timestamp> }`
6. (Optional) Test install + pay:
   - `flux_apps_test_install` (requires `confirm:true`)
   - Pay to the address returned in the plan/register output with memo set to the registration hash.
