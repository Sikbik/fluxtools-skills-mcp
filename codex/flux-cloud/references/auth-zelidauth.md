# ZelID Authentication (`zelidauth`)

FluxOS node APIs use a request header named `zelidauth` to authenticate user/owner/admin actions.

## The flow

1) Request a login phrase:

```bash
curl -sS http://<node-ip>:16127/id/loginphrase
```

If `/id/loginphrase` fails due to node health/DOS checks, use the emergency phrase endpoint:

```bash
curl -sS http://<node-ip>:16127/id/emergencyphrase
```

2) Sign the returned phrase with the **owner ZelID** (wallet-side action).

3) Send requests with the `zelidauth` header:

```text
zelidauth: {"zelid":"<ZELID>","signature":"<SIG>","loginPhrase":"<PHRASE>"}
```

Tip: Most docs show querystring-style `zelidauth` (e.g. `zelid=<ZELID>&signature=<SIG>&loginPhrase=<PHRASE>`), but the backend also accepts a JSON header value (shown above).

## Validate a login / inspect privilege

These endpoints are useful for debugging auth:

- `POST /id/verifylogin` (returns session + privilege details)
- `POST /id/checkprivilege` (returns whether the provided auth is acceptable)

Important: these POST endpoints are typically expected as `application/x-www-form-urlencoded` with fields `zelid`, `signature`, and `loginPhrase`.

Deprecated equivalents exist under `/zelid/*`.

## Practical notes

- Login phrases embed a millisecond timestamp as the first 13 characters.
- Treat phrases as short-lived. If you get “Signed message is no longer valid”, request a new phrase and re-sign.
- Different endpoints may require different privilege levels (user, app owner, FluxTeam/admin). Use `references/endpoints-inventory.md` for section labels.

## Helper script

Build a `zelidauth` header value locally:

```bash
node scripts/build-zelidauth.js --zelid <ZELID> --signature <SIG> --login-phrase <PHRASE>
```
