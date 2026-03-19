# Scenario: Update an existing app (v8) safely

## Prompt

> I need to update my Flux app `myapp` to image `ghcr.io/acme/myapp:1.2.4`.
> Keep the ports and domains the same.

## Expected tool calls (MCP fallback)

For normal agent execution, prefer the equivalent `flux` CLI workflow and keep this MCP sequence as the interactive fallback.

1) Set base URL + authenticate

- `flux_set_base_url { baseUrl }`
- `flux_auth_flow` (optional)
- `flux_get_login_phrase` → user signs → `flux_verify_login` → `flux_set_zelidauth`

2) Fetch current spec

- `flux_apps_get_spec { appname }`

3) Modify spec

- Update `compose[0].repotag` (or the matching component)

4) Validate, price, and plan update

- `flux_apps_verify_update_spec`
- `flux_apps_calculate_price`
- `flux_apps_plan_update`

5) Sign and submit

- User signs `messageToSign`
- `flux_apps_update_and_verify { signature, timestamp, confirm: true }`

6) Confirm status

- `flux_apps_global_status { appname }`
- `flux_apps_troubleshoot { appname }`

## Notes

- Always sign the canonicalized spec returned by the verify/plan steps.
- If update propagation is stuck, use `flux_apps_get_messages { hash, kind: "both" }`.
