# Contributing

This repo contains three related layers:

- `flux-mcp/`: TypeScript MCP server (execution layer)
- `codex/flux-cloud/`: Codex skill + references + scripts
- `claude/flux-cloud/`: Claude skill + references

## Development setup

- Node.js >= 20
- Python 3.x

### Build/test MCP server

```bash
cd flux-mcp
npm ci
npm test
npm run build
```

## Adding new tools

1) Implement tool schema + handler in `flux-mcp/src/index.ts`.

2) Safety rules:

- Any state-changing tool must require `confirm=true`.
- `flux_request` must continue to require `allowMutation=true` for mutations.
- Don’t bypass type safety (`as any`, `@ts-ignore`).

3) Output conventions:

- Prefer table-first output for list-like data.
- Prefer compact summaries in `structuredContent`.
- If a payload is large, store it behind `resource_link` and keep chat output small.

4) Tests:

- Add/extend vitest coverage in `flux-mcp/test/*`.
- Run: `npm test`.

## Updating endpoint inventories

The endpoint inventory is generated from the upstream Flux repo.

- Source-of-truth: `flux/ZelBack/src/routes.js`
- Generated (Codex reference): `codex/flux-cloud/references/endpoints.json`
- Bundled for MCP search: `flux-mcp/data/endpoints.json`

Regenerate:

```bash
cd codex/flux-cloud
node scripts/generate-endpoints.js --ref master --also-mcp
```

Do not edit generated files by hand:

- `dist/*.skill`
- `flux-mcp/dist/*`
- `flux-mcp/data/endpoints.json`
- `codex/flux-cloud/references/endpoints*.{json,md}`

## Writing tests

- Prefer narrow unit tests.
- Keep fixtures small.
- If a change is confirm-gated, add a test that ensures it refuses when `confirm !== true`.

## Doc style conventions

- Keep docs operational: copy/paste commands and tool calls.
- Prefer one “canonical” reference for shared topics.
- Avoid drifting duplicated docs; link instead.
