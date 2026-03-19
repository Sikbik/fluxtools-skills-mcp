#!/usr/bin/env node

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const DEFAULT_BASE_URL = 'https://api.runonflux.io';
const DEFAULT_SERVER_NAME = 'flux';
const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const packageJsonPath = path.join(packageRoot, 'package.json');
const packageVersion = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8')).version;
const bundledSkillsDir = path.join(packageRoot, 'skills');
const bundledFluxMcpEntry = path.join(packageRoot, 'flux-mcp', 'dist', 'index.js');
const bundledOpenCodePlugin = path.join(packageRoot, '.opencode', 'plugins', 'fluxtools.js');
const bundledGeminiManifest = path.join(packageRoot, 'gemini-extension.json');
const bundledGeminiContext = path.join(packageRoot, 'GEMINI.md');

function printHelp() {
  process.stdout.write(`Fluxtools

Usage:
  fluxtools install <codex|claude|opencode|gemini|cursor> [--base-url <url>] [--server-name <name>] [--skills-only | --mcp-only] [--project-dir <path>] [--json]
  fluxtools doctor <codex|claude|opencode|gemini|cursor> [--base-url <url>] [--server-name <name>] [--project-dir <path>] [--json]
  fluxtools uninstall <codex|claude|opencode|gemini|cursor> [--server-name <name>] [--skills-only | --mcp-only] [--project-dir <path>] [--json]
  fluxtools --help
  fluxtools --version

Notes:
  --skills-only and --mcp-only only apply to codex and claude.
  --project-dir only applies to cursor.
`);
}

function fail(message, exitCode = 1) {
  process.stderr.write(`${message}\n`);
  process.exit(exitCode);
}

function exists(targetPath) {
  try {
    fs.accessSync(targetPath);
    return true;
  } catch {
    return false;
  }
}

function ensureDir(targetPath) {
  fs.mkdirSync(targetPath, { recursive: true });
}

function removePath(targetPath) {
  fs.rmSync(targetPath, { recursive: true, force: true });
}

function copyDir(sourcePath, targetPath) {
  removePath(targetPath);
  ensureDir(path.dirname(targetPath));
  fs.cpSync(sourcePath, targetPath, { recursive: true });
}

function copyFile(sourcePath, targetPath) {
  ensureDir(path.dirname(targetPath));
  fs.copyFileSync(sourcePath, targetPath);
}

function run(command, args, opts = {}) {
  return spawnSync(command, args, {
    stdio: 'pipe',
    encoding: 'utf8',
    ...opts,
  });
}

function basenameNoExe(value) {
  return path.basename(String(value || '')).toLowerCase().replace(/\.exe$/, '');
}

function checkCommand(command, args = ['--help']) {
  const result = run(command, args);
  return {
    ok: !result.error && result.status === 0,
    command,
    reason: result.error?.message || (result.status === 0 ? null : (result.stderr || result.stdout || '').trim() || `${command} command failed`),
  };
}

function parseArgs(argv) {
  const args = [...argv];
  const first = args.shift();

  if (!first || first === '--help' || first === '-h' || first === 'help') {
    return { command: 'help' };
  }

  if (first === '--version' || first === '-v' || first === 'version') {
    return { command: 'version' };
  }

  const platform = args.shift();
  if (!platform) fail(`Missing platform for "${first}". Expected: codex, claude, opencode, gemini, or cursor`);
  if (!['codex', 'claude', 'opencode', 'gemini', 'cursor'].includes(platform)) {
    fail(`Unsupported platform "${platform}". Expected: codex, claude, opencode, gemini, or cursor`);
  }

  const options = {
    baseUrl: DEFAULT_BASE_URL,
    serverName: DEFAULT_SERVER_NAME,
    json: false,
    skillsOnly: false,
    mcpOnly: false,
    projectDir: null,
  };

  while (args.length > 0) {
    const arg = args.shift();

    if (arg === '--json') {
      options.json = true;
      continue;
    }

    if (arg === '--skills-only') {
      options.skillsOnly = true;
      continue;
    }

    if (arg === '--mcp-only') {
      options.mcpOnly = true;
      continue;
    }

    if (arg === '--base-url') {
      const value = args.shift();
      if (!value) fail('--base-url requires a value');
      options.baseUrl = value;
      continue;
    }

    if (arg === '--server-name') {
      const value = args.shift();
      if (!value) fail('--server-name requires a value');
      options.serverName = value;
      continue;
    }

    if (arg === '--project-dir') {
      const value = args.shift();
      if (!value) fail('--project-dir requires a value');
      options.projectDir = path.resolve(value);
      continue;
    }

    fail(`Unknown option: ${arg}`);
  }

  if (options.skillsOnly && options.mcpOnly) {
    fail('Use at most one of --skills-only or --mcp-only');
  }

  if ((platform === 'opencode' || platform === 'gemini') && (options.skillsOnly || options.mcpOnly)) {
    fail(`--skills-only and --mcp-only are not supported for ${platform}`);
  }

  if (platform !== 'cursor' && options.projectDir) {
    fail('--project-dir is only supported for cursor');
  }

  return { command: first, platform, options };
}

function resolveCodexSkillsPath() {
  return path.join(os.homedir(), '.agents', 'skills', 'fluxtools');
}

function resolveClaudeSkillsPath() {
  return path.join(os.homedir(), '.claude', 'skills', 'fluxtools');
}

function resolveOpenCodeConfigDir() {
  const configured = process.env.OPENCODE_CONFIG_DIR && String(process.env.OPENCODE_CONFIG_DIR).trim();
  return configured ? path.resolve(configured) : path.join(os.homedir(), '.config', 'opencode');
}

