# Codex Tests

These tests validate the Codex-facing Fluxtools install path.

## Skill discovery smoke test

This simulates a fresh `~/.agents/skills/fluxtools` install in an isolated home directory and then runs `codex exec` to confirm native skill discovery can see `using-fluxtools` and that the bootstrap skill reports a CLI-first default surface.

Run:

```bash
bash tests/codex/test-skill-discovery.sh
```

## Notes

- The test reuses the current `CODEX_HOME` by default so `codex exec` can access the existing authenticated environment.
- If needed, override `CODEX_HOME` before running the test.
