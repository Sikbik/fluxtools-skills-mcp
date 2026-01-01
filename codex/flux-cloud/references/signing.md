# App Register/Update Signing

Do not confuse:

- `zelidauth`: authenticates the API call
- app message signature: proves the app owner authorized the registration/update

Source of truth:

- Signature verification: [`ZelBack/src/services/appMessaging/messageVerifier.js`](https://github.com/RunOnFlux/flux/blob/master/ZelBack/src/services/appMessaging/messageVerifier.js)

## Contents

- [Message to sign](#message-to-sign)
- [Canonicalize first](#canonicalize-first)
- [Use the helper script](#use-the-helper-script)
- [Submit register/update](#submit-registerupdate)
- [Confirm](#confirm)
- [Timestamp windows](#timestamp-windows)

## Message to sign

The backend verifies the signature over this exact string:

```
type + version + JSON.stringify(appSpec) + timestamp
```

- `type`: `fluxappregister` | `fluxappupdate` (also accepts `zel...` variants)
- `version`: `1` (message type version, not spec version)
- `timestamp`: milliseconds since epoch

## Canonicalize first

`JSON.stringify(appSpec)` is part of the signed string. If JSON key order differs, the signature will not verify.

Always canonicalize the spec server-side and use the returned formatted spec:

- Registration: `POST /apps/verifyappregistrationspecifications`
- Update: `POST /apps/verifyappupdatespecifications`

## Use the helper script

From the skill root (`flux-cloud/` when installed; in this repo: `codex/flux-cloud/`):

1) Save verifier output:

```bash
API="http://<ip>:16127"

curl -sS -X POST "$API/apps/verifyappregistrationspecifications" \
  -H 'Content-Type: application/json' \
  -d @app-spec.json > verify.json
```

2) Generate message-to-sign + payload scaffold:

```bash
node scripts/build-app-message.js \
  --type fluxappregister \
  --from-verify verify.json \
  --payload-out appregister.json \
  > message-to-sign.txt
```

- `message-to-sign.txt` contains the exact bytes to sign (no trailing newline).
- `appregister.json` contains a `signature` placeholder.

Repeat for update by swapping the type:

```bash
node scripts/build-app-message.js \
  --type fluxappupdate \
  --from-verify verify.json \
  --payload-out appupdate.json \
  > message-to-sign.txt
```

## Submit register/update

Both calls require `zelidauth`.

```bash
ZELIDAUTH='{"zelid":"<ZELID>","signature":"<SIG>","loginPhrase":"<PHRASE>"}'

curl -sS -X POST "$API/apps/appregister" \
  -H 'Content-Type: application/json' \
  -H "zelidauth: $ZELIDAUTH" \
  -d @appregister.json

curl -sS -X POST "$API/apps/appupdate" \
  -H 'Content-Type: application/json' \
  -H "zelidauth: $ZELIDAUTH" \
  -d @appupdate.json
```

## Confirm

```bash
curl -sS "$API/apps/temporarymessages/<hash>"
curl -sS "$API/apps/permanentmessages/<hash>"
```

## Timestamp windows

The API enforces message freshness:

- too old: more than ~1 hour
- too far in the future: more than ~5 minutes

If you see signature/timestamp errors, sync system time and rebuild the payload with a new timestamp.
