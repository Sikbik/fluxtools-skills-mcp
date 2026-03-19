# Gemini Tool Notes

When Gemini uses Fluxtools, prefer shell execution through `flux`.

## Preferred command style

- use `flux ... --json` for machine-readable output
- keep one primary execution surface per workflow
- only fall back to MCP when the task explicitly benefits from it or the CLI is blocked

## Common command families

- auth and session: `flux auth ...`, `flux node ...`, `flux state ...`
- app deploy flows: `flux apps ...`, `flux git ...`
- runtime operations: `flux apps logs|inspect|stats|top|monitor|exec ...`
- files and backups: `flux files ...`, `flux backup ...`, `flux fluxdrive ...`
- network and services: `flux explorer ...`, `flux daemon ...`, `flux syncthing ...`
- resource reuse: `flux resource read <uri> --json`, `flux tool call <tool-name> --args-file <path> --json`
