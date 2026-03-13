# Flux CLI - Roadmap

This roadmap is the build plan for a shell-native Flux CLI that reuses the operational intelligence already encoded in this repository while expanding Flux automation beyond MCP-only clients.

The CLI is intended to be:

- agent-friendly
- shell-friendly
- CI-friendly
- human-usable
- safe-by-default
- architecture-compatible with the existing MCP server

The goal is not to build a second, separate Flux implementation. The goal is to create a CLI execution surface that shares behavior with `flux-mcp`, can stand on its own for shell-capable agents, and can later be integrated back into the skills and MCP as an optional execution path.

---

## Why this exists

Today, this repository is strongest when the user or agent has MCP support. That is already valuable, but it leaves power on the table:

- many agents can run shell commands but do not support MCP
- shell-native workflows are easier to compose in CI, scripts, cron, and infrastructure automation
- JSON-over-stdout is often the easiest contract for agentic loops
- operators may want Flux automation without adopting MCP first

A dedicated `fluxos-cli` can close that gap.

If done correctly, it becomes:

- a universal execution surface for shell-capable agents
- a stable JSON contract for automation
- a fallback path when MCP is unavailable
- a portable bridge into GitHub Actions, local scripts, Ansible, cron, and task runners
- a future backend option for skills and MCP wrappers

---

## Project positioning

`fluxos-cli` should live in its own folder and evolve as its own package inside this repository.

Initial repo target:

```text
fluxos-cli/
├── ROADMAP.md
├── package.json
├── tsconfig.json
├── src/
│   ├── index.ts
│   ├── cli.ts
│   ├── commands/
│   ├── output/
│   ├── state/
│   ├── config/
│   ├── adapters/
│   └── shared/
└── test/
```

Important architectural rule:

- `fluxos-cli` should start as a separate package
- it should not fork Flux workflow logic from `flux-mcp`
- it should progressively pull shared execution code into a reusable layer
- MCP and skills should remain the primary interface until the CLI reaches functional maturity
- surface-level CLI code can be duplicated when that keeps the CLI independent and practical

---

## Non-negotiable principles

- [x] Build the CLI in its own folder instead of mixing it into `flux-mcp`.
- [x] Keep the CLI optional until it proves stable and useful.
- [x] Reuse existing Flux workflow logic where possible.
- [x] Do not duplicate business rules across MCP and CLI if extraction is feasible.
- [x] Allow duplication of interface-level CLI code when it improves shell usability and keeps MCP optional.
- [x] Preserve the repo's safety model: `confirm=true` and mutation gating semantics must remain explicit.
- [x] Prefer machine-readable JSON output first; human formatting should be layered on top.
- [x] Make the CLI useful for agents before optimizing for interactive human UX.
- [x] Keep the first versions small, testable, and shippable.

Practical duplication rule:

- duplicate CLI-facing code freely:
  - argument parsing
  - command routing
  - config and profile management
  - local state persistence
  - output formatting
  - exit code handling
  - help text and shell ergonomics
- avoid duplicating Flux domain logic unless it is an explicit temporary tradeoff:
  - auth semantics
  - mutation gating
  - signing rules
  - request normalization
  - registration, update, and renew behavior
  - endpoint classification and operational policy

---

## Current leverage from this repository

The CLI is attractive because the repo already contains most of the difficult domain logic.

Existing assets that can be reused:

- [x] Flux API client behavior in `flux-mcp/src/fluxClient.ts`
- [x] tool registry semantics in `flux-mcp/src/index.ts`
- [x] workflow logic for:
  - [x] auth
  - [x] signing flows
  - [x] app registration and update planning
  - [x] renewals
  - [x] lifecycle operations
  - [x] logs, inspect, stats, top, monitor, exec
  - [x] file and backup operations
  - [x] daemon and explorer queries
  - [x] Syncthing operations
