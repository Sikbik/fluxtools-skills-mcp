# CI Examples

Use the CLI in CI when you want explicit JSON contracts and shell-native control flow.

## Inspect node state

```bash
flux --base-url "$FLUX_NODE_URL" daemon info --json
flux --base-url "$FLUX_NODE_URL" explorer status --json
```

## Verify a spec before promotion

```bash
flux apps verify-registration --spec-file app-spec.json --json > verify.json
jq -e '.ok == true' verify.json > /dev/null
```

## Prepare a reusable registration plan

```bash
flux apps plan-registration --spec-file app-spec.json --json > plan.json
jq -e '.status == "ready"' plan.json > /dev/null
```

## Submit from a stored plan artifact

```bash
PLAN_URI="$(jq -r '.resourceUri' plan.json)"
flux apps register --from-resource-uri "$PLAN_URI" --signature "$FLUX_SIGNATURE" --json > register.json
jq -e '.ok == true' register.json > /dev/null
```
