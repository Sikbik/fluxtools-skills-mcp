# Example prompts (Claude Code)

These prompts are designed to trigger the `flux-cloud` skill and encourage MCP-first workflows.

## Node health

- “Check node health for `http://<ip>:16127` and tell me if it’s ArcaneOS.”
- “Summarize `/flux/info` and `/flux/version` for `http://<ip>:16127`.”

## Auth + ownership

- “Help me authenticate to `http://<ip>:16127` using ZelID. I’ll paste my signature after you give me a phrase to sign.”
- “I’m the app owner of `<appname>`. Pull logs and container stats.”

## Create a v8 spec

- “Generate a v8 Flux app spec named `my-app` using image `nginx:alpine`, expose port 31111->80, mount `/data`, and set `NODE_ENV=production`.”
- “Take this spec and canonicalize/validate it for registration, then tell me exactly what message I must sign.”

## Register / update flow

- “Plan an app registration: verify spec, calculate price, and produce the message-to-sign + payload scaffold.”
- “Here’s my signed message. Submit `appregister` and give me the hash, then show temporary/permanent message status.”

## Lifecycle operations (explicit confirmation)

- “Stop app `<appname>` now (I confirm).”
- “Redeploy component `<component>_<appname>` (I confirm).”

## Logs + inspect + exec

- “Fetch the last 200 lines of logs for `<appname>`.”
- “Inspect `<appname>` and summarize environment, ports, and mounts.”
- “Run `sh -lc 'ls -la /data'` inside `<appname>` (I confirm).”

## Files

- “List `/data` for app `<appname>` component `<component>`.”
- “Download `<path>` from `<appname>/<component>` (base64 is fine).”
