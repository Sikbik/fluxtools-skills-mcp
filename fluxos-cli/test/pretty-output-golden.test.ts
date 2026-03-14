import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { runCli, type ToolRuntime } from '../src/cli.js';

function createCapture() {
  let stdout = '';
  let stderr = '';

  return {
    io: {
      stdout: {
        write(chunk: string) {
          stdout += chunk;
        },
      },
      stderr: {
        write(chunk: string) {
          stderr += chunk;
        },
      },
    },
    getStdout() {
      return stdout;
    },
    getStderr() {
      return stderr;
    },
  };
}

function createPrettyRuntime(): ToolRuntime {
  const appsListUri = 'flux://resource/test/apps-running-pretty';
  const daemonInfoUri = 'flux://resource/test/daemon-info-pretty';

  return {
    async listTools() {
      return [{ name: 'flux_echo_args', description: 'Echoes args', inputSchema: { type: 'object' } }];
    },

    async callTool(name) {
      switch (name) {
        case 'flux_apps_list_running':
          return {
            isError: false,
            structuredContent: { status: 'ok', resourceUri: appsListUri },
            content: [
              { type: 'text', text: JSON.stringify({ status: 'ok', resourceUri: appsListUri }) },
              { type: 'resource_link', uri: appsListUri, mimeType: 'application/json' },
            ],
          };

        case 'flux_explorer_status':
          return {
            isError: false,
            structuredContent: {
              status: 'ok',
              currentHeight: 120,
              isSynced: true,
              approxSecondsBehind: 0,
              secondsPerBlock: 120,
              approxBlocksPerHour: 30,
              approxBlocksPerDay: 720,
            },
            content: [{ type: 'text', text: '{}' }],
          };

        case 'flux_daemon_get_info':
          return {
            isError: false,
            structuredContent: {
              status: 'ok',
              httpStatus: 200,
              resourceUri: daemonInfoUri,
            },
            content: [
              { type: 'text', text: JSON.stringify({ status: 'ok', httpStatus: 200, resourceUri: daemonInfoUri }) },
              { type: 'resource_link', uri: daemonInfoUri, mimeType: 'application/json' },
            ],
          };

        default:
          return {
            isError: true,
            structuredContent: { ok: false, error: `Unknown tool: ${name}` },
            content: [{ type: 'text', text: JSON.stringify({ ok: false, error: `Unknown tool: ${name}` }) }],
          };
      }
    },

    async readResource(uri) {
      if (uri === appsListUri) {
        return {
          uri,
          mimeType: 'application/json',
          text: JSON.stringify([
            { app: 'alpha', component: 'web', status: 'running', ip: '10.0.0.10', port: 3000 },
          ]),
        };
      }

      if (uri === daemonInfoUri) {
        return {
          uri,
          mimeType: 'application/json',
          text: JSON.stringify({ version: '1.0.0', protocolversion: 170002 }),
        };
      }

      return null;
    },
  };
}

async function withTempStateDir<T>(run: (stateDir: string) => Promise<T>) {
  const stateDir = await mkdtemp(join(tmpdir(), 'fluxos-cli-pretty-golden-'));
  const previousStateDir = process.env.FLUXOS_CLI_STATE_DIR;

  process.env.FLUXOS_CLI_STATE_DIR = stateDir;

  try {
    return await run(stateDir);
  } finally {
    if (previousStateDir === undefined) delete process.env.FLUXOS_CLI_STATE_DIR;
    else process.env.FLUXOS_CLI_STATE_DIR = previousStateDir;

    await rm(stateDir, { recursive: true, force: true });
  }
}

async function invokeCli(argv: string[], toolRuntime?: ToolRuntime) {
  const capture = createCapture();
  const exitCode = await runCli(argv, {
    io: capture.io,
    ...(toolRuntime ? { toolRuntime } : {}),
    ...(toolRuntime ? { persistedStateMode: 'off' as const } : {}),
  });

  return {
    exitCode,
    stdout: capture.getStdout(),
    stderr: capture.getStderr(),
  };
}

describe.sequential('pretty output goldens', () => {
  it('keeps representative pretty outputs stable', async () => {
    await withTempStateDir(async (stateDir) => {
      const runtime = createPrettyRuntime();

      const state = await invokeCli(['state', 'show', '--pretty']);
      expect(state.exitCode).toBe(0);
      expect(state.stderr).toBe('');
      expect(state.stdout.trim()).toBe(
        [
          'Active profile: default',
          'Base URL: https://api.runonflux.io',
          'Auth: not set',
          'Enterprise key: not set',
          'FluxDrive base URL: https://mws.fluxdrive.runonflux.io',
          'HTTP defaults: timeoutMs=30000, retryCount=2, retryBackoffMs=500',
          `State dir: ${stateDir}`,
          `State file: ${join(stateDir, 'state.json')}`,
          `Resource store file: ${join(stateDir, 'resources.json')}`,
        ].join('\n')
      );

      const toolList = await invokeCli(['tool', 'list', '--pretty'], runtime);
      expect(toolList.exitCode).toBe(0);
      expect(toolList.stderr).toBe('');
      expect(toolList.stdout.trim()).toBe('Flux tool catalog (1)\n- flux_echo_args — Echoes args');

      const apps = await invokeCli(['apps', 'list-running', '--pretty'], runtime);
      expect(apps.exitCode).toBe(0);
      expect(apps.stderr).toBe('');
      expect(apps.stdout.trim()).toBe(
        [
          'Running apps (1)',
          '- alpha · component=web · status=running · 10.0.0.10:3000',
        ].join('\n')
      );

      const explorer = await invokeCli(['explorer', 'status', '--pretty'], runtime);
      expect(explorer.exitCode).toBe(0);
      expect(explorer.stderr).toBe('');
      expect(explorer.stdout.trim()).toBe(
        [
          'Explorer status',
          'Status: ok',
          'Synced: true',
          'Current height: 120',
          'Approx seconds behind: 0',
          'Seconds per block: 120',
          'Approx blocks per hour: 30',
          'Approx blocks per day: 720',
          'Resource URI: <none>',
        ].join('\n')
      );

      const daemon = await invokeCli(['daemon', 'info', '--pretty'], runtime);
      expect(daemon.exitCode).toBe(0);
      expect(daemon.stderr).toBe('');
      expect(daemon.stdout.trim()).toBe(
        [
          'Daemon info',
          'Status: ok',
          'HTTP status: 200',
          'Resource URI: flux://resource/test/daemon-info-pretty',
          'Data: {',
          '  "version": "1.0.0",',
          '  "protocolversion": 170002',
          '}',
        ].join('\n')
      );
    });
  });
});
