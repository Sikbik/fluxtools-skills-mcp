# Scenario: Deploy a new app (v8) end-to-end

## Prompt

> I want to deploy a new Flux app. I have a node base URL and the owner ZelID.
> The image is `ghcr.io/acme/myapp:1.2.3` and it should expose port 8080.

## Expected tool calls (MCP fallback)

For normal agent execution, prefer the equivalent `flux` CLI workflow and keep this MCP sequence as the interactive fallback.

1) Set base URL

- `flux_set_base_url { baseUrl }`

2) Authenticate (ZelID login phrase)

- `flux_auth_flow { gatewayBaseUrl? }` (optional)
- `flux_get_login_phrase` (or `flux_get_emergency_phrase`)
- User signs phrase
- `flux_verify_login { zelid, signature, loginPhrase }`
- `flux_build_zelidauth { zelid, signature, loginPhrase }`
- `flux_set_zelidauth { zelidauth }`

3) Build a minimal v8 spec

- `flux_generate_app_spec_v8 { name, owner, repotag, ports, containerPorts, environment? }`

4) Validate and price

- `flux_apps_verify_registration_spec`
- `flux_apps_calculate_price`

5) Plan registration (canonicalize + message-to-sign)

- `flux_apps_plan_registration`

6) Sign and submit

- User signs `messageToSign` with the owner ZelID
- `flux_apps_register_and_verify { signature, timestamp, confirm: true }`

7) Verify global state

- `flux_apps_global_status { zelid, appname }`

## Notes

- If using a gateway base URL, prefer `flux_set_base_url_from_gateway` before auth to pin to a direct node.
- Registration/update signatures are separate from `zelidauth`.