- [x] resource storage concepts in `flux-mcp/src/resources.ts`
- [x] output conventions and summary shapes already used by MCP tools
- [x] endpoint inventory data in `flux-mcp/data/endpoints.json`
- [x] extensive tests in `flux-mcp/test/`

This means the roadmap is mostly about:

- packaging
- shared-core extraction
- CLI command design
- persistence
- output contracts
- UX and release discipline

Not about inventing Flux behavior from scratch.

It is acceptable for the CLI to have its own surface implementation even if that means some wrapper duplication. The thing to protect is the Flux operational brain, not the shell wrapper.

---

## North star

When this roadmap is complete, `fluxos-cli` should support all of the following:

- `flux tool <tool-name> --json --args-file ...`
- first-class subcommands for common workflows:
  - `flux auth ...`
  - `flux node ...`
  - `flux apps ...`
  - `flux daemon ...`
  - `flux explorer ...`
  - `flux files ...`
  - `flux backup ...`
  - `flux syncthing ...`
- persistent local state:
  - base URL
  - auth
  - enterprise key
  - resource cache metadata
  - profiles
- stable JSON contracts for agents
- shell-safe exit codes
- optional integration back into skills and MCP once the CLI has proven itself

---

## Roadmap overview

- Phase 0: Planning and package bootstrap
- Phase 1: Shared-core extraction strategy
- Phase 2: Generic tool runner MVP
- Phase 3: State, config, and profile persistence
- Phase 4: First-class auth and session commands
- Phase 5: First-class app operations commands
- Phase 6: Explorer, daemon, files, backup, and Syncthing coverage
- Phase 7: Agentic workflow and shell ergonomics
- Phase 8: Test hardening and release readiness
- Phase 9: Optional integration into skills and MCP

---

## Phase 0 - Planning and package bootstrap

### 0.1 Create the planning surface
- [x] Create `fluxos-cli/`
- [x] Add `fluxos-cli/ROADMAP.md`
- [x] Update the root `AGENTS.md` to make the CLI roadmap the primary execution guide

Done when:

- the project has a dedicated planning area for the CLI
- contributors know the target direction before code starts

### 0.2 Define the package boundary
- [x] Decide package name:
  - [x] `fluxos-cli`
  - [x] revisit a scoped variant only if publishing becomes necessary later
- [x] Decide runtime:
  - [x] Node.js 20+
  - [x] TypeScript ESM
- [x] Decide packaging:
  - [x] standalone package inside repo
  - [x] optional future npm package
- [x] Decide whether v1 is:
  - [x] repo-internal first
  - [x] installable via `npm link`
  - [x] shipped as a release artifact later

Done when:

- the package identity and runtime assumptions are fixed

### 0.3 Scaffold the package
- [x] Create `fluxos-cli/package.json`
- [x] Create `fluxos-cli/tsconfig.json`
- [x] Add `src/index.ts`
- [x] Add `src/cli.ts`
- [x] Add `test/`
- [x] Add npm scripts:
  - [x] `build`
  - [x] `test`
  - [x] `dev`
  - [ ] `lint` if adopted

Done when:

- `npm run build` succeeds in `fluxos-cli/`
- the CLI can print a placeholder help screen

---

## Phase 1 - Shared-core extraction strategy

This is the most important architectural phase. If skipped, the repo will drift into duplicate logic and inconsistent behavior.

### 1.1 Inventory reusable MCP logic
- [x] Map what `fluxos-cli` can call directly from `flux-mcp` on day one
- [x] Identify code that is tightly coupled to MCP transport
- [x] Identify code that can move into a shared runtime layer
- [x] Identify code that should remain MCP-only
- [x] Identify code that should intentionally stay CLI-only even if it duplicates MCP-adjacent behavior

Candidate extraction areas:

- [ ] argument validation helpers
- [ ] auth helpers
- [ ] message-to-sign helpers
- [ ] Flux response normalization helpers
- [x] endpoint inventory helpers
- [ ] client state mutation helpers
- [ ] resource handling abstractions