function resolveOpenCodePluginPath() {
  return path.join(resolveOpenCodeConfigDir(), 'plugins', 'fluxtools.js');
}

function resolveOpenCodeSkillsPath() {
  return path.join(resolveOpenCodeConfigDir(), 'skills', 'fluxtools');
}

function resolveOpenCodeConfigPath() {
  return path.join(resolveOpenCodeConfigDir(), 'opencode.json');
}

function resolveGeminiExtensionDir() {
  return path.join(os.homedir(), '.gemini', 'extensions', 'fluxtools');
}

function resolveCursorConfigDir() {
  return path.join(os.homedir(), '.cursor');
}

function resolveCursorMcpPath() {
  return path.join(resolveCursorConfigDir(), 'mcp.json');
}

function resolveCursorProjectDir(options) {
  return path.resolve(options.projectDir || process.cwd());
}

function resolveCursorRulesPath(projectDir) {
  return path.join(projectDir, '.cursor', 'rules', 'fluxtools.mdc');
}

function resolveCursorCommandPath(projectDir) {
  return path.join(projectDir, '.cursor', 'commands', 'fluxtools-doctor.md');
}

function stripJsonComments(text) {
  let result = '';
  let inString = false;
  let escaped = false;
  let inLineComment = false;
  let inBlockComment = false;

  for (let index = 0; index < text.length; index += 1) {
    const current = text[index];
    const next = text[index + 1];

    if (inLineComment) {
      if (current === '\n') {
        inLineComment = false;
        result += current;
      }
      continue;
    }

    if (inBlockComment) {
      if (current === '*' && next === '/') {
        inBlockComment = false;
        index += 1;
      }
      continue;
    }

    if (inString) {
      result += current;
      if (escaped) {
        escaped = false;
      } else if (current === '\\') {
        escaped = true;
      } else if (current === '"') {
        inString = false;
      }
      continue;
    }

    if (current === '"') {
      inString = true;
      result += current;
      continue;
    }

    if (current === '/' && next === '/') {
      inLineComment = true;
      index += 1;
      continue;
    }

    if (current === '/' && next === '*') {
      inBlockComment = true;
      index += 1;
      continue;
    }

    result += current;
  }

  return result;
}

