---
name: flux-network-services
description: Use for Flux explorer analytics, daemon and network inspection, node health, gateway targeting, and Syncthing health and service workflows.
---

# Flux Network And Services

Use this skill for network-level inspection and service operations.

## CLI-first workflow

Prefer:

- `flux node resolve-gateway [<gateway-base-url>] --json`
- `flux explorer status --json`
- `flux explorer height --json`
- `flux explorer balance <address> --json`
- `flux explorer restart --confirm --json`
- `flux explorer stop --confirm --json`
- `flux explorer reindex --confirm --json`
- `flux explorer rescan --block-height <n> --confirm --json`
- `flux daemon info --json`
- `flux daemon blockchain-info --json`
- `flux daemon network-info --json`
- `flux daemon peer-info --json`
- `flux daemon mempool-info --json`
- `flux daemon raw-mempool --json`
- `flux daemon block-count --json`
- `flux daemon connection-count --json`
- `flux daemon difficulty --json`
- `flux daemon call <method> --param <json-or-string> --json`
- `flux syncthing metrics --json`
- `flux syncthing metrics-health --json`
- `flux syncthing system-status --json`
- `flux syncthing list-folders --json`
- `flux syncthing list-devices --json`
- `flux syncthing db-browse <folder> --json`
- `flux syncthing db-scan <folder> --confirm --json`
- `flux syncthing restart --confirm --json`

## Guidance

- use direct nodes for consistent service state
- keep explorer and Syncthing mutations behind explicit confirmation
- prefer named daemon commands over generic daemon calls unless the endpoint is not wrapped

## When to use MCP instead

Use MCP only when:

- the CLI is blocked
- the user explicitly wants MCP
- the workflow benefits from MCP resources

Relevant MCP tools:

- `flux_node_health`
- `flux_explorer_status`
- `flux_explorer_height_info`
- `flux_explorer_balance_summary`
- `flux_explorer_restart`
- `flux_explorer_stop`
- `flux_explorer_reindex`
- `flux_explorer_rescan`
- `flux_daemon_get_info`
- `flux_daemon_get_blockchain_info`
- `flux_daemon_get_network_info`
- `flux_daemon_get_peer_info`
- `flux_daemon_get_mempool_info`
- `flux_daemon_get_raw_mempool`
- `flux_daemon_get_block_count`
- `flux_daemon_get_connection_count`
- `flux_daemon_get_difficulty`
- `flux_daemon_call`
- `flux_syncthing_metrics`
- `flux_syncthing_metrics_health`
- `flux_syncthing_system_status`
- `flux_syncthing_list_folders`
- `flux_syncthing_list_devices`
- `flux_syncthing_db_browse`
- `flux_syncthing_db_scan`
- `flux_syncthing_restart`

## References

- [api-endpoints.md](/home/stache/projects/flux-skills/codex/flux-cloud/references/api-endpoints.md)
- [daemon-api.md](/home/stache/projects/flux-skills/codex/flux-cloud/references/daemon-api.md)
- [explorer-api.md](/home/stache/projects/flux-skills/codex/flux-cloud/references/explorer-api.md)
- [syncthing-api.md](/home/stache/projects/flux-skills/codex/flux-cloud/references/syncthing-api.md)
