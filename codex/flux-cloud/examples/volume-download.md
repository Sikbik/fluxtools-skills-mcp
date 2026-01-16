# Scenario: Download a file/folder from an app volume

## Prompt

> I need to download `/data/config.json` from app `myapp` component `web`.

## Expected tool calls

1) Set base URL + authenticate

- `flux_set_base_url { baseUrl }`
- `flux_get_login_phrase` → user signs → `flux_verify_login` → `flux_set_zelidauth`

2) Locate the file

- `flux_apps_list_folder { appname: "myapp", component: "web", folder: "" }`
- Optionally: `flux_apps_list_folder { folder: "data" }`

3) Download

- `flux_apps_download_file { appname: "myapp", component: "web", file: "data/config.json" }`

For folders:

- `flux_apps_download_folder { appname: "myapp", component: "web", folder: "data" }`

## Notes

- `download_*` returns base64; decode locally to a file.
- For mutations (create folder, rename, remove), MCP tools require `confirm=true`.
