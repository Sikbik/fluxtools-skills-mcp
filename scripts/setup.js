#!/usr/bin/env node
'use strict';

// One-command setup for this repo:
// - Build flux-mcp (if needed)
// - Install Codex + Claude skills (project- or user-scoped)
// - Print ready-to-paste MCP client config snippets

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

function die(msg) {
  process.stderr.write(`${msg}\n`);
  process.exit(1);
}

function exists(p) {
  try {
    fs.accessSync(p);
    return true;
  } catch {
    return false;
  }
}

function run(cmd, args, opts) {
  const res = spawnSync(cmd, args, { stdio: 'inherit', ...opts });
  if (res.error) throw res.error;
  if (typeof res.status === 'number' && res.status !== 0) {
    throw new Error(`Command failed (${res.status}): ${cmd} ${args.join(' ')}`);
  }
}

function parseArgValue(arg, next) {
  const eq = arg.indexOf('=');
  if (eq !== -1) return arg.slice(eq + 1);
  if (!next) return null;
  return next;
}

function quoteForShell(s) {
  // Simple POSIX-ish quoting for copy/paste snippets.
  return `"${String(s).replaceAll('"', '\\"')}"`;
}

function printHelp() {
  const text = `
Usage:
  node scripts/setup.js [options]

What it does:
  - Builds flux-mcp (auto, if dist missing)
  - Installs Codex + Claude skills (default: project-scoped)
  - Prints ready-to-paste MCP client config snippets

Options:
  --build-mcp            Force rebuild flux-mcp (npm ci + npm run build)
  --no-build-mcp         Do not build flux-mcp (fails if dist is missing)

  --scope <project|user|none>
                         Install BOTH Codex + Claude skills to:
                         project: ./.codex/skills + ./.claude/skills (default)
                         user:    ~/.codex/skills + ~/.claude/skills
                         none:    skip skills install
  --codex-scope <project|user|none>
  --claude-scope <project|user|none>
                         Override per-skill scope (wins over --scope)

  --base-url <url>       Printed FLUX_API_BASE_URL value (default: https://api.runonflux.io)
  --server-name <name>   MCP server name to print (default: flux)
  --no-print             Do not print MCP config snippets
`;
  process.stdout.write(text.trimStart());
}

function validateScope(value, flag) {
  const v = String(value || '').trim().toLowerCase();
  if (v === 'project' || v === 'user' || v === 'none') return v;
  throw new Error(`${flag} must be one of: project | user | none`);
}

function copyDir(src, dest) {
  if (!exists(src)) throw new Error(`Missing source dir: ${src}`);
  fs.rmSync(dest, { recursive: true, force: true });
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.cpSync(src, dest, { recursive: true });
}

function computeSkillDest(scope, repoRoot, kind) {
  if (scope === 'none') return null;

  const name = 'flux-cloud';
  if (scope === 'project') {
    return path.join(repoRoot, kind === 'codex' ? '.codex' : '.claude', 'skills', name);
  }

  // user
  if (kind === 'codex') {
    const codexHome = process.env.CODEX_HOME && String(process.env.CODEX_HOME).trim() ? String(process.env.CODEX_HOME).trim() : path.join(os.homedir(), '.codex');
    return path.join(codexHome, 'skills', name);
  }

  return path.join(os.homedir(), '.claude', 'skills', name);
}

