---
name: flux-storage-backups
description: Use for Flux app volume browsing, file download and mutation, backup inspection, local backup management, and FluxDrive backup workflows.
---

# Flux Storage And Backups

Use this skill for app data and backup workflows.

## CLI-first workflow

Prefer:

- `flux files list --appname <name> --component <name> --json`
- `flux files download --appname <name> --component <name> --file <path> --json`
- `flux files download-folder --appname <name> --component <name> --folder <path> --confirm --json`
- `flux files mkdir --appname <name> --component <name> --folder <path> --confirm --json`
- `flux files rename --appname <name> --component <name> --oldpath <path> --newname <name> --confirm --json`
- `flux files remove --appname <name> --component <name> --object <path> --confirm --json`
- `flux backup volume-data --appname <name> --component <name> --json`
- `flux backup remote-size --fileurl <url> --appname <name> --json`
- `flux backup list-local --path <path> --appname <name> --json`
- `flux backup remove-file --filepath <path> --appname <name> --confirm --json`
- `flux backup download-local --filepath <path> --appname <name> --confirm --json`
- `flux fluxdrive set-base-url <url> --json`
- `flux fluxdrive register-backup-file ... --json`
- `flux fluxdrive task-status <task-id> --json`
- `flux fluxdrive backup-list <appname> --json`
- `flux fluxdrive remove-checkpoint --appname <name> --timestamp <ms> --json`

## Guidance

- prefer resource-backed downloads over dumping large file payloads to chat
- confirm before file mutations or backup deletion
- keep app/component names explicit; component means compose component, not arbitrary container text

## When to use MCP instead

Use MCP only when:

- the CLI is blocked
- the user explicitly wants MCP
- the returned `resource_link` flow is more useful than the CLI resource artifact

Relevant MCP tools:

- `flux_apps_list_folder`
- `flux_apps_download_file`
- `flux_apps_download_folder`
- `flux_apps_create_folder`
- `flux_apps_rename_object`
- `flux_apps_remove_object`
- `flux_backup_get_volume_data`
- `flux_backup_get_remote_file_size`
- `flux_backup_list_local`
- `flux_backup_remove_file`
- `flux_backup_download_local_file`
- `flux_fluxdrive_set_base_url`
- `flux_fluxdrive_register_backup_file`
- `flux_fluxdrive_get_task_status`
- `flux_fluxdrive_get_backup_list`
- `flux_fluxdrive_remove_checkpoint`

## References

- [storage-mounts.md](/home/stache/projects/flux-skills/codex/flux-cloud/references/storage-mounts.md)
- [backup-api.md](/home/stache/projects/flux-skills/codex/flux-cloud/references/backup-api.md)
