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

fluxtools install claude --json >"$tmpdir/install.json"
fluxtools doctor claude --json >"$tmpdir/doctor.json"

test -f "$HOME/.claude/skills/fluxtools/using-fluxtools/SKILL.md"

node -e '
  const fs = require("node:fs");
  const install = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
  const doctor = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));

  if (!install.ok) throw new Error("install report not ok");
  if (!install.cli?.ok) throw new Error("flux CLI not available after install");
  if (!install.client?.ok) throw new Error("claude CLI not detected during install");
  if (!install.pluginBundle?.ok) throw new Error("plugin bundle validation failed during install");
  if (!install.skills?.ok) throw new Error("skills were not installed");
  if (!install.mcp?.ok) throw new Error("MCP was not installed");
  if (!doctor.ok) throw new Error("doctor report not ok");
  if (!doctor.pluginBundle?.ok) throw new Error("doctor did not validate the plugin bundle");
  if (!doctor.skills?.ok) throw new Error("doctor did not find skills");
  if (!doctor.mcp?.ok) throw new Error("doctor did not find MCP");
  if (!doctor.cli?.ok) throw new Error("doctor did not find flux CLI");
' "$tmpdir/install.json" "$tmpdir/doctor.json"

claude mcp get flux >"$tmpdir/mcp.txt"

grep -q "Command: node" "$tmpdir/mcp.txt"
grep -q "/flux-mcp/dist/index.js" "$tmpdir/mcp.txt"
grep -q "FLUX_API_BASE_URL=https://api.runonflux.io" "$tmpdir/mcp.txt"

echo "fluxtools claude package install ok"