function main() {
  const repoRoot = path.resolve(__dirname, '..');
  const fluxMcpDir = path.join(repoRoot, 'flux-mcp');
  const fluxMcpDist = path.join(fluxMcpDir, 'dist', 'index.js');

  const codexSkillSrc = path.join(repoRoot, 'codex', 'flux-cloud');
  const claudeSkillSrc = path.join(repoRoot, 'claude', 'flux-cloud');

  const opts = {
    buildMcp: 'auto', // auto | always | never
    baseUrl: 'https://api.runonflux.io',
    serverName: 'flux',
    print: true,
    scope: 'project',
    codexScope: null,
    claudeScope: null,
  };

  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];

    if (a === '--help' || a === '-h') {
      printHelp();
      return;
    }

    if (a === '--build-mcp') {
      opts.buildMcp = 'always';
      continue;
    }
    if (a === '--no-build-mcp') {
      opts.buildMcp = 'never';
      continue;
    }

    if (a === '--no-print') {
      opts.print = false;
      continue;
    }

    if (a.startsWith('--base-url')) {
      const v = parseArgValue(a, argv[i + 1]);
      if (v === null) die('--base-url requires a value');
      if (!a.includes('=')) i++;
      opts.baseUrl = String(v).trim();
      continue;
    }

    if (a.startsWith('--server-name')) {
      const v = parseArgValue(a, argv[i + 1]);
      if (v === null) die('--server-name requires a value');
      if (!a.includes('=')) i++;
      opts.serverName = String(v).trim();
      continue;
    }

    if (a.startsWith('--scope')) {
      const v = parseArgValue(a, argv[i + 1]);
      if (v === null) die('--scope requires a value');
      if (!a.includes('=')) i++;
      opts.scope = validateScope(v, '--scope');
      continue;
    }

    if (a.startsWith('--codex-scope')) {
      const v = parseArgValue(a, argv[i + 1]);
      if (v === null) die('--codex-scope requires a value');
      if (!a.includes('=')) i++;
      opts.codexScope = validateScope(v, '--codex-scope');
      continue;
    }

    if (a.startsWith('--claude-scope')) {
      const v = parseArgValue(a, argv[i + 1]);
      if (v === null) die('--claude-scope requires a value');
      if (!a.includes('=')) i++;
      opts.claudeScope = validateScope(v, '--claude-scope');
      continue;
    }

    die(`Unknown option: ${a}\nRun: node scripts/setup.js --help`);
  }

  if (!opts.baseUrl || !/^https?:\/\//i.test(opts.baseUrl)) {
    die(`Invalid --base-url: ${opts.baseUrl} (must start with http:// or https://)`);
  }

  // 1) Build MCP if needed.
  const distPresent = exists(fluxMcpDist);
  if (opts.buildMcp === 'never' && !distPresent) {
    die(`Missing ${fluxMcpDist}\nRun: node scripts/setup.js --build-mcp`);
  }

  if (opts.buildMcp === 'always' || (opts.buildMcp === 'auto' && !distPresent)) {
    process.stdout.write(`\nBuilding flux-mcp...\n`);
    if (!exists(path.join(fluxMcpDir, 'package.json'))) die(`Missing: ${path.join(fluxMcpDir, 'package.json')}`);
    run('npm', ['ci'], { cwd: fluxMcpDir });
    run('npm', ['run', 'build'], { cwd: fluxMcpDir });
  }

  if (!exists(fluxMcpDist)) die(`Build did not produce: ${fluxMcpDist}`);

  // 2) Install skills.
  const codexScope = opts.codexScope ?? opts.scope;
  const claudeScope = opts.claudeScope ?? opts.scope;

  const codexDest = computeSkillDest(codexScope, repoRoot, 'codex');
  const claudeDest = computeSkillDest(claudeScope, repoRoot, 'claude');

  if (codexDest) {
    process.stdout.write(`\nInstalling Codex skill (${codexScope} scope)...\n`);
    copyDir(codexSkillSrc, codexDest);
    process.stdout.write(`- Installed: ${codexDest}\n`);
  } else {
    process.stdout.write(`\nSkipping Codex skill install (--codex-scope=none)\n`);
  }

  if (claudeDest) {
    process.stdout.write(`\nInstalling Claude skill (${claudeScope} scope)...\n`);
    copyDir(claudeSkillSrc, claudeDest);
    process.stdout.write(`- Installed: ${claudeDest}\n`);
  } else {
    process.stdout.write(`\nSkipping Claude skill install (--claude-scope=none)\n`);
  }

  // 3) Print MCP config snippets.
  if (!opts.print) return;

  const entry = fluxMcpDist;
  const envBase = `FLUX_API_BASE_URL=${opts.baseUrl}`;

  process.stdout.write(`\nMCP entrypoint:\n- ${entry}\n`);

  process.stdout.write(`\nClaude Code (CLI):\n`);
  process.stdout.write(
    `claude mcp add --transport stdio --env ${envBase} ${opts.serverName} -- node ${quoteForShell(entry)}\n`
  );

  process.stdout.write(`\nCodex (CLI):\n`);
  process.stdout.write(
    `codex mcp add ${opts.serverName} --env ${envBase} -- node ${quoteForShell(entry)}\n`
  );

  process.stdout.write(`\nGemini CLI:\n`);
  process.stdout.write(
    `gemini mcp add -s user -e ${envBase} ${opts.serverName} node ${quoteForShell(entry)}\n`
  );

  const desktopJson = {
    mcpServers: {
      [opts.serverName]: {
        command: 'node',
        args: [entry],
        env: { FLUX_API_BASE_URL: opts.baseUrl },
      },
    },
  };

  process.stdout.write(`\nClaude Desktop / Gemini settings.json snippet:\n`);
  process.stdout.write(`${JSON.stringify(desktopJson, null, 2)}\n`);

  process.stdout.write(`\nCodex ~/.codex/config.toml snippet:\n`);
  process.stdout.write(`[mcp_servers.${opts.serverName}]\n`);
  process.stdout.write(`command = "node"\n`);
  process.stdout.write(`args = [${quoteForShell(entry)}]\n\n`);
  process.stdout.write(`[mcp_servers.${opts.serverName}.env]\n`);
  process.stdout.write(`FLUX_API_BASE_URL = ${quoteForShell(opts.baseUrl)}\n`);

  process.stdout.write(`\nNext:\n`);
  process.stdout.write(`- Restart your client and run: /mcp\n`);
  process.stdout.write(`- First MCP call: flux_get_state\n`);
  process.stdout.write(`- For shared native skills, see: .codex/INSTALL.md and .opencode/INSTALL.md\n`);
}

try {
  main();
} catch (err) {
  die(err instanceof Error ? err.message : String(err));
}
