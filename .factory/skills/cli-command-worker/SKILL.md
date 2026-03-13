---
name: cli-command-worker
description: Implements first-class fluxos-cli command families on top of shared Flux behavior without weakening safety rules.
---

# CLI Command Worker

NOTE: Startup and cleanup are handled by `worker-base`. This skill defines the work procedure.

## When to Use This Skill

Use this skill for features that add or extend first-class command families such as:

- `flux auth ...`
- `flux node ...`
- `flux apps ...`
- `flux explorer ...`
- `flux daemon ...`
- `flux files ...`
- `flux backup ...`
- `flux fluxdrive ...`
- `flux syncthing ...`

## Work Procedure

1. Read `mission.md`, mission `AGENTS.md`, `.factory/library/architecture.md`, `.factory/library/environment.md`, `.factory/library/shared-runtime.md`, and `.factory/library/user-testing.md`.
2. Identify the existing MCP tool behavior for the command family and the JSON/safety contract the CLI must preserve.
3. Write failing tests first for command parsing, JSON output, confirmation/auth gates, and representative happy-path behavior.
4. Implement a thin first-class CLI adapter on top of the shared or extracted behavior. Do not fork Flux business rules into CLI-only code.
5. Preserve `--json` purity, stderr behavior, exit-code mapping, and confirmation/mutation gating.
6. Run targeted package tests for the command family, then the shared build/test commands from `.factory/services.yaml`.
7. Run at least one direct CLI smoke check for the new command family. Use public live read-only checks only when the feature explicitly requires them and the mission boundary allows it.
8. Update roadmap checkboxes only for the completed slice(s) owned by the feature.

## Example Handoff

```json
{
  "salientSummary": "Implemented `flux auth` core commands and node-target helpers on top of shared Flux behavior. Added contract tests for phrase-first login, diagnose output, direct-node pinning, and logout safety.",
  "whatWasImplemented": "Added first-class auth and node commands in fluxos-cli, reused shared login/gateway resolution behavior from flux-mcp, preserved JSON/confirm semantics, and updated the roadmap for the completed M3 slices.",
  "whatWasLeftUndone": "",
  "verification": {
    "commandsRun": [
      {
        "command": "npm --prefix fluxos-cli test -- --maxWorkers=12 auth node",
        "exitCode": 0,
        "observation": "Auth and node contract tests passed."
      },
      {
        "command": "npm --prefix fluxos-cli run build",
        "exitCode": 0,
        "observation": "The CLI builds with the new command family."
      },
      {
        "command": "npm --prefix flux-mcp test -- --maxWorkers=12",
        "exitCode": 0,
        "observation": "MCP behavior stayed green after wiring shared helpers."
      }
    ],
    "interactiveChecks": [
      {
        "action": "Ran `node fluxos-cli/dist/index.js auth status --json` against a seeded state fixture.",
        "observed": "Stdout stayed parseable and reflected the expected auth summary."
      },
      {
        "action": "Ran a stubbed `node fluxos-cli/dist/index.js node resolve-gateway --json`.",
        "observed": "The command returned a recommended direct-node URL without mutating saved state."
      }
    ]
  },
  "tests": {
    "added": [
      {
        "file": "fluxos-cli/test/auth-node.test.ts",
        "cases": [
          {
            "name": "login without signature returns a phrase flow",
            "verifies": "The CLI keeps the phrase-first auth contract and next-step guidance."
          },
          {
            "name": "use-gateway preserves previous baseUrl on failure",
            "verifies": "Node-target helpers do not clobber state on failure."
          }
        ]
      }
    ]
  },
  "discoveredIssues": []
}
```

## When to Return to Orchestrator

- The command family depends on missing shared extraction beyond the scope of the current feature.
- The CLI command naming or safety behavior conflicts with the approved roadmap or validation contract.
- A live-read-only check is insufficient and the feature would require credentialed or mutating live access to verify safely.
