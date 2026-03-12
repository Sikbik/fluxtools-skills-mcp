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
