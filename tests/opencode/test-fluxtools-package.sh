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

fluxtools install opencode --json >"$tmpdir/install.json"
fluxtools doctor opencode --json >"$tmpdir/doctor.json"

test -f "$HOME/.config/opencode/plugins/fluxtools.js"
test -f "$HOME/.config/opencode/skills/fluxtools/using-fluxtools/SKILL.md"
test -f "$HOME/.config/opencode/opencode.json"

node -e '
  const fs = require("node:fs");
  const install = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
  const doctor = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));

  if (!install.ok) throw new Error("install report not ok");
  if (!install.cli?.ok) throw new Error("flux CLI not available after install");
  if (!install.plugin?.ok) throw new Error("OpenCode plugin was not installed");
  if (!install.skills?.ok) throw new Error("OpenCode skills were not installed");
  if (!install.mcp?.ok) throw new Error("OpenCode MCP config was not installed");
  if (!doctor.ok) throw new Error("doctor report not ok");
  if (!doctor.plugin?.ok) throw new Error("doctor did not find the OpenCode plugin");
  if (!doctor.skills?.ok) throw new Error("doctor did not find the OpenCode skills");
  if (!doctor.mcp?.ok) throw new Error("doctor did not find the OpenCode MCP config");
' "$tmpdir/install.json" "$tmpdir/doctor.json"

node -e '
  const fs = require("node:fs");
  const config = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
  const server = config?.mcp?.flux;
  if (!server) throw new Error("missing OpenCode MCP server");
  if (server.type !== "local") throw new Error("unexpected OpenCode MCP server type");
  if (!Array.isArray(server.command) || server.command.length !== 2) throw new Error("unexpected OpenCode MCP command");
  if (server.command[0] !== "node") throw new Error("unexpected OpenCode MCP launcher");
  if (!String(server.command[1]).endsWith("/flux-mcp/dist/index.js")) throw new Error("unexpected OpenCode MCP entry");
  if (!server.environment || server.environment.FLUX_API_BASE_URL !== "https://api.runonflux.io") {
    throw new Error("unexpected OpenCode MCP environment");
  }
' "$HOME/.config/opencode/opencode.json"

node -e '
  import(process.argv[1]).then(async (mod) => {
    if (!mod || typeof mod.FluxtoolsPlugin !== "function") throw new Error("missing FluxtoolsPlugin export");
    const plugin = await mod.FluxtoolsPlugin();
    if (!plugin || typeof plugin["experimental.chat.system.transform"] !== "function") {
      throw new Error("plugin hook export missing");
    }
  });
' "file://$HOME/.config/opencode/plugins/fluxtools.js"

echo "fluxtools opencode package install ok"
