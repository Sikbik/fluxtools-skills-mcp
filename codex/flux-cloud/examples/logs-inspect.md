# Scenario: Logs + inspect a misbehaving app

## Prompt

> My app `myapp` is restarting and I need logs + runtime details.

## Expected tool calls

1) Set base URL + authenticate

- `flux_set_base_url { baseUrl }`
- `flux_auth_login { zelid }` → user signs → privilege returned automatically

2) Quick health summary

- `flux_app_health_report { appname: "myapp" }`

3) Logs (default)

- `flux_logs_tail { appname: "myapp", lines: 200 }`

4) Direct container details

- `flux_apps_inspect { appname: "myapp" }`
- `flux_apps_stats { appname: "myapp" }`
- `flux_apps_top { appname: "myapp" }`

5) Search FluxOS node logs (requires node owner or Flux team auth)

- `flux_fluxos_log_search { pattern: "myapp", logLevel: "debug" }`

6) Wider troubleshooting (optional)

- `flux_apps_troubleshoot { appname: "myapp", deep: false }`

## Notes

- Prefer tools that return `resource_link` and only open the payload if needed.
- `flux_apps_logs`, `flux_logs_tail`, and `flux_apps_inspect` work on stopped containers — no need for the app to be running.
- `flux_fluxos_log_search` fetches the full FluxOS log file and filters client-side. Use `tailOnly: true` for quick searches of the last 100 lines.
