# Storage, Mounts, and App Files

Source of truth:

- Multiple mounts guide: [`docs/multiple-mounts-guide.md`](https://github.com/RunOnFlux/flux/blob/master/docs/multiple-mounts-guide.md)
- API reference: [`docs/multiple-mounts-api-reference.md`](https://github.com/RunOnFlux/flux/blob/master/docs/multiple-mounts-api-reference.md)

## containerData quick patterns

- Persistent primary mount: `"/data"`
- Replicated primary mount (when supported/needed): `"r:/data"`
- No persistence: `"/tmp"`
- Extra directory mount: `"/data|m:logs:/var/log"`
- File mount: `"/data|f:config.json:/app/config.json"`

## Host layout (mental model)

Flux stores app data under a per-app directory with an `appdata/` folder for the primary mount. Additional mounts are created at the same level as `appdata/`.

## Volume browser API (app owner)

Tip: prefer query parameters for paths (URL encoding is easier):

```bash
API="http://<ip>:16127"
ZELIDAUTH='{"zelid":"<ZELID>","signature":"<SIG>","loginPhrase":"<PHRASE>"}'

curl -sS -H "zelidauth: $ZELIDAUTH" \
  "$API/apps/getfolderinfo?appname=<appname>&component=<component>&folder=appdata"
```