Candidate areas that are fine to keep CLI-specific:

- [ ] command parser wiring
- [ ] CLI output rendering
- [ ] shell exit-code policy
- [ ] state-file layout
- [ ] profile UX
- [ ] command help text

Done when:

- there is a written extraction plan with concrete file targets

### 1.2 Create a shared runtime boundary
- [ ] Define a shared execution interface for calling a Flux operation without MCP transport assumptions
- [ ] Separate transport concerns from operation logic
- [ ] Decide where shared code will live:
  - [ ] `flux-mcp/src/shared/`
  - [ ] `fluxos-cli/src/shared/`
  - [x] a future top-level shared package
- [x] Move one low-risk helper first as the extraction test

Done when:

- one non-trivial workflow is shared by both MCP and CLI without duplicated logic

### 1.3 Preserve behavior parity
- [x] Define a parity checklist between MCP and CLI:
  - [x] same defaults
  - [x] same safety checks
  - [x] same summary semantics
  - [x] same auth semantics
  - [x] same error classification where reasonable
- [x] Add tests that compare shared-core behavior across surfaces

Done when:

- contributors can prove the CLI is not inventing divergent behavior

---

## Phase 2 - Generic tool runner MVP

The fastest useful milestone is not a huge polished CLI. It is a generic tool runner.

### 2.1 Ship `flux tool`
- [x] Add command:
  - [x] `flux tool list`
  - [x] `flux tool call <tool-name>`
- [x] Support args input:
  - [x] `--arg key=value`
  - [x] `--args-json '{...}'`
  - [x] `--args-file path.json`
- [x] Support output modes:
  - [x] `--json`
  - [x] `--pretty`
  - [x] `--raw`

Done when:

- an agent can call any existing Flux tool from the shell without MCP

### 2.2 Make JSON contracts explicit
- [x] Print pure JSON to stdout in `--json` mode
- [x] Print human summaries to stdout in pretty mode
- [x] Send operational errors to stderr in human mode
- [x] Preserve stable keys for automation:
  - [x] `ok`
  - [x] `status`
  - [x] `resourceUri`
  - [x] `nextActions`

Done when:

- shell agents can parse the output safely with `jq`

### 2.3 Add shell-safe exit codes
- [x] `0` for success
- [x] non-zero for tool execution failure
- [x] specific classes if useful:
  - [x] validation error
  - [x] auth required
  - [x] confirm required
  - [x] network failure
  - [x] Flux error

Done when:

- CI and scripts can branch on exit codes reliably

### 2.4 Replace MCP resource assumptions
- [x] Define how CLI exposes `resource_link`-style outputs
- [x] Add command:
  - [x] `flux resource read <uri>`
  - [x] `flux resource list`
  - [x] `flux resource prune`
- [x] Decide whether resource payloads are:
  - [ ] in-memory for one process only
  - [x] persisted on disk
  - [x] both

Done when:

- large outputs remain manageable outside MCP

---

## Phase 3 - State, config, and profile persistence

MCP is session-oriented. A CLI will be much less useful if every command starts from zero.

### 3.1 Define state model
- [ ] Persist:
  - [ ] `baseUrl`
  - [ ] `zelidauth`
  - [ ] enterprise key
  - [ ] HTTP defaults
  - [ ] FluxDrive base URL
  - [ ] profile name
- [ ] Decide file location strategy:
  - [ ] XDG on Linux
  - [ ] fallback to home config directory
  - [ ] project-local override if requested

Done when:

- a user can authenticate once and reuse the session across CLI invocations

### 3.2 Add profile support
- [ ] `flux profile list`
- [ ] `flux profile use <name>`
- [ ] `flux profile create <name>`
- [ ] `flux profile delete <name>`
- [ ] profile-scoped state:
  - [ ] base URL
  - [ ] auth
  - [ ] enterprise key
  - [ ] optional labels

Done when:

- multiple nodes or environments can be managed cleanly

