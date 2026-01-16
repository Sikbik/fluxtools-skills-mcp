# Scenario: Logs + inspect a misbehaving app

## Prompt

> My app `myapp` is restarting and I need logs + runtime details.

## Expected tool calls

1) Set base URL + authenticate

- `flux_set_base_url { baseUrl }`
- `flux_get_login_phrase` → user signs → `flux_verify_login` → `flux_set_zelidauth`

2) Quick health summary

- `flux_app_health_report { appname: "myapp" }`

3) Logs (default)

- `flux_logs_tail { appname: "myapp", lines: 200 }`

4) Direct container details

- `flux_apps_inspect { appname: "myapp" }`
- `flux_apps_stats { appname: "myapp" }`
- `flux_apps_top { appname: "myapp" }`

5) Wider troubleshooting (optional)

- `flux_apps_troubleshoot { appname: "myapp", deep: false }`

## Notes

- Prefer tools that return `resource_link` and only open the payload if needed.
