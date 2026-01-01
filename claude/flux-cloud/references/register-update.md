# Register / Update Flow (MCP-first)

## Two signatures (do not confuse)

- `zelidauth` authenticates the API call.
- App register/update requires an additional **owner signature** over an exact message string.

## Message to sign

The node verifies a signature over:

```text
type + version + JSON.stringify(appSpec) + timestamp
```

## Registration

1) `flux_apps_plan_registration` → returns:
   - `messageToSign`
   - `timestamp`
   - `payload` scaffold
2) User signs `messageToSign` with the OWNER ZelID.
3) `flux_apps_register` with `signature` and the same `timestamp`.
4) Check propagation: `flux_apps_get_messages`.

## Update

Same pattern using:

- `flux_apps_plan_update`
- `flux_apps_update`
