# Shared Runtime

Shared-runtime extraction notes for keeping `fluxos-cli` and `flux-mcp` behaviorally aligned.

**What belongs here:** reusable modules, extraction order, parity expectations, and MCP-coupled areas that still need adapters.
**What does NOT belong here:** CLI-only UX concerns or roadmap checkbox state.

---

Initial reusable areas already present in `flux-mcp`:

- `src/fluxClient.ts` for request normalization, auth state, enterprise-key handling, and mutation safety.
- `src/fluxEnvelope.ts` for Flux response normalization.
- `src/endpoints.ts` for endpoint inventory loading/search/category summaries.
- `src/resources.ts` for resource redaction/pruning behavior, though CLI needs a disk-backed resource adapter instead of MCP transport resources.
- Shared app/auth/planning helpers currently embedded in `src/index.ts` should be extracted incrementally in the smallest safe slices.

Extraction guidance:

1. Move one low-risk helper at a time.
2. Add failing parity tests before extraction.
3. Keep `flux-mcp` behavior green while wiring `fluxos-cli` to the new helper.
4. Prefer shared outcome parity over large up-front rewrites.

## Initial v1 boundary

- Shared runtime code now lives in a top-level `shared-runtime/` package when the helper has no MCP transport or CLI UX assumptions.
- The first extracted helper is `shared-runtime/src/endpoints.js`, which owns endpoint-inventory loading, category summaries, and route search semantics.
- `flux-mcp/src/endpoints.ts` is now an adapter/re-export layer for the shared helper so MCP keeps its existing import surface.
- `fluxos-cli/src/runtime/endpoints.ts` is the CLI adapter layer that reuses the shared helper and resolves the bundled `flux-mcp/data/endpoints.json` path.

## Inventory snapshot for phase 1

### Safe day-one shared helpers

- `flux-mcp/src/endpoints.ts` helpers can be reused immediately by the CLI through shared-runtime extraction.
- `flux-mcp/src/fluxEnvelope.ts` is still a good next extraction candidate because it is pure response-normalization logic.
- The redaction and prune portions of `flux-mcp/src/resources.ts` are shareable once the CLI disk-backed resource adapter exists.

### Still MCP-coupled

- The MCP server/tool registry in `flux-mcp/src/index.ts` stays MCP-only.
- MCP `resource_link` transport behavior stays MCP-only; only sanitizer/prune logic should move later.
- There is not yet a shared helper/source of truth for CLI failure classification (for example auth/confirm/network/Flux exit-code mapping). Current classification work still needs to inspect real MCP tool result envelopes and message strings in `flux-mcp/src/index.ts` and related runtime code.

### Intentionally CLI-only

- Command parser wiring
- CLI output rendering and exit-code policy
- Local state/profile persistence
- Help text and shell ergonomics

## Parity checklist for future extractions

- same defaults
- same safety checks
- same summary semantics
- same auth semantics
- same error classification where reasonable
