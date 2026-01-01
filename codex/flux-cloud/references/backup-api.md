# `/backup/*` — Backup Helpers

Backup routes support inspecting and downloading backup-related artifacts.

See the full list in `references/endpoints-inventory.md` (category: `backup`).

Common routes include:

- `GET /backup/getvolumedataofcomponent/<appname?>/<component?>/...`
- `GET /backup/getlocalbackuplist/<path?>/...`
- `GET /backup/downloadlocalfile/<filepath?>/<appname?>`
- `GET /backup/removebackupfile/<filepath?>/<appname?>`
