#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
ORIGINAL_HOME="${HOME}"
REAL_CODEX_HOME="${CODEX_HOME:-${ORIGINAL_HOME}/.codex}"

if ! command -v codex >/dev/null 2>&1; then
  echo "codex command not found" >&2
  exit 1
fi

TEST_HOME="$(mktemp -d /tmp/fluxtools-codex-home-XXXXXX)"
OUTPUT_FILE="$(mktemp /tmp/fluxtools-codex-output-XXXXXX.jsonl)"
STDERR_FILE="$(mktemp /tmp/fluxtools-codex-stderr-XXXXXX.log)"
cleanup() {
  rm -rf "${TEST_HOME}"
  rm -f "${OUTPUT_FILE}"
  rm -f "${STDERR_FILE}"
}
trap cleanup EXIT

mkdir -p "${TEST_HOME}/.agents/skills"
ln -s "${REPO_ROOT}/skills" "${TEST_HOME}/.agents/skills/fluxtools"

PROMPT="Without reading files from the current workspace, tell me whether you have a skill named using-fluxtools available through native skill discovery. If yes, reply with JSON having keys available, skill_name, and default_surface. Reply with JSON only."

if ! env HOME="${TEST_HOME}" CODEX_HOME="${REAL_CODEX_HOME}" \
  codex exec \
    --ephemeral \
    --skip-git-repo-check \
    -C /tmp \
    --json \
    "${PROMPT}" > "${OUTPUT_FILE}" 2> "${STDERR_FILE}"; then
  cat "${STDERR_FILE}" >&2
  exit 1
fi

node - "${OUTPUT_FILE}" <<'EOF'
const fs = require('node:fs');

const path = process.argv[2];
const lines = fs.readFileSync(path, 'utf8').trim().split('\n').filter(Boolean);
let payload = null;

for (const line of lines) {
  if (!line.startsWith('{')) continue;
  try {
    const event = JSON.parse(line);
    if (event.type === 'item.completed' && event.item?.type === 'agent_message' && event.item?.text) {
      payload = JSON.parse(event.item.text);
    }
  } catch {
    // ignore non-JSON or non-payload lines
  }
}

if (!payload) {
  console.error('No agent JSON payload found in codex exec output');
  process.exit(1);
}

const normalizedSurface = typeof payload.default_surface === 'string'
  ? payload.default_surface.toLowerCase()
  : payload.default_surface;

if (payload.available !== true || payload.skill_name !== 'using-fluxtools' || normalizedSurface !== 'cli') {
  console.error(`Unexpected discovery payload: ${JSON.stringify(payload)}`);
  process.exit(1);
}

console.log(`codex skill discovery ok: ${JSON.stringify(payload)}`);
EOF
