#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
tmpdir="$(mktemp -d)"
prefix="$tmpdir/prefix"
home_dir="$tmpdir/home"

cleanup() {
  rm -rf "$tmpdir"
}
trap cleanup EXIT

mkdir -p "$prefix" "$home_dir"

tarball_name="$(cd "$repo_root" && npm pack --pack-destination "$tmpdir" | awk 'NF { line = $0 } END { print line }')"
tarball_path="$tmpdir/$tarball_name"

npm install -g --prefix "$prefix" "$tarball_path" >/dev/null

export HOME="$home_dir"
export PATH="$prefix/bin:$PATH"

fluxtools install gemini --json >"$tmpdir/install.json"
fluxtools doctor gemini --json >"$tmpdir/doctor.json"

test -f "$HOME/.gemini/extensions/fluxtools/gemini-extension.json"
test -f "$HOME/.gemini/extensions/fluxtools/GEMINI.md"
test -f "$HOME/.gemini/extensions/fluxtools/skills/using-fluxtools/SKILL.md"
test -f "$HOME/.gemini/extensions/fluxtools/flux-mcp/dist/index.js"

node -e '
  const fs = require("node:fs");
  const install = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
  const doctor = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));

  if (!install.ok) throw new Error("install report not ok");
  if (!install.cli?.ok) throw new Error("flux CLI not available after install");
  if (!install.extension?.ok) throw new Error("Gemini extension bundle was not installed");
  if (!doctor.ok) throw new Error("doctor report not ok");
  if (!doctor.extension?.ok) throw new Error("doctor did not find the Gemini extension bundle");
' "$tmpdir/install.json" "$tmpdir/doctor.json"

node -e '
  const fs = require("node:fs");
  const manifest = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
  if (manifest.name !== "fluxtools") throw new Error("unexpected extension name");
  if (manifest.contextFileName !== "GEMINI.md") throw new Error("unexpected context file name");
  const server = manifest?.mcpServers?.flux;
  if (!server) throw new Error("missing bundled Gemini MCP server");
  if (server.command !== "node") throw new Error("unexpected Gemini MCP command");
  if (!Array.isArray(server.args) || server.args[0] !== "${extensionPath}/flux-mcp/dist/index.js") {
    throw new Error("unexpected Gemini MCP args");
  }
  if (server.cwd !== "${extensionPath}") throw new Error("unexpected Gemini MCP cwd");
  if (!server.env || server.env.FLUX_API_BASE_URL !== "https://api.runonflux.io") {
    throw new Error("unexpected Gemini MCP environment");
  }
' "$HOME/.gemini/extensions/fluxtools/gemini-extension.json"

echo "fluxtools gemini package install ok"
