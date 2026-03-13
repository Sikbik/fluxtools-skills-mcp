---
name: cli-platform-worker
description: Builds the fluxos-cli package, parser, output contracts, state, resources, automation flags, examples, and release surfaces.
---

# CLI Platform Worker

NOTE: Startup and cleanup are handled by `worker-base`. This skill defines the work procedure.

## When to Use This Skill

Use this skill for features that:

- scaffold or rename the `fluxos-cli` package
- implement generic CLI entrypoints, parsing, output, exit codes, and resource persistence
- add state/profile/config storage and visibility commands
- add automation flags, examples, CI/release surfaces, and repo guidance for the CLI

## Work Procedure

1. Read `mission.md`, mission `AGENTS.md`, `.factory/library/architecture.md`, `.factory/library/environment.md`, and `.factory/library/user-testing.md`.
2. Check the current roadmap slice and preserve the `fluxos-cli` package naming plus `flux` binary contract.
3. Write failing tests first for parser/output/state/resource behavior before editing implementation code.
4. If the branch already contains in-scope partial implementation for the feature, audit the existing diff first, add focused regression tests around the gap, and explicitly note the deviation from the clean-slate test-first path in your handoff.
5. Implement the smallest CLI slice that fully satisfies the feature without duplicating Flux business logic that should stay shared.
6. If the feature needs shared behavior that does not exist yet, extract or request the smallest helper instead of copy-pasting MCP logic.
7. Run targeted package tests first, then the build/test commands from `.factory/services.yaml`.
8. Run at least one direct CLI smoke command covering the new slice (for example `--help`, `--json`, `state show`, or `resource read`).
9. Update roadmap checkboxes only for the slice completed by this feature.

## Example Handoff

```json
{
  "salientSummary": "Scaffolded fluxos-cli as a standalone Node 20+ TypeScript ESM package, added the flux entrypoint, and implemented generic tool listing with JSON/pretty output tests. The package now builds and the CLI prints help cleanly.",
  "whatWasImplemented": "Created fluxos-cli/package.json, tsconfig, src entrypoints, Vitest configuration, and initial CLI routing for help and `flux tool list`, plus output-mode tests and roadmap checkbox updates for the completed bootstrap slice.",
  "whatWasLeftUndone": "",
  "verification": {
    "commandsRun": [
      {
        "command": "npm --prefix fluxos-cli test -- --maxWorkers=12",
        "exitCode": 0,
        "observation": "CLI parser and output tests passed."
      },
      {
        "command": "npm --prefix fluxos-cli run build",
        "exitCode": 0,
        "observation": "Package builds and emits the CLI entrypoint."
      },
      {
        "command": "npm --prefix flux-mcp test -- --maxWorkers=12",
        "exitCode": 0,
        "observation": "No regressions in existing MCP behavior."
      }
    ],
    "interactiveChecks": [
      {
        "action": "Ran `node fluxos-cli/dist/index.js --help`.",
        "observed": "Help printed without crashing and showed the expected top-level command structure."
      },
      {
        "action": "Ran `node fluxos-cli/dist/index.js tool list --json`.",
        "observed": "Stdout contained parseable JSON only."
      }
    ]
  },
  "tests": {
    "added": [
      {
        "file": "fluxos-cli/test/cli.test.ts",
        "cases": [
          {
            "name": "prints help for the root command",
            "verifies": "The new package has a usable CLI entrypoint."
          },
          {
            "name": "tool list JSON mode is parseable",
            "verifies": "JSON output stays machine-safe."
          }
        ]
      }
    ]
  },
  "discoveredIssues": []
}
```

## When to Return to Orchestrator

- The feature requires a missing shared runtime helper and extracting it would exceed the current slice.
- The package or automation surface needs a product decision not captured in the mission artifacts.
- The CLI cannot preserve JSON/stdout/stderr contracts without a broader redesign.
