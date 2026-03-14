# Agent Examples

These examples assume the agent can execute shell commands and parse JSON.

## Generic tool execution

```bash
flux tool list --json
flux tool call flux_get_state --json
```

## Reuse generated artifacts

```bash
flux apps generate-spec --name demo --owner t1Example --json > spec.json
jq -r '.resourceUri' spec.json
flux apps verify-registration --from-resource-uri "$(jq -r '.resourceUri' spec.json)" --json
```

## Plan, sign, submit

```bash
flux apps plan-registration --spec-file app-spec.json --json > plan.json
jq -r '.messageToSignResourceUri' plan.json
jq -r '.resourceUri' plan.json
flux apps register --from-resource-uri "$(jq -r '.resourceUri' plan.json)" --signature "$SIGNATURE" --json
```

## Use one-off profiles and node overrides

```bash
flux --profile staging --base-url http://10.0.0.15:16127 apps list-running --json
flux --profile staging --base-url http://10.0.0.15:16127 apps troubleshoot myapp --json
```

## Stateless agent execution

```bash
flux --no-state --base-url http://10.0.0.15:16127 tool call flux_get_state --json
```

## Persist machine output to disk

```bash
flux --output-file artifacts/global-status.json apps global-status --appname myapp --json
```