function readJsonFile(targetPath, fallback) {
  if (!exists(targetPath)) return fallback;
  try {
    return JSON.parse(stripJsonComments(fs.readFileSync(targetPath, 'utf8')));
  } catch (error) {
    fail(`Unable to parse JSON file ${targetPath}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function writeJsonFile(targetPath, value) {
  ensureDir(path.dirname(targetPath));
  fs.writeFileSync(targetPath, `${JSON.stringify(value, null, 2)}\n`);
}

function stripFrontmatter(content) {
  const match = content.match(/^---\n[\s\S]*?\n---\n([\s\S]*)$/);
  return match ? match[1].trim() : content.trim();
}

function buildCursorRuleContent() {
  const bootstrapPath = path.join(bundledSkillsDir, 'using-fluxtools', 'SKILL.md');
  const bootstrapBody = exists(bootstrapPath) ? stripFrontmatter(fs.readFileSync(bootstrapPath, 'utf8')) : '';

  return `---
description: Use Fluxtools for Flux Cloud, FluxOS, Flux daemon, explorer, storage, Syncthing, and deployment work in this project.
alwaysApply: true
---

Use Fluxtools when the task is about Flux, FluxOS, Flux Cloud, Flux apps, Flux node APIs, Flux daemon or explorer data, Syncthing, storage/backups, enterprise flows, ZelID auth, Zelcore, or SSP Wallet.

Execution policy:
- Default to the \`flux\` CLI.
- Use Cursor MCP with the bundled \`flux\` MCP server only when MCP resources or tool-calling are clearly a better fit, or when the CLI is blocked.
- Keep one workflow on one primary surface. Do not repeat the same action across CLI and MCP.
- Prefer \`flux ... --json\` for machine-readable output.
- Preserve Flux safety rules. Do not weaken explicit confirmation requirements for mutations.

Useful entrypoints:
- \`flux --help\`
- \`flux tool list --json\`
- \`flux node health --json\`
- \`flux apps list-global --json\`
- \`fluxtools doctor cursor --project-dir .\`

Shared Fluxtools bootstrap:

${bootstrapBody}
`;
}

function buildCursorCommandContent(projectDir) {
  return `Run a Fluxtools readiness check for this workspace.

Steps:
1. Run \`fluxtools doctor cursor --project-dir ${projectDir}\`.
2. Summarize whether the project rule, the project command, and the global Cursor MCP config are installed.
3. If something is missing, tell the user to run \`fluxtools install cursor --project-dir ${projectDir}\`.
`;
}

function buildExpectedMcpConfig(options) {
  return {
    command: 'node',
    args: [bundledFluxMcpEntry],
    baseUrl: options.baseUrl,
  };
}

function isExpectedCodexMcpConfig(config, expected) {
  const transport = config && typeof config === 'object' ? config.transport : null;
  const command = transport && typeof transport === 'object' && typeof transport.command === 'string' ? transport.command : '';
  const args = transport && typeof transport === 'object' && Array.isArray(transport.args) ? transport.args.map(String) : [];
  const env = transport && typeof transport === 'object' && transport.env && typeof transport.env === 'object' ? transport.env : null;
  const envVars =
    transport && typeof transport === 'object' && Array.isArray(transport.env_vars)
      ? transport.env_vars.map((value) => String(value))
      : [];

  const commandMatches = basenameNoExe(command) === 'node';
  const argsMatch = args.length === expected.args.length && args.every((value, index) => path.resolve(value) === path.resolve(expected.args[index]));
  if (!commandMatches || !argsMatch) return false;

  if (env && typeof env.FLUX_API_BASE_URL === 'string') {
    return env.FLUX_API_BASE_URL === expected.baseUrl;
  }

  return envVars.includes('FLUX_API_BASE_URL') || envVars.includes(`FLUX_API_BASE_URL=${expected.baseUrl}`);
}

function readCodexMcpConfig(serverName) {
  const result = run('codex', ['mcp', 'get', serverName, '--json']);
  if (result.error) return { ok: false, reason: result.error.message };
  if (result.status !== 0) {
    return {
      ok: false,
      reason: (result.stderr || result.stdout || '').trim() || 'MCP server not found',
    };
  }

  try {
    return { ok: true, value: JSON.parse(result.stdout) };
  } catch (error) {
    return {
      ok: false,
      reason: error instanceof Error ? error.message : String(error),
    };
  }
}

function readClaudeMcpConfig(serverName) {
  const result = run('claude', ['mcp', 'get', serverName]);
  if (result.error) return { ok: false, reason: result.error.message };
  if (result.status !== 0) {
    return {
      ok: false,
      reason: (result.stderr || result.stdout || '').trim() || 'MCP server not found',
    };
  }

  return { ok: true, text: result.stdout };
}

function isExpectedClaudeMcpConfig(text, expected) {
  const normalized = String(text || '');
  return (
    normalized.includes('Command: node') &&
    normalized.includes(`Args: ${expected.args[0]}`) &&
    normalized.includes(`FLUX_API_BASE_URL=${expected.baseUrl}`)
  );
}

function buildExpectedOpenCodeMcpConfig(options) {
  return {
    type: 'local',
    command: ['node', bundledFluxMcpEntry],
    enabled: true,
    environment: {
      FLUX_API_BASE_URL: options.baseUrl,
    },
  };
}

function isExpectedOpenCodeMcpConfig(config, expected) {
  if (!config || typeof config !== 'object') return false;
  if (config.type !== expected.type) return false;
  if (config.enabled !== expected.enabled) return false;
  if (!Array.isArray(config.command) || config.command.length !== expected.command.length) return false;
  if (basenameNoExe(config.command[0]) !== basenameNoExe(expected.command[0])) return false;

  const commandMatches = config.command.every((value, index) => {
    if (index === 0) return basenameNoExe(value) === basenameNoExe(expected.command[index]);
    return path.resolve(String(value)) === path.resolve(expected.command[index]);
  });
  if (!commandMatches) return false;

  const environment = config.environment && typeof config.environment === 'object' ? config.environment : null;
  return !!environment && environment.FLUX_API_BASE_URL === expected.environment.FLUX_API_BASE_URL;
}

function buildGeminiManifest(baseUrl) {
  const bundledManifest = readJsonFile(bundledGeminiManifest, {});
  return {
    ...bundledManifest,
    mcpServers: {
      flux: {
        command: 'node',
        args: ['${extensionPath}/flux-mcp/dist/index.js'],
        cwd: '${extensionPath}',
        env: {
          FLUX_API_BASE_URL: baseUrl,
        },
      },
    },
  };
}

function installSharedSkills(targetPath) {
  if (!exists(bundledSkillsDir)) fail(`Bundled skills directory not found: ${bundledSkillsDir}`);
  copyDir(bundledSkillsDir, targetPath);
  return {
    ok: true,
    action: 'installed',
    path: targetPath,
    source: bundledSkillsDir,
  };
}

function readSharedSkillsReport(targetPath) {
  return {
    ok: exists(path.join(targetPath, 'using-fluxtools', 'SKILL.md')),
    path: targetPath,
    source: bundledSkillsDir,
  };
}

function removeSharedSkills(targetPath) {
  const hadSkills = exists(targetPath);
  removePath(targetPath);
  return {
    ok: true,
    action: hadSkills ? 'removed' : 'absent',
    path: targetPath,
  };
}

function installCodex(options) {
  const expectedMcp = buildExpectedMcpConfig(options);
  const report = {
    ok: true,
    platform: 'codex',
    serverName: options.serverName,
    baseUrl: options.baseUrl,
    packageRoot,
    client: checkCommand('codex', ['--version']),
    cli: checkCommand('flux', ['--help']),
    skills: null,
    mcp: null,
  };

  if (!options.mcpOnly) {
    report.skills = installSharedSkills(resolveCodexSkillsPath());
  }

  if (!options.skillsOnly) {
    if (!exists(bundledFluxMcpEntry)) fail(`Bundled MCP entrypoint not found: ${bundledFluxMcpEntry}`);
    if (!report.client.ok) fail(`Codex CLI is required to install Codex support. ${report.client.reason}`);

    const existing = readCodexMcpConfig(options.serverName);
    let action = 'added';

    if (existing.ok) {
      if (isExpectedCodexMcpConfig(existing.value, expectedMcp)) {
        action = 'unchanged';
      } else {
        const removed = run('codex', ['mcp', 'remove', options.serverName]);
        if (removed.error || removed.status !== 0) {
          const detail = removed.error?.message || (removed.stderr || removed.stdout || '').trim() || 'failed to remove existing MCP server';
          fail(`Unable to replace existing Codex MCP server "${options.serverName}". ${detail}`);
        }
        action = 'updated';
      }
    }

    if (action !== 'unchanged') {
      const added = run('codex', ['mcp', 'add', options.serverName, '--env', `FLUX_API_BASE_URL=${options.baseUrl}`, '--', 'node', bundledFluxMcpEntry]);
      if (added.error || added.status !== 0) {
        const detail = added.error?.message || (added.stderr || added.stdout || '').trim() || 'failed to add MCP server';
        fail(`Unable to add Codex MCP server "${options.serverName}". ${detail}`);
      }
    }

    report.mcp = {
      ok: true,
      action,
      name: options.serverName,
      command: 'node',
      entry: bundledFluxMcpEntry,
    };
  }

  report.ok = report.client.ok && report.cli.ok && (report.skills ? report.skills.ok : true) && (report.mcp ? report.mcp.ok : true);
  return report;
}

function buildDoctorCodexReport(options) {
  const expectedMcp = buildExpectedMcpConfig(options);
  const mcpConfig = readCodexMcpConfig(options.serverName);
  const report = {
    ok: false,
    platform: 'codex',
    serverName: options.serverName,
    baseUrl: options.baseUrl,
    packageRoot,
    client: checkCommand('codex', ['--version']),
    cli: checkCommand('flux', ['--help']),
    skills: readSharedSkillsReport(resolveCodexSkillsPath()),
    mcp: {
      ok: false,
      expected: expectedMcp,
      reason: null,
    },
  };

  if (mcpConfig.ok) {
    report.mcp.ok = isExpectedCodexMcpConfig(mcpConfig.value, expectedMcp);
    report.mcp.current = mcpConfig.value;
    if (!report.mcp.ok) report.mcp.reason = 'Configured, but it does not match the packaged Fluxtools MCP entry';
  } else {
    report.mcp.reason = mcpConfig.reason;
  }

  report.ok = report.client.ok && report.cli.ok && report.skills.ok && report.mcp.ok;
  return report;
}

function uninstallCodex(options) {
  const report = {
    ok: true,
    platform: 'codex',
    serverName: options.serverName,
    skills: null,
    mcp: null,
  };

  if (!options.mcpOnly) {
    report.skills = removeSharedSkills(resolveCodexSkillsPath());
  }

  if (!options.skillsOnly) {
    const existing = readCodexMcpConfig(options.serverName);
    if (!existing.ok) {
      report.mcp = { ok: true, action: 'absent', name: options.serverName };
    } else {
      const removed = run('codex', ['mcp', 'remove', options.serverName]);
      if (removed.error || removed.status !== 0) {
        const detail = removed.error?.message || (removed.stderr || removed.stdout || '').trim() || 'failed to remove MCP server';
        fail(`Unable to remove Codex MCP server "${options.serverName}". ${detail}`);
      }
      report.mcp = { ok: true, action: 'removed', name: options.serverName };
    }
  }

  return report;
}

function installClaude(options) {
  const expectedMcp = buildExpectedMcpConfig(options);
  const report = {
    ok: true,
    platform: 'claude',
    serverName: options.serverName,
    baseUrl: options.baseUrl,
    packageRoot,
    client: checkCommand('claude', ['--version']),
    cli: checkCommand('flux', ['--help']),
    pluginBundle: {
      ok: run('claude', ['plugin', 'validate', packageRoot]).status === 0,
      path: packageRoot,
    },
    skills: null,
    mcp: null,
  };

  if (!options.mcpOnly) {
    report.skills = installSharedSkills(resolveClaudeSkillsPath());
  }

  if (!options.skillsOnly) {
    if (!exists(bundledFluxMcpEntry)) fail(`Bundled MCP entrypoint not found: ${bundledFluxMcpEntry}`);
    if (!report.client.ok) fail(`Claude CLI is required to install Claude support. ${report.client.reason}`);

    const existing = readClaudeMcpConfig(options.serverName);
    let action = 'added';

    if (existing.ok) {
      if (isExpectedClaudeMcpConfig(existing.text, expectedMcp)) {
        action = 'unchanged';
      } else {
        const removed = run('claude', ['mcp', 'remove', options.serverName, '-s', 'user']);
        if (removed.error || removed.status !== 0) {
          const detail = removed.error?.message || (removed.stderr || removed.stdout || '').trim() || 'failed to remove existing MCP server';
          fail(`Unable to replace existing Claude MCP server "${options.serverName}". ${detail}`);
        }
        action = 'updated';
      }
    }

    if (action !== 'unchanged') {
      const added = run('claude', ['mcp', 'add', options.serverName, '-s', 'user', '-e', `FLUX_API_BASE_URL=${options.baseUrl}`, '--', 'node', bundledFluxMcpEntry]);
      if (added.error || added.status !== 0) {
        const detail = added.error?.message || (added.stderr || added.stdout || '').trim() || 'failed to add MCP server';
        fail(`Unable to add Claude MCP server "${options.serverName}". ${detail}`);
      }
    }

    report.mcp = {
      ok: true,
      action,
      name: options.serverName,
      command: 'node',
      entry: bundledFluxMcpEntry,
    };
  }

  report.ok = report.cli.ok && report.pluginBundle.ok && (report.skills ? report.skills.ok : true) && (report.mcp ? report.mcp.ok : true);
  return report;
}

function buildDoctorClaudeReport(options) {
  const expectedMcp = buildExpectedMcpConfig(options);
  const mcpConfig = readClaudeMcpConfig(options.serverName);
  const pluginValidation = run('claude', ['plugin', 'validate', packageRoot]);
  const report = {
    ok: false,
    platform: 'claude',
    serverName: options.serverName,
    baseUrl: options.baseUrl,
    packageRoot,
    client: checkCommand('claude', ['--version']),
    cli: checkCommand('flux', ['--help']),
    pluginBundle: {
      ok: pluginValidation.status === 0,
      path: packageRoot,
      reason: pluginValidation.status === 0 ? null : (pluginValidation.stderr || pluginValidation.stdout || '').trim() || 'Plugin bundle validation failed',
    },
    skills: readSharedSkillsReport(resolveClaudeSkillsPath()),
    mcp: {
      ok: false,
      expected: expectedMcp,
      reason: null,
    },
  };

  if (mcpConfig.ok) {
    report.mcp.ok = isExpectedClaudeMcpConfig(mcpConfig.text, expectedMcp);
    report.mcp.current = mcpConfig.text;
    if (!report.mcp.ok) report.mcp.reason = 'Configured, but it does not match the packaged Fluxtools MCP entry';
  } else {
    report.mcp.reason = mcpConfig.reason;
  }

  report.ok = report.cli.ok && report.pluginBundle.ok && report.skills.ok && report.mcp.ok;
  return report;
}

function uninstallClaude(options) {
  const report = {
    ok: true,
    platform: 'claude',
    serverName: options.serverName,
    skills: null,
    mcp: null,
  };

  if (!options.mcpOnly) {
    report.skills = removeSharedSkills(resolveClaudeSkillsPath());
  }

  if (!options.skillsOnly) {
    const existing = readClaudeMcpConfig(options.serverName);
    if (!existing.ok) {
      report.mcp = { ok: true, action: 'absent', name: options.serverName };
    } else {
      const removed = run('claude', ['mcp', 'remove', options.serverName, '-s', 'user']);
      if (removed.error || removed.status !== 0) {
        const detail = removed.error?.message || (removed.stderr || removed.stdout || '').trim() || 'failed to remove MCP server';
        fail(`Unable to remove Claude MCP server "${options.serverName}". ${detail}`);
      }
      report.mcp = { ok: true, action: 'removed', name: options.serverName };
    }
  }

  return report;
}

function installOpenCode(options) {
  if (!exists(bundledOpenCodePlugin)) fail(`Bundled OpenCode plugin not found: ${bundledOpenCodePlugin}`);
  if (!exists(bundledFluxMcpEntry)) fail(`Bundled MCP entrypoint not found: ${bundledFluxMcpEntry}`);
  const pluginPath = resolveOpenCodePluginPath();
  const skillsPath = resolveOpenCodeSkillsPath();
  const configPath = resolveOpenCodeConfigPath();
  const expectedMcp = buildExpectedOpenCodeMcpConfig(options);
  const currentConfig = readJsonFile(configPath, {});
  const currentMcp =
    currentConfig && typeof currentConfig === 'object' && !Array.isArray(currentConfig) && currentConfig.mcp && typeof currentConfig.mcp === 'object'
      ? currentConfig.mcp
      : {};

  copyFile(bundledOpenCodePlugin, pluginPath);
  const skillsReport = installSharedSkills(skillsPath);
  writeJsonFile(configPath, {
    ...(currentConfig && typeof currentConfig === 'object' && !Array.isArray(currentConfig) ? currentConfig : {}),
    $schema: 'https://opencode.ai/config.json',
    mcp: {
      ...currentMcp,
      [options.serverName]: expectedMcp,
    },
  });

  const report = {
    ok: true,
    platform: 'opencode',
    serverName: options.serverName,
    baseUrl: options.baseUrl,
    packageRoot,
    client: checkCommand('opencode', ['--help']),
    cli: checkCommand('flux', ['--help']),
    plugin: {
      ok: exists(pluginPath),
      action: 'installed',
      path: pluginPath,
      source: bundledOpenCodePlugin,
    },
    skills: skillsReport,
    mcp: {
      ok: true,
      action: 'installed',
      path: configPath,
      name: options.serverName,
    },
  };

  report.ok = report.cli.ok && report.plugin.ok && report.skills.ok && report.mcp.ok;
  return report;
}

function buildDoctorOpenCodeReport(options) {
  const pluginPath = resolveOpenCodePluginPath();
  const skillsPath = resolveOpenCodeSkillsPath();
  const configPath = resolveOpenCodeConfigPath();
  const currentConfig = readJsonFile(configPath, {});
  const currentMcp =
    currentConfig && typeof currentConfig === 'object' && !Array.isArray(currentConfig) && currentConfig.mcp && typeof currentConfig.mcp === 'object'
      ? currentConfig.mcp[options.serverName]
      : null;
  const expectedMcp = buildExpectedOpenCodeMcpConfig(options);
  return {
    ok:
      checkCommand('flux', ['--help']).ok &&
      exists(pluginPath) &&
      exists(path.join(skillsPath, 'using-fluxtools', 'SKILL.md')) &&
      isExpectedOpenCodeMcpConfig(currentMcp, expectedMcp),
    platform: 'opencode',
    serverName: options.serverName,
    baseUrl: options.baseUrl,
    packageRoot,
    client: checkCommand('opencode', ['--help']),
    cli: checkCommand('flux', ['--help']),
    plugin: {
      ok: exists(pluginPath),
      path: pluginPath,
      source: bundledOpenCodePlugin,
    },
    skills: readSharedSkillsReport(skillsPath),
    mcp: {
      ok: isExpectedOpenCodeMcpConfig(currentMcp, expectedMcp),
      path: configPath,
      name: options.serverName,
      expected: expectedMcp,
      current: currentMcp,
      reason: isExpectedOpenCodeMcpConfig(currentMcp, expectedMcp)
        ? null
        : `Missing or mismatched OpenCode MCP server "${options.serverName}" in ${configPath}`,
    },
  };
}

function uninstallOpenCode(options) {
  const pluginPath = resolveOpenCodePluginPath();
  const configPath = resolveOpenCodeConfigPath();
  const currentConfig = readJsonFile(configPath, {});
  const currentMcp =
    currentConfig && typeof currentConfig === 'object' && !Array.isArray(currentConfig) && currentConfig.mcp && typeof currentConfig.mcp === 'object'
      ? { ...currentConfig.mcp }
      : {};
  const hadPlugin = exists(pluginPath);
  const hadServer = Object.prototype.hasOwnProperty.call(currentMcp, options.serverName);

  if (hadServer) {
    delete currentMcp[options.serverName];
    const nextConfig = {
      ...(currentConfig && typeof currentConfig === 'object' && !Array.isArray(currentConfig) ? currentConfig : {}),
    };

    if (Object.keys(currentMcp).length > 0) {
      nextConfig.mcp = currentMcp;
      writeJsonFile(configPath, nextConfig);
    } else {
      delete nextConfig.mcp;
      if (Object.keys(nextConfig).length === 0) {
        removePath(configPath);
      } else {
        writeJsonFile(configPath, nextConfig);
      }
    }
  }

  removePath(pluginPath);
  return {
    ok: true,
    platform: 'opencode',
    plugin: {
      ok: true,
      action: hadPlugin ? 'removed' : 'absent',
      path: pluginPath,
    },
    skills: removeSharedSkills(resolveOpenCodeSkillsPath()),
    mcp: {
      ok: true,
      action: hadServer ? 'removed' : 'absent',
      path: configPath,
      name: options.serverName,
    },
  };
}

function installGemini(options) {
  if (!exists(bundledGeminiManifest)) fail(`Bundled Gemini manifest not found: ${bundledGeminiManifest}`);
  if (!exists(bundledGeminiContext)) fail(`Bundled Gemini context file not found: ${bundledGeminiContext}`);
  if (!exists(path.join(packageRoot, 'flux-mcp', 'dist'))) fail(`Bundled Gemini MCP dist directory not found: ${path.join(packageRoot, 'flux-mcp', 'dist')}`);
  if (!exists(path.join(packageRoot, 'flux-mcp', 'data'))) fail(`Bundled Gemini MCP data directory not found: ${path.join(packageRoot, 'flux-mcp', 'data')}`);

  const extensionDir = resolveGeminiExtensionDir();
  const manifest = buildGeminiManifest(options.baseUrl);
  removePath(extensionDir);
  ensureDir(extensionDir);
  writeJsonFile(path.join(extensionDir, 'gemini-extension.json'), manifest);
  copyFile(bundledGeminiContext, path.join(extensionDir, 'GEMINI.md'));
  copyDir(bundledSkillsDir, path.join(extensionDir, 'skills'));
  copyDir(path.join(packageRoot, 'flux-mcp', 'dist'), path.join(extensionDir, 'flux-mcp', 'dist'));
  copyDir(path.join(packageRoot, 'flux-mcp', 'data'), path.join(extensionDir, 'flux-mcp', 'data'));

  const report = {
    ok: true,
    platform: 'gemini',
    baseUrl: options.baseUrl,
    packageRoot,
    client: checkCommand('gemini', ['--help']),
    cli: checkCommand('flux', ['--help']),
    extension: {
      ok: true,
      action: 'installed',
      path: extensionDir,
      manifest: path.join(extensionDir, 'gemini-extension.json'),
      context: path.join(extensionDir, 'GEMINI.md'),
      mcpEntry: path.join(extensionDir, 'flux-mcp', 'dist', 'index.js'),
    },
  };

  report.ok = report.cli.ok && report.extension.ok;
  return report;
}

function buildDoctorGeminiReport(options) {
  const extensionDir = resolveGeminiExtensionDir();
  const manifestPath = path.join(extensionDir, 'gemini-extension.json');
  const contextPath = path.join(extensionDir, 'GEMINI.md');
  const manifest = readJsonFile(manifestPath, null);
  const server = manifest && manifest.mcpServers && typeof manifest.mcpServers === 'object' ? manifest.mcpServers.flux : null;
  const extensionOk =
    exists(manifestPath) &&
    exists(contextPath) &&
    exists(path.join(extensionDir, 'skills', 'using-fluxtools', 'SKILL.md')) &&
    exists(path.join(extensionDir, 'flux-mcp', 'dist', 'index.js')) &&
    !!server &&
    server.command === 'node' &&
    Array.isArray(server.args) &&
    server.args.length === 1 &&
    server.args[0] === '${extensionPath}/flux-mcp/dist/index.js' &&
    server.cwd === '${extensionPath}' &&
    server.env &&
    typeof server.env === 'object' &&
    server.env.FLUX_API_BASE_URL === options.baseUrl;
  return {
    ok: checkCommand('flux', ['--help']).ok && extensionOk,
    platform: 'gemini',
    baseUrl: options.baseUrl,
    packageRoot,
    client: checkCommand('gemini', ['--help']),
    cli: checkCommand('flux', ['--help']),
    extension: {
      ok: extensionOk,
      path: extensionDir,
      manifest: manifestPath,
      context: contextPath,
      mcpEntry: path.join(extensionDir, 'flux-mcp', 'dist', 'index.js'),
      current: manifest,
    },
  };
}

function uninstallGemini() {
  const extensionDir = resolveGeminiExtensionDir();
  const hadExtension = exists(extensionDir);
  removePath(extensionDir);
  return {
    ok: true,
    platform: 'gemini',
    extension: {
      ok: true,
      action: hadExtension ? 'removed' : 'absent',
      path: extensionDir,
    },
  };
}

function installCursor(options) {
  const projectDir = resolveCursorProjectDir(options);
  const rulesPath = resolveCursorRulesPath(projectDir);
  const commandPath = resolveCursorCommandPath(projectDir);
  const mcpPath = resolveCursorMcpPath();
  const mcpConfig = readJsonFile(mcpPath, {});
  const currentServers =
    mcpConfig && typeof mcpConfig === 'object' && !Array.isArray(mcpConfig) && mcpConfig.mcpServers && typeof mcpConfig.mcpServers === 'object'
      ? mcpConfig.mcpServers
      : {};

  const nextConfig = {
    ...(mcpConfig && typeof mcpConfig === 'object' && !Array.isArray(mcpConfig) ? mcpConfig : {}),
    mcpServers: {
      ...currentServers,
      [options.serverName]: {
        command: 'node',
        args: [bundledFluxMcpEntry],
        env: {
          FLUX_API_BASE_URL: options.baseUrl,
        },
      },
    },
  };

  writeJsonFile(mcpPath, nextConfig);
  ensureDir(path.dirname(rulesPath));
  fs.writeFileSync(rulesPath, buildCursorRuleContent());
  ensureDir(path.dirname(commandPath));
  fs.writeFileSync(commandPath, buildCursorCommandContent(projectDir));

  const report = {
    ok: true,
    platform: 'cursor',
    packageRoot,
    projectDir,
    serverName: options.serverName,
    baseUrl: options.baseUrl,
    client: checkCommand('cursor-agent', ['--help']),
    cli: checkCommand('flux', ['--help']),
    rules: {
      ok: true,
      action: 'installed',
      path: rulesPath,
    },
    commands: {
      ok: true,
      action: 'installed',
      path: commandPath,
    },
    mcp: {
      ok: true,
      action: 'installed',
      path: mcpPath,
      name: options.serverName,
    },
  };

  report.ok = report.cli.ok && report.rules.ok && report.commands.ok && report.mcp.ok;
  return report;
}

function buildDoctorCursorReport(options) {
  const projectDir = resolveCursorProjectDir(options);
  const rulesPath = resolveCursorRulesPath(projectDir);
  const commandPath = resolveCursorCommandPath(projectDir);
  const mcpPath = resolveCursorMcpPath();
  const mcpConfig = readJsonFile(mcpPath, {});
  const mcpServers =
    mcpConfig && typeof mcpConfig === 'object' && !Array.isArray(mcpConfig) && mcpConfig.mcpServers && typeof mcpConfig.mcpServers === 'object'
      ? mcpConfig.mcpServers
      : {};
  const serverConfig = mcpServers[options.serverName];
  const expected = buildExpectedMcpConfig(options);

  const mcpOk =
    !!serverConfig &&
    basenameNoExe(serverConfig.command) === 'node' &&
    Array.isArray(serverConfig.args) &&
    serverConfig.args.length === expected.args.length &&
    serverConfig.args.every((value, index) => path.resolve(String(value)) === path.resolve(expected.args[index])) &&
    serverConfig.env &&
    typeof serverConfig.env === 'object' &&
    serverConfig.env.FLUX_API_BASE_URL === options.baseUrl;

  return {
    ok: checkCommand('flux', ['--help']).ok && exists(rulesPath) && exists(commandPath) && mcpOk,
    platform: 'cursor',
    packageRoot,
    projectDir,
    serverName: options.serverName,
    baseUrl: options.baseUrl,
    client: checkCommand('cursor-agent', ['--help']),
    cli: checkCommand('flux', ['--help']),
    rules: {
      ok: exists(rulesPath),
      path: rulesPath,
    },
    commands: {
      ok: exists(commandPath),
      path: commandPath,
    },
    mcp: {
      ok: mcpOk,
      path: mcpPath,
      name: options.serverName,
      expected,
      current: serverConfig ?? null,
      reason: mcpOk ? null : `Missing or mismatched Cursor MCP server "${options.serverName}" in ${mcpPath}`,
    },
  };
}

function uninstallCursor(options) {
  const projectDir = resolveCursorProjectDir(options);
  const rulesPath = resolveCursorRulesPath(projectDir);
  const commandPath = resolveCursorCommandPath(projectDir);
  const mcpPath = resolveCursorMcpPath();
  const mcpConfig = readJsonFile(mcpPath, {});
  const currentServers =
    mcpConfig && typeof mcpConfig === 'object' && !Array.isArray(mcpConfig) && mcpConfig.mcpServers && typeof mcpConfig.mcpServers === 'object'
      ? { ...mcpConfig.mcpServers }
      : {};
  const hadServer = Object.prototype.hasOwnProperty.call(currentServers, options.serverName);

  if (hadServer) {
    delete currentServers[options.serverName];
    writeJsonFile(mcpPath, {
      ...(mcpConfig && typeof mcpConfig === 'object' && !Array.isArray(mcpConfig) ? mcpConfig : {}),
      mcpServers: currentServers,
    });
  }

  const hadRules = exists(rulesPath);
  const hadCommand = exists(commandPath);
  removePath(rulesPath);
  removePath(commandPath);

  return {
    ok: true,
    platform: 'cursor',
    projectDir,
    serverName: options.serverName,
    rules: {
      ok: true,
      action: hadRules ? 'removed' : 'absent',
      path: rulesPath,
    },
    commands: {
      ok: true,
      action: hadCommand ? 'removed' : 'absent',
      path: commandPath,
    },
    mcp: {
      ok: true,
      action: hadServer ? 'removed' : 'absent',
      path: mcpPath,
      name: options.serverName,
    },
  };
}

function printInstallReport(report) {
  process.stdout.write(`Installed Fluxtools for ${report.platform}\n`);
  if (report.client) process.stdout.write(`- client: ${report.client.ok ? 'detected' : 'not detected'} (${report.client.command})\n`);
  if (report.cli) process.stdout.write(`- CLI: ${report.cli.ok ? 'ok' : 'missing'} (${report.cli.command})\n`);
  if (report.pluginBundle) process.stdout.write(`- plugin package: ${report.pluginBundle.ok ? 'valid' : 'invalid'} (${report.pluginBundle.path})\n`);
  if (report.plugin) process.stdout.write(`- plugin: ${report.plugin.action} (${report.plugin.path})\n`);
  if (report.extension) process.stdout.write(`- extension: ${report.extension.action} (${report.extension.path})\n`);
  if (report.rules) process.stdout.write(`- rules: ${report.rules.action} (${report.rules.path})\n`);
  if (report.commands) process.stdout.write(`- commands: ${report.commands.action} (${report.commands.path})\n`);
  if (report.skills) process.stdout.write(`- skills: ${report.skills.action} (${report.skills.path})\n`);
  if (report.mcp) process.stdout.write(`- MCP: ${report.mcp.action} (${report.serverName})\n`);
}

function printDoctorReport(report) {
  process.stdout.write(`Fluxtools ${report.platform} status\n`);
  if (report.client) process.stdout.write(`- client: ${report.client.ok ? 'detected' : 'not detected'} (${report.client.command})\n`);
  if (report.cli) process.stdout.write(`- CLI: ${report.cli.ok ? 'ok' : 'missing'} (${report.cli.command})\n`);
  if (report.pluginBundle) {
    process.stdout.write(`- plugin package: ${report.pluginBundle.ok ? 'valid' : 'invalid'} (${report.pluginBundle.path})\n`);
    if (!report.pluginBundle.ok && report.pluginBundle.reason) process.stdout.write(`  reason: ${report.pluginBundle.reason}\n`);
  }
  if (report.plugin) process.stdout.write(`- plugin: ${report.plugin.ok ? 'ok' : 'missing'} (${report.plugin.path})\n`);
  if (report.extension) process.stdout.write(`- extension: ${report.extension.ok ? 'ok' : 'missing'} (${report.extension.path})\n`);
  if (report.rules) process.stdout.write(`- rules: ${report.rules.ok ? 'ok' : 'missing'} (${report.rules.path})\n`);
  if (report.commands) process.stdout.write(`- commands: ${report.commands.ok ? 'ok' : 'missing'} (${report.commands.path})\n`);
  if (report.skills) process.stdout.write(`- skills: ${report.skills.ok ? 'ok' : 'missing'} (${report.skills.path})\n`);
  if (report.mcp) {
    process.stdout.write(`- MCP: ${report.mcp.ok ? 'ok' : 'missing'} (${report.serverName})\n`);
    if (!report.mcp.ok && report.mcp.reason) process.stdout.write(`  reason: ${report.mcp.reason}\n`);
  }
}

function printUninstallReport(report) {
  process.stdout.write(`Removed Fluxtools ${report.platform} integration\n`);
  if (report.plugin) process.stdout.write(`- plugin: ${report.plugin.action} (${report.plugin.path})\n`);
  if (report.extension) process.stdout.write(`- extension: ${report.extension.action} (${report.extension.path})\n`);
  if (report.rules) process.stdout.write(`- rules: ${report.rules.action} (${report.rules.path})\n`);
  if (report.commands) process.stdout.write(`- commands: ${report.commands.action} (${report.commands.path})\n`);
  if (report.skills) process.stdout.write(`- skills: ${report.skills.action} (${report.skills.path})\n`);
  if (report.mcp) process.stdout.write(`- MCP: ${report.mcp.action} (${report.serverName})\n`);
}

function installPlatform(platform, options) {
  switch (platform) {
    case 'codex':
      return installCodex(options);
    case 'claude':
      return installClaude(options);
    case 'opencode':
      return installOpenCode(options);
    case 'gemini':
      return installGemini(options);
    case 'cursor':
      return installCursor(options);
    default:
      fail(`Unsupported platform: ${platform}`);
  }
}

function doctorPlatform(platform, options) {
  switch (platform) {
    case 'codex':
      return buildDoctorCodexReport(options);
    case 'claude':
      return buildDoctorClaudeReport(options);
    case 'opencode':
      return buildDoctorOpenCodeReport(options);
    case 'gemini':
      return buildDoctorGeminiReport(options);
    case 'cursor':
      return buildDoctorCursorReport(options);
    default:
      fail(`Unsupported platform: ${platform}`);
  }
}

function uninstallPlatform(platform, options) {
  switch (platform) {
    case 'codex':
      return uninstallCodex(options);
    case 'claude':
      return uninstallClaude(options);
    case 'opencode':
      return uninstallOpenCode(options);
    case 'gemini':
      return uninstallGemini(options);
    case 'cursor':
      return uninstallCursor(options);
    default:
      fail(`Unsupported platform: ${platform}`);
  }
}

function main() {
  const parsed = parseArgs(process.argv.slice(2));

  if (parsed.command === 'help') {
    printHelp();
    return;
  }

  if (parsed.command === 'version') {
    process.stdout.write(`${packageVersion}\n`);
    return;
  }

  if (parsed.command === 'install') {
    const report = installPlatform(parsed.platform, parsed.options);
    if (parsed.options.json) {
      process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    } else {
      printInstallReport(report);
    }
    process.exitCode = report.ok ? 0 : 1;
    return;
  }

  if (parsed.command === 'doctor') {
    const report = doctorPlatform(parsed.platform, parsed.options);
    if (parsed.options.json) {
      process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    } else {
      printDoctorReport(report);
    }
    process.exitCode = report.ok ? 0 : 1;
    return;
  }

  if (parsed.command === 'uninstall') {
    const report = uninstallPlatform(parsed.platform, parsed.options);
    if (parsed.options.json) {
      process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    } else {
      printUninstallReport(report);
    }
    return;
  }

  fail(`Unsupported command: ${parsed.command}`);
}

main();