### 3.3 Add explicit state visibility
- [ ] `flux state show`
- [ ] `flux state clear`
- [ ] `flux auth clear`
- [ ] `flux enterprise-key clear`

Done when:

- users and agents can introspect current session assumptions

---

## Phase 4 - First-class auth and session commands

Once `flux tool` works, the next step is to make the highest-value workflows ergonomic.

### 4.1 Add `flux auth`
- [ ] `flux auth login --zelid ...`
- [ ] `flux auth status`
- [ ] `flux auth diagnose`
- [ ] `flux auth logout`
- [ ] `flux auth phrase`

Done when:

- users no longer need the generic tool runner for common auth work

### 4.2 Preserve signing UX
- [ ] expose returned sign launcher URLs clearly
- [ ] support both Zelcore and SSP Wallet messaging in CLI output
- [ ] add flags for browser-launcher convenience if later desired
- [ ] keep `--json` output exact and automation-safe

Done when:

- CLI auth feels first-class instead of like a wrapped MCP response

### 4.3 Add direct-node helpers
- [ ] `flux node resolve-gateway`
- [ ] `flux node use-gateway`
- [ ] `flux node use-base-url`

Done when:

- users can move from gateway to direct-node operation in one or two commands

---

## Phase 5 - First-class app operations commands

This is where the CLI becomes genuinely powerful for day-to-day Flux work.

### 5.1 Add app discovery commands
- [ ] `flux apps list-running`
- [ ] `flux apps list-all`
- [ ] `flux apps list-global`
- [ ] `flux apps global-status`
- [ ] `flux apps by-zelid`
- [ ] `flux apps get-spec`
- [ ] `flux apps get-spec-full`

Done when:

- common read paths no longer require `flux tool call`

### 5.2 Add app lifecycle commands
- [ ] `flux apps start`
- [ ] `flux apps stop`
- [ ] `flux apps restart`
- [ ] `flux apps redeploy`
- [ ] `flux apps redeploy-component`

Requirements:

- [ ] preserve confirmation semantics
- [ ] support `--confirm`
- [ ] never hide mutations behind implicit behavior

Done when:

- lifecycle actions are shell-friendly and safe

### 5.3 Add app troubleshooting commands
- [ ] `flux apps troubleshoot`
- [ ] `flux apps health`
- [ ] `flux apps logs`
- [ ] `flux apps inspect`
- [ ] `flux apps stats`
- [ ] `flux apps top`
- [ ] `flux apps monitor`
- [ ] `flux apps exec`

Done when:

- runtime debugging is practical from a single CLI surface

### 5.4 Add app deployment commands
- [ ] `flux apps generate-spec`
- [ ] `flux apps verify-registration`
- [ ] `flux apps verify-update`
- [ ] `flux apps calculate-price`
- [ ] `flux apps plan-registration`
- [ ] `flux apps register`
- [ ] `flux apps plan-update`
- [ ] `flux apps plan-renew`
- [ ] `flux apps update`
- [ ] `flux apps register-and-verify`
- [ ] `flux apps update-and-verify`
- [ ] `flux apps wait-propagation`
- [ ] `flux apps messages`
- [ ] `flux apps test-install`

Done when:

- full app delivery lifecycle is available from CLI without MCP

### 5.5 Add Git deploy commands
- [ ] `flux git generate-spec`
- [ ] `flux git plan-registration`
- [ ] `flux git register-and-verify`

Done when:

- Git-based deployment becomes a first-class CLI workflow

---

## Phase 6 - Explorer, daemon, files, backup, and Syncthing coverage

### 6.1 Add explorer commands
- [ ] `flux explorer status`
- [ ] `flux explorer height`
- [ ] `flux explorer balance`
- [ ] `flux explorer restart`
- [ ] `flux explorer stop`
- [ ] `flux explorer reindex`
- [ ] `flux explorer rescan`

Done when:

- the CLI can cover common node analytics and maintenance

