# FluxOS CLI Release Strategy

## Current packaging decision

`fluxos-cli` is not being published as an npm package or binary release yet.

Current release strategy:

- keep the package repo-internal and versioned in source control
- build and test it independently in CI
- produce a tested tarball artifact with `npm pack`
- attach that tarball to tagged GitHub releases

Artifact name:

- `fluxos-cli.tgz`

This keeps the CLI shippable without committing to npm publishing or cross-platform binary packaging too early.

## Release notes section

When the CLI changes, add a dedicated `FluxOS CLI` section to release notes that covers:

- new commands or removed commands
- changed JSON output or exit-code behavior
- confirmation and safety changes
- new workflow composition features
- new examples or documentation
- compatibility notes relative to `flux-mcp`

Template:

```md
## FluxOS CLI

- Added:
- Changed:
- Fixed:
- Compatibility notes:
```

## Future publishing decision

The current answer for publishing is:

- no npm publishing yet
- no standalone binary distribution yet
- reassess after the CLI surface and release cadence stabilize
