---
name: cli-finalize-worker
description: Finalizes existing in-scope CLI diffs that already pass validators by auditing, smoke-checking, and committing the exact slice without broadening scope.
---

# CLI Finalize Worker

NOTE: Startup and cleanup are handled by `worker-base`. This skill defines the work procedure.

## When to Use This Skill

Use this skill only for features that:

- explicitly say the branch already contains the in-scope implementation diff
- already pass their targeted validators and the repo-wide validators
- need a finalize-only audit, smoke evidence, commit, and handoff

Do not use this skill for fresh implementation work.

## Work Procedure

1. Read `mission.md`, mission `AGENTS.md`, the feature description, `.factory/library/architecture.md`, and `.factory/library/environment.md`.
2. Confirm the feature is finalize-only and identify the exact in-scope dirty files from the feature description plus `git status`.
3. Audit only that existing diff. Do not broaden scope, refactor widely, or restart from a clean slate.
4. When the finalize-only diff is primarily tests, contract fixtures, or roadmap notes, compare it against the canonical shipped runtime behavior and any existing MCP/runtime contract tests already on the branch before approving it.
5. If the feature description says targeted and repo-wide validators already pass for the current diff, preserve that assumption and avoid rewriting tests or code unless a smoke check proves a real gap.
6. Run the feature-specific smoke checks and capture clear evidence. If a live submit smoke is auth-blocked or otherwise blocked by mission boundaries, record that explicitly and rely on the existing automated coverage instead of expanding scope.
7. If the existing diff still satisfies the feature contract, commit exactly the in-scope files and return the handoff immediately.

## Example Handoff

```json
{
  "salientSummary": "Audited the existing partial Git deploy diff, confirmed it already satisfied the feature contract, ran the remaining smoke checks, and committed the exact slice without broadening scope.",
  "whatWasImplemented": "Finalized the already-present CLI Git deploy diff across the expected files, preserved the existing validator coverage, and recorded smoke-check evidence for the remaining contract points before committing.",
  "whatWasLeftUndone": "",
  "verification": {
    "commandsRun": [
      {
        "command": "npm --prefix fluxos-cli test -- --maxWorkers=12 git-deploy",
        "exitCode": 0,
        "observation": "Targeted Git deploy tests stayed green for the existing diff."
      },
      {
        "command": "node fluxos-cli/dist/index.js git generate-spec --json <flags>",
        "exitCode": 0,
        "observation": "Smoke check confirmed the built CLI returned the expected JSON contract."
      }
    ]
  },
  "tests": {
    "added": []
  },
  "discoveredIssues": []
}
```

## When to Return to Orchestrator

- The supposed finalize-only diff is missing or no longer limited to the feature scope.
- A smoke check reveals a real contract failure that requires broader implementation work.
- Validation no longer passes for the existing diff and the regression is not trivial to fix within the finalize-only scope.