### 6.2 Add daemon commands
- [ ] `flux daemon call`
- [ ] `flux daemon info`
- [ ] `flux daemon blockchain-info`
- [ ] `flux daemon network-info`
- [ ] `flux daemon peer-info`
- [ ] `flux daemon mempool-info`
- [ ] `flux daemon raw-mempool`
- [ ] `flux daemon block-count`
- [ ] `flux daemon connection-count`
- [ ] `flux daemon difficulty`

Done when:

- daemon reads are ergonomic and mutation-safe policy is preserved

### 6.3 Add file and backup commands
- [ ] `flux files list`
- [ ] `flux files download`
- [ ] `flux files download-folder`
- [ ] `flux files mkdir`
- [ ] `flux files rename`
- [ ] `flux files remove`
- [ ] `flux backup volume-data`
- [ ] `flux backup remote-size`
- [ ] `flux backup list-local`
- [ ] `flux backup remove-file`
- [ ] `flux backup download-local`
- [ ] `flux fluxdrive set-base-url`
- [ ] `flux fluxdrive register-backup-file`
- [ ] `flux fluxdrive task-status`
- [ ] `flux fluxdrive backup-list`
- [ ] `flux fluxdrive remove-checkpoint`

Done when:

- app file operations and backup workflows are scriptable

### 6.4 Add Syncthing commands
- [ ] `flux syncthing metrics`
- [ ] `flux syncthing metrics-health`
- [ ] `flux syncthing system-status`
- [ ] `flux syncthing list-folders`
- [ ] `flux syncthing list-devices`
- [ ] `flux syncthing db-browse`
- [ ] `flux syncthing db-scan`
- [ ] `flux syncthing restart`

Done when:

- Syncthing administration is fully available through the CLI

---

## Phase 7 - Agentic workflow and shell ergonomics

This phase is what turns the CLI from "usable" into "agentically powerful."

### 7.1 Optimize for shell-capable agents
- [ ] ensure every major command supports `--json`
- [ ] ensure no pretty output leaks into `--json`
- [ ] add predictable stderr behavior
- [ ] document command examples for agents
- [ ] support file-based input for large payloads

Done when:

- shell agents can treat `fluxos-cli` as a stable machine interface

### 7.2 Add workflow composition helpers
- [ ] allow `--output-file`
- [ ] allow `--from-resource-uri`
- [ ] allow `--profile`
- [ ] allow `--base-url`
- [ ] allow `--no-state` for stateless execution

Done when:

- the CLI can be composed cleanly inside scripts and automation loops

### 7.3 Add optional shell/session mode
- [ ] evaluate `flux shell`
- [ ] evaluate REPL-style command reuse
- [ ] evaluate in-process resource retention

This is not required for MVP.

Done when:

- there is a clear yes/no decision on interactive shell mode

### 7.4 Add machine-friendly docs and examples
- [ ] `examples/agent/`
- [ ] `examples/ci/`
- [ ] `examples/bash/`
- [ ] `examples/github-actions/`

Done when:

- agents and operators can copy working patterns instead of inventing them

---

## Phase 8 - Test hardening and release readiness

### 8.1 Add test categories
- [ ] command parsing tests
- [ ] JSON contract tests
- [ ] golden output tests for pretty mode
- [ ] profile/state persistence tests
- [ ] parity tests against shared MCP logic
- [ ] integration tests against stub HTTP servers

Done when:

- the CLI is testable as a contract, not only as implementation

### 8.2 Add safety regression tests
- [ ] confirm-required enforcement
- [ ] mutation gating
- [ ] auth-required paths
- [ ] error-to-exit-code mapping
- [ ] resource lifecycle behavior

Done when:

- future contributors cannot accidentally soften safety boundaries

### 8.3 Add release pipeline
- [ ] add CLI CI job
- [ ] add build artifact strategy
- [ ] decide whether to publish binaries or npm package
- [ ] add release notes section for CLI

Done when:

- `fluxos-cli` can be shipped independently of `flux-mcp` when ready

