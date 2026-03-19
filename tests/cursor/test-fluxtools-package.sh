#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
tmpdir="$(mktemp -d)"
prefix="$tmpdir/prefix"
home_dir="$tmpdir/home"
project_dir="$tmpdir/project"

cleanup() {
  rm -rf "$tmpdir"
}
trap cleanup EXIT

mkdir -p "$prefix" "$home_dir" "$project_dir"

tarball_name="$(cd "$repo_root" && npm pack --pack-destination "$tmpdir" | awk 'NF { line = $0 } END { print line }')"
tarball_path="$tmpdir/$tarball_name"

npm install -g --prefix "$prefix" "$tarball_path" >/dev/null

export HOME="$home_dir"
export PATH="$prefix/bin:$PATH"

fluxtools install cursor --project-dir "$project_dir" --json >"$tmpdir/install.json"
fluxtools doctor cursor --project-dir "$project_dir" --json >"$tmpdir/doctor.json"

test -f "$HOME/.cursor/mcp.json"
test -f "$project_dir/.cursor/rules/fluxtools.mdc"
test -f "$project_dir/.cursor/commands/fluxtools-doctor.md"

node -e '
  const fs = require("node:fs");
  const install = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
  const doctor = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));

  if (!install.ok) throw new Error("install report not ok");
  if (!install.cli?.ok) throw new Error("flux CLI not available after install");
  if (!install.rules?.ok) throw new Error("Cursor rules were not installed");
  if (!install.commands?.ok) throw new Error("Cursor commands were not installed");
  if (!install.mcp?.ok) throw new Error("Cursor MCP config was not installed");
  if (!doctor.ok) throw new Error("doctor report not ok");
  if (!doctor.rules?.ok) throw new Error("doctor did not find Cursor rules");
  if (!doctor.commands?.ok) throw new Error("doctor did not find Cursor commands");
  if (!doctor.mcp?.ok) throw new Error("doctor did not find Cursor MCP config");
' "$tmpdir/install.json" "$tmpdir/doctor.json"

node -e '
  const fs = require("node:fs");
  const data = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
  const server = data?.mcpServers?.flux;
  if (!server) throw new Error("missing flux server in Cursor MCP config");
  if (server.command !== "node") throw new Error(`unexpected Cursor MCP command: ${server.command}`);
  if (!Array.isArray(server.args) || !String(server.args[0]).endsWith("/flux-mcp/dist/index.js")) {
    throw new Error(`unexpected Cursor MCP args: ${JSON.stringify(server.args)}`);
  }
  if (server?.env?.FLUX_API_BASE_URL !== "https://api.runonflux.io") {
    throw new Error(`unexpected Cursor MCP base URL: ${server?.env?.FLUX_API_BASE_URL}`);
  }
' "$HOME/.cursor/mcp.json"

grep -q "alwaysApply: true" "$project_dir/.cursor/rules/fluxtools.mdc"
grep -q 'Default to the `flux` CLI.' "$project_dir/.cursor/rules/fluxtools.mdc"
grep -q "fluxtools doctor cursor" "$project_dir/.cursor/commands/fluxtools-doctor.md"

echo "fluxtools cursor package install ok"
