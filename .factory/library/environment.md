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
- State should follow XDG config paths on Linux with a home-directory fallback.
- Use ephemeral stub HTTP servers bound to `127.0.0.1:0` for automated integration tests.
