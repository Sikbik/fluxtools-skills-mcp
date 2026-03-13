# Environment

Environment variables, external dependencies, and setup notes for the `fluxos-cli` mission.

**What belongs here:** runtime targets, env flags, public/live-test boundaries, config-path rules, and setup quirks.
**What does NOT belong here:** service commands or ports (use `.factory/services.yaml`).

---

- Runtime target for shipped code: Node.js 20+.
- Local development currently runs on Node.js 24; workers must preserve Node 20 compatibility.
- No root workspace package exists. Use package-local commands with `npm --prefix <package>`.
- Public live testing is read-only and opt-in. Plan for `FLUX_LIVE_TESTS=1` plus `FLUX_API_BASE_URL=https://api.runonflux.io`.
- No interactive auth during normal implementation or validation.
- Any future authenticated live validation must be isolated behind a dedicated non-interactive staging profile and must not run by default.
- Persisted `fluxos-cli` session state, profile state, and the CLI resource store use the same Linux state-directory policy: `FLUXOS_CLI_STATE_DIR` when set, otherwise `XDG_STATE_HOME/fluxos-cli`, otherwise `~/.local/state/fluxos-cli`.
- Use ephemeral stub HTTP servers bound to `127.0.0.1:0` for automated integration tests.
- `jq` is not installed in this environment; use Python or the Read tool when you need to inspect JSON mission artifacts.
- Run `.factory/init.sh` with `bash` (or its shebang). Invoking it with `sh` fails in this environment because the script uses `pipefail`.
