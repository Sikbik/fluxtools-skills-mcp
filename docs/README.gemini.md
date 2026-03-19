# Fluxtools For Gemini

Gemini support in this repo is packaged as a Gemini extension bundle.

## Install

```bash
npm i -g fluxtools
fluxtools install gemini
fluxtools doctor gemini
```

## What this does

- installs an extension bundle in `~/.gemini/extensions/fluxtools`
- ships `GEMINI.md` as the extension context file
- ships the shared Fluxtools skills under the extension directory
- bundles `flux-mcp/dist/index.js` and declares it in `gemini-extension.json` as an extension-provided MCP server

## Why this shape matches Gemini

Gemini CLI extensions are directory-based and use `gemini-extension.json` as the manifest.
That manifest can define both a context file and extension-provided MCP servers, so Fluxtools bundles both.

The installed manifest points Gemini at:

- `GEMINI.md` for bootstrap context
- `${extensionPath}/flux-mcp/dist/index.js` for MCP fallback

## Verify

```bash
ls ~/.gemini/extensions/fluxtools
cat ~/.gemini/extensions/fluxtools/gemini-extension.json
fluxtools doctor gemini
```
