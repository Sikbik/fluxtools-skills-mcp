# Troubleshooting Checklist

## Always collect these first

- Node API URL: `http://<ip>:16127`
- `GET /flux/version` and `GET /flux/info`
- App name and whether it’s composed
- App spec: `GET /apps/appspecifications/<appname>`
- Logs: `GET /apps/applog/<app-or-component>/200` (requires `zelidauth`)

## Common failures

### Daemon not synced

- Many operations require the node daemon to be synced.
- Re-check `GET /flux/info` and retry after sync.

### Not enough peers

- App register/update requires minimum peer connectivity.
- If you see outgoing/incoming peer errors, retry on a healthier node.

### Signature rejected

- Re-run the verify endpoint and sign the returned formatted spec.
- Confirm you are signing:
  - `type + version + JSON.stringify(appSpec) + timestamp`
- Ensure timestamp is fresh and local clock is synced.

### Port/domain mismatch

- For each component:
  - `ports.length === containerPorts.length === domains.length`
  - Max 5 ports
- Validate with `POST /apps/verifyappregistrationspecifications` or `POST /apps/verifyappupdatespecifications`.

### Image pull issues

- Confirm the image is allowed/available:
  - `GET /apps/whitelistedrepositories`
- If using a private registry:
  - ensure enterprise app requirements are met
  - ensure `repoauth` format matches the provider

### Stuck installing / not running

- Check:
  - `GET /apps/installinglocations`
  - `GET /apps/installingerrorslocations`
- Get logs/inspect and then:
  - redeploy the app or a component

### Arcane/enterprise confusion

- Check `GET /flux/isarcaneos`.
- Enterprise/private images require enterprise rules; verify the app is configured accordingly.
