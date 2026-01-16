# Release checklist (tag-based)

This repo publishes releases from Git tags matching `v*`.

## Pre-flight

- Working tree clean
- `npm test && npm run build` passes in `flux-mcp/`
- Skill packaging works locally:
  - `python3 scripts/package_skill.py codex/flux-cloud dist --out-name flux-cloud-codex`
  - `python3 scripts/package_skill.py claude/flux-cloud dist --out-name flux-cloud-claude`

## Create release

1) Pick a version

- Use semver-style tags: `vX.Y.Z`
- Breaking tool changes → bump major.

2) Tag and push

```bash
git tag -a vX.Y.Z -m "vX.Y.Z"
git push origin vX.Y.Z
```

3) Verify GitHub Actions

- Workflow: `.github/workflows/release.yml`
- Expected outputs:
  - GitHub Release created for the tag
  - Assets attached:
    - `flux-cloud-codex.skill`
    - `flux-cloud-claude.skill`

## Post-release

- Spot-check the release notes for correctness
- Install the `.skill` artifacts in a clean environment and verify:
  - MCP connects
  - `flux_get_state` works
  - one end-to-end workflow (auth → list apps) works
