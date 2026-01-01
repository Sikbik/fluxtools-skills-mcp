# Lifecycle + Observability

Source of truth:

- Routes: [`ZelBack/src/routes.js`](https://github.com/RunOnFlux/flux/blob/master/ZelBack/src/routes.js)
- Lifecycle logic: [`ZelBack/src/services/appManagement/appController.js`](https://github.com/RunOnFlux/flux/blob/master/ZelBack/src/services/appManagement/appController.js)
- Inspect/logs/exec: [`ZelBack/src/services/appManagement/appInspector.js`](https://github.com/RunOnFlux/flux/blob/master/ZelBack/src/services/appManagement/appInspector.js)

## App name vs component name

- Single-component apps typically use `<appname>`.
- Composed apps use containers named `<component>_<appname>`.

Most endpoints accept either:

- `<appname>` (operate on app)
- `<component>_<appname>` (target a single container)

## Lifecycle endpoints (require `zelidauth`)

```bash
API="http://<ip>:16127"
ZELIDAUTH='{"zelid":"<ZELID>","signature":"<SIG>","loginPhrase":"<PHRASE>"}'

curl -sS -H "zelidauth: $ZELIDAUTH" "$API/apps/appstart/<appname>"
curl -sS -H "zelidauth: $ZELIDAUTH" "$API/apps/appstop/<appname>"
curl -sS -H "zelidauth: $ZELIDAUTH" "$API/apps/apprestart/<appname>"
curl -sS -H "zelidauth: $ZELIDAUTH" "$API/apps/apppause/<appname>"
curl -sS -H "zelidauth: $ZELIDAUTH" "$API/apps/appunpause/<appname>"
```

Redeploy:

- Whole app: `GET /apps/redeploy/<appname>`
- Single component: `GET /apps/redeploycomponent/<appname>/<component>`
  - Note: `appname` must be the app name (no underscore); component is separate.

## Logs and inspection (require `zelidauth`)

```bash
curl -sS -H "zelidauth: $ZELIDAUTH" "$API/apps/applog/<app-or-component>/200"
curl -sS -H "zelidauth: $ZELIDAUTH" "$API/apps/appinspect/<app-or-component>"
curl -sS -H "zelidauth: $ZELIDAUTH" "$API/apps/appstats/<app-or-component>"
curl -sS -H "zelidauth: $ZELIDAUTH" "$API/apps/apptop/<app-or-component>"
```

## Exec (require `zelidauth`)

`POST /apps/appexec` accepts:

- `appname`: container identifier or `<component>_<appname>`
- `cmd`: array of strings
- `env`: array of strings

Example:

```bash
curl -sS -X POST "$API/apps/appexec" \
  -H 'Content-Type: application/json' \
  -H "zelidauth: $ZELIDAUTH" \
  -d '{"appname":"<component>_<appname>","cmd":["/bin/sh","-lc","id; env | sort"],"env":[]}'
```