---

## Phase 9 - Optional integration into skills and MCP

This phase is intentionally late. The CLI should prove itself first.

### 9.1 Decide the integration model
- [ ] Option A: skills mention the CLI as an alternative execution surface
- [ ] Option B: MCP can invoke CLI in selected contexts
- [ ] Option C: MCP and CLI both share a common runtime package and remain peers

Preferred direction:

- [ ] keep MCP and CLI as peers on top of shared execution code

Done when:

- the repo has one clear long-term architecture instead of accidental layering

### 9.2 Integrate into skills cautiously
- [ ] update Codex skill docs
- [ ] update Claude skill docs
- [ ] document when to prefer MCP vs CLI
- [ ] define fallback guidance:
  - [ ] use MCP when the client supports it
  - [ ] use CLI when shell execution is easier or MCP is unavailable

Done when:

- skills can intelligently recommend the right execution surface

### 9.3 Explore MCP-to-CLI fallback
- [ ] evaluate whether MCP tool handlers should ever call the CLI
- [ ] reject this approach if it adds unnecessary indirection
- [ ] only allow it if it clearly reduces maintenance burden

Done when:

- the project avoids a fragile "wrapper on wrapper" architecture

---

## Milestone ordering for real execution

Recommended implementation order:

1. Phase 0.2 and 0.3
2. Phase 1.1 through 1.3
3. Phase 2.1 through 2.4
4. Phase 3.1 through 3.3
5. Phase 4.1 through 4.3
6. Phase 5.1 through 5.4
7. Phase 6.1 through 6.4
8. Phase 7.1 through 7.4
9. Phase 8.1 through 8.3
10. Phase 9.1 through 9.3

---

## Shippable milestones

### Milestone M1 - Generic agent runner
- [x] `flux tool list`
- [x] `flux tool call`
- [x] `--json`
- [x] args via file or JSON
- [x] stable exit codes

### Milestone M2 - Persistent operator session
- [ ] saved base URL
- [ ] saved auth
- [ ] profiles
- [ ] state visibility commands

### Milestone M3 - App operations CLI
- [ ] list apps
- [ ] get spec
- [ ] logs and health
- [ ] lifecycle controls
- [ ] plan registration/update

### Milestone M4 - Full operational surface
- [ ] daemon
- [ ] explorer
- [ ] files
- [ ] backup
- [ ] Syncthing

### Milestone M5 - Repo-wide integration
- [ ] docs updated
- [ ] skills updated
- [ ] release process defined
- [ ] architecture stabilized

---

## Risks and traps to avoid

- [ ] Duplicating logic from `flux-mcp/src/index.ts` directly into the CLI
- [ ] Mistaking all duplication for bad duplication and over-blocking useful CLI progress
- [ ] Shipping pretty output before stable JSON contracts
- [ ] Making the CLI interactive too early
- [ ] Hiding mutating operations behind "friendly" commands without explicit confirmation
- [ ] Introducing breaking behavior differences between MCP and CLI
- [ ] Treating resource handling as an afterthought
- [ ] Wiring skills to the CLI before the CLI is stable

---

## Open questions

- [ ] Should `fluxos-cli` be repo-internal only at first, or published?
- [ ] Should profiles be global, project-local, or both?
- [ ] Should resource payloads be persisted to disk by default?
- [ ] Should v1 support launching browser URLs automatically, or only print them?
- [ ] Should there be a `flux shell` mode, or is that unnecessary complexity?
- [ ] Should the long-term shared runtime stay in `flux-mcp`, `fluxos-cli`, or move to a third package?

---

## Definition of success

This roadmap succeeds when:

- an agent without MCP support can still automate Flux workflows safely
- operators can use Flux from shell scripts and CI without hand-writing raw API calls
- CLI and MCP share enough code to remain behaviorally aligned
- the CLI becomes a genuine force multiplier for the Flux ecosystem rather than a duplicated maintenance burden
