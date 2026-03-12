# User Testing

Manual and validator-facing testing notes for `fluxos-cli`.

**What belongs here:** how to smoke-test the CLI, live-test boundaries, stub-server expectations, and command families to sample during validation.
**What does NOT belong here:** build/install commands (use `.factory/services.yaml`) or mission task tracking.

---

## Primary test surface

- The main user-testing surface is the CLI itself.
- Use package-local builds plus direct CLI invocation (`node fluxos-cli/dist/index.js ...` or the package bin) for manual smoke checks.
- Prefer stub-server integration tests over real network dependencies for inner-loop validation.

## Manual smoke baseline

Run these when the relevant slice exists:

- `flux --help`
- Representative `--json` command and JSON parse check
- Representative invalid-input command and exit-code check
- Representative pretty-mode command and stderr/stdout separation check

## Live network policy

- Public live tests are read-only and gated.
- Default public target: `https://api.runonflux.io`.
- No interactive auth during normal validation.
- No credentialed or mutating live tests in the default mission path.

## Integration-test pattern

- Start stub servers on `127.0.0.1:0`.
- Capture stdout, stderr, and exit codes separately.
- Validate `resourceUri` workflows by reading the stored resource in a second step.
- Cover generic runner and first-class command parity with shared fixtures where practical.
