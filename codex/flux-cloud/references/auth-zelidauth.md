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

- `POST /id/verifylogin` — returns session + privilege level (e.g. `admin`, `fluxteam`, `user`) directly in the response data as `privilage` (note: FluxOS spelling).
- `POST /id/checkprivilege` — returns privilege as `{status: "success", data: {message: "<level>"}}`.

Important: these POST endpoints are typically expected as `application/x-www-form-urlencoded` with fields `zelid`, `signature`, and `loginPhrase`.

When using `flux_auth_login`, the privilege is automatically extracted from the `verifylogin` response — no separate `checkprivilege` call needed.

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
