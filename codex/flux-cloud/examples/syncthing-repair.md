# Scenario: Syncthing repair / force rescan

## Prompt

> Syncthing looks unhealthy and my app volume isn’t syncing. Help me verify and repair it.

## Expected tool calls

1) Set base URL + authenticate

- `flux_set_base_url { baseUrl }`
- `flux_get_login_phrase` → user signs → `flux_verify_login` → `flux_set_zelidauth`

2) Health checks

- `flux_syncthing_metrics_health`
- `flux_syncthing_system_status`

3) Inspect configuration

- `flux_syncthing_list_folders`
- `flux_syncthing_list_devices`

4) Inspect DB for a folder (if folder ID is known)

- `flux_syncthing_db_browse { folder, levels: 2 }`

5) Repair actions (explicit confirmation)

- `flux_syncthing_db_scan { folder, sub?, confirm: true }`
- `flux_syncthing_restart { confirm: true }`

## Notes

- If the node is disk-constrained or has connectivity issues, repair actions may not stick.
- Use `flux_apps_troubleshoot { appname }` if symptoms show up as “stuck installing” or missing files.
