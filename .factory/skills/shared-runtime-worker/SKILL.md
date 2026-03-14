---
name: shared-runtime-worker
description: Extracts and validates shared Flux runtime behavior used by both flux-mcp and fluxos-cli.
---

# Shared Runtime Worker

NOTE: Startup and cleanup are handled by `worker-base`. This skill defines the work procedure.

## When to Use This Skill

Use this skill for features that:

- inventory or extract reusable logic from `flux-mcp`
- define shared runtime boundaries or adapter seams
- add parity tests across `flux-mcp` and `fluxos-cli`
- change shared safety, auth, request, response, or resource behavior

## Work Procedure

1. Read `mission.md`, mission `AGENTS.md`, `.factory/library/architecture.md`, and `.factory/library/shared-runtime.md`.
2. Identify the exact MCP behavior to preserve and the smallest extractable helper or module needed for the feature.
3. Write failing tests first when the behavior is externally observable at the start of the slice. Favor parity/contract tests that prove both surfaces preserve the same behavior. For finalize-only audits or tiny observability-hook-first fixes, you may add the minimal hook needed to observe the behavior first, but document the exception explicitly in the handoff.
4. Extract the smallest safe shared helper; do not rewrite large parts of `flux-mcp/src/index.ts` unless the feature explicitly requires it.
5. Wire `flux-mcp` and/or `fluxos-cli` to the shared helper without weakening safety checks.
6. Run targeted tests for the changed helper first, then package-level build/test commands from `.factory/services.yaml`.
7. If the feature exposes a CLI surface, run a brief manual smoke command to confirm the shared behavior is actually reachable from the shell.
8. Update roadmap checkboxes only for the completed slice(s) this feature owns.

## Example Handoff

```json
{
  "salientSummary": "Extracted request-error classification and confirmation gating into a shared helper, then wired both flux-mcp and fluxos-cli through it. Added parity tests proving identical auth-required and confirm-required failures on both surfaces.",
  "whatWasImplemented": "Created a shared runtime module for request safety/error classification, updated the MCP call path and CLI adapter to use it, and added parity tests covering validation, auth-required, confirm-required, and network failure behavior.",
  "whatWasLeftUndone": "",
  "verification": {
    "commandsRun": [
      {
        "command": "npm --prefix flux-mcp test -- --maxWorkers=12",
        "exitCode": 0,
        "observation": "Shared-runtime parity and existing MCP tests passed."
      },
      {
        "command": "npm --prefix fluxos-cli test -- --maxWorkers=12",
        "exitCode": 0,
        "observation": "CLI parity tests passed with the extracted helper."
      },
      {
        "command": "npm --prefix flux-mcp run build && npm --prefix fluxos-cli run build",
        "exitCode": 0,
        "observation": "Both packages build after the extraction."
      }
    ],
    "interactiveChecks": [
      {
        "action": "Ran a representative CLI command that hits the extracted helper in --json mode.",
        "observed": "The CLI returned the expected stable JSON envelope and exit code."
      }
    ]
  },
  "tests": {
    "added": [
      {
        "file": "flux-mcp/test/sharedParity.test.ts",
        "cases": [
          {
            "name": "classifies confirm-required failures consistently",
            "verifies": "Both surfaces expose the same policy outcome and message."
          },
          {
            "name": "classifies auth-required failures consistently",
            "verifies": "Both surfaces preserve the same auth gate behavior."
          }
        ]
      }
    ]
  },
  "discoveredIssues": []
}
```

## When to Return to Orchestrator

- The feature needs a product decision about the long-term shared-runtime location.
- Extracting the required logic would force a large rewrite outside the approved slice.
- The CLI command family cannot proceed safely until a different missing shared helper is extracted first.
- The repo’s existing MCP behavior is ambiguous and the mission artifacts do not resolve it.
