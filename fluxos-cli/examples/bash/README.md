# Bash Examples

## Fail fast on invalid or failed commands

```bash
set -euo pipefail

status_json="$(flux apps global-status --appname myapp --json)"
echo "$status_json" | jq .
```

## Use persisted resources instead of temporary JSON plumbing

```bash
plan_json="$(flux apps plan-update --spec-file app-spec.json --json)"
plan_uri="$(echo "$plan_json" | jq -r '.resourceUri')"

flux apps update --from-resource-uri "$plan_uri" --signature "$SIGNATURE" --json
```

## Mirror outputs to files for later steps

```bash
flux --output-file artifacts/logs.json apps logs myapp --json
```

## Run against a specific saved profile

```bash
flux --profile prod apps health myapp --json
flux --profile prod syncthing metrics-health --json
```
