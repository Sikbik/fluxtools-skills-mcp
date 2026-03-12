# Architecture

Architectural decisions and boundary rules for the `fluxos-cli` mission.

**What belongs here:** shared-runtime boundaries, CLI-vs-MCP responsibilities, naming decisions, and stability rules.
**What does NOT belong here:** transient task status (use mission artifacts) or command invocations (use `.factory/services.yaml`).

---

- The package/folder name is `fluxos-cli` to avoid confusion with the Flux daemon.
- The CLI command/binary remains `flux`.
- `fluxos-cli` is a standalone in-repo package, repo-internal first, and `npm link` friendly. Publishing is deferred until the package is mature.
- Reuse or extract Flux business logic from `flux-mcp` whenever it defines Flux behavior.
- Allowed CLI-only duplication: argument parsing, command routing, output rendering, exit-code mapping, local state/profile persistence, help text, and shell ergonomics.
- Avoid duplicating: auth semantics, mutation gating, signing payload rules, request normalization, registration/update/renew behavior, endpoint classification, and response normalization.
- Keep `fluxos-cli` and `flux-mcp` as peers over shared execution code. Do not introduce wrapper-on-wrapper indirection.
- JSON-first contracts take priority over pretty output.
- `--json` stdout must stay parseable; human guidance belongs in pretty output or stderr.
- Preserve `confirm=true` / `allowMutation=true` safety semantics across both surfaces.
