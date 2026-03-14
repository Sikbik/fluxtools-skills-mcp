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

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function createJsonContractRuntime(): ToolRuntime {
  const gitSpecUri = 'flux://resource/test/git-spec';
  const appsListUri = 'flux://resource/test/apps-running';
  const jsonResult = (
    payload: Record<string, unknown>,
    opts?: {
      resourceUri?: string;
    }
  ) => ({
    isError: false,
    structuredContent: payload,
    content: [
      { type: 'text', text: JSON.stringify(payload) },
      ...(opts?.resourceUri ? [{ type: 'resource_link', uri: opts.resourceUri, mimeType: 'application/json' }] : []),
    ],
  });

  return {
    async listTools() {
      return [{ name: 'flux_echo_args', description: 'Echoes args', inputSchema: { type: 'object' } }];
    },

    async callTool(name, rawArgs) {
      const args = asRecord(rawArgs);

      switch (name) {
        case 'flux_echo_args':
          return jsonResult({ echoed: args });
        case 'flux_get_state':
          return jsonResult({
            baseUrl: 'https://node.example',
            zelidauth: { present: false },
            enterpriseKey: { present: false },
            httpDefaults: { timeoutMs: 30000, retryCount: 2, retryBackoffMs: 500 },
            fluxDriveMwsBaseUrl: 'https://mws.fluxdrive.runonflux.io',
          });
        case 'flux_resolve_gateway_node':
          return jsonResult({ requestedBaseUrl: args.gatewayBaseUrl, baseUrl: 'http://10.0.0.5:16127' });
        case 'flux_apps_list_running':
          return jsonResult({ status: 'ok', count: 1 }, { resourceUri: appsListUri });
        case 'flux_git_deploy_generate_spec_v8':
          return jsonResult({ status: 'ok', appname: args.name, owner: args.owner }, { resourceUri: gitSpecUri });
        case 'flux_explorer_status':
          return jsonResult({ currentHeight: 120, scannedHeight: 118, synced: true });
        case 'flux_daemon_get_info':
          return jsonResult({ version: '1.0.0', protocolversion: 170002 });
        case 'flux_apps_list_folder':
          return jsonResult({ status: 'ok', appname: args.appname, component: args.component, folder: '' });
        case 'flux_backup_get_volume_data':
          return jsonResult({ status: 'ok', appname: args.appname, component: args.component, totalSizeBytes: 2048 });
        case 'flux_fluxdrive_get_task_status':
          return jsonResult({ status: 'success', data: { taskId: args.taskId, state: 'done' } });
        case 'flux_syncthing_metrics':
          return jsonResult({ status: 'success', data: { cpuPercent: 1 } });
        default:
          return {
            isError: true,
            structuredContent: { ok: false, error: `Unknown tool: ${name}` },
            content: [{ type: 'text', text: JSON.stringify({ ok: false, error: `Unknown tool: ${name}` }) }],
          };
      }
    },

    async readResource(uri) {
      if (uri === gitSpecUri) {
        return {
          uri,
          mimeType: 'application/json',
          text: JSON.stringify({
            version: 8,
            name: 'repoapp',
            owner: 'zelid1',
          }),
        };
      }

      if (uri === appsListUri) {
        return {
          uri,
          mimeType: 'application/json',
          text: JSON.stringify([
            { app: 'alpha', component: 'web', status: 'running', ip: '10.0.0.10', port: 3000 },
          ]),
        };
      }

      return null;
    },
  };
}

async function withTempStateDir<T>(run: () => Promise<T>) {
  const stateDir = await mkdtemp(join(tmpdir(), 'fluxos-cli-json-contract-'));
  const previousStateDir = process.env.FLUXOS_CLI_STATE_DIR;

  process.env.FLUXOS_CLI_STATE_DIR = stateDir;

  try {
    return await run();
  } finally {
    if (previousStateDir === undefined) delete process.env.FLUXOS_CLI_STATE_DIR;
    else process.env.FLUXOS_CLI_STATE_DIR = previousStateDir;

    await rm(stateDir, { recursive: true, force: true });
  }
}

describe.sequential('major command json contract', () => {
  it('keeps stdout parseable and stderr empty for representative major commands', async () => {
    await withTempStateDir(async () => {
      const runtime = createJsonContractRuntime();
      const cases: Array<{ label: string; argv: string[]; mode?: 'off' | 'on' }> = [
        { label: 'tool list', argv: ['tool', 'list', '--json'], mode: 'off' },
        { label: 'tool call', argv: ['tool', 'call', 'flux_echo_args', '--json', '--arg', 'name=alpha'], mode: 'off' },
        { label: 'resource list', argv: ['resource', 'list', '--json'] },
        { label: 'state show', argv: ['state', 'show', '--json'] },
        { label: 'profile list', argv: ['profile', 'list', '--json'] },
        { label: 'auth status', argv: ['auth', 'status', '--json'], mode: 'off' },
        { label: 'node resolve-gateway', argv: ['node', 'resolve-gateway', 'https://api.runonflux.io', '--json'], mode: 'off' },
        { label: 'apps list-running', argv: ['apps', 'list-running', '--json'], mode: 'off' },
        {
          label: 'git generate-spec',
          argv: ['git', 'generate-spec', '--name', 'repoapp', '--owner', 'zelid1', '--repo-url', 'https://github.com/example/repo', '--json'],
          mode: 'off',
        },
        { label: 'explorer status', argv: ['explorer', 'status', '--json'], mode: 'off' },
        { label: 'daemon info', argv: ['daemon', 'info', '--json'], mode: 'off' },
        { label: 'files list', argv: ['files', 'list', '--appname', 'alpha', '--component', 'web', '--json'], mode: 'off' },
        { label: 'backup volume-data', argv: ['backup', 'volume-data', '--appname', 'alpha', '--component', 'web', '--json'], mode: 'off' },
        { label: 'fluxdrive task-status', argv: ['fluxdrive', 'task-status', '7', '--json'], mode: 'off' },
        { label: 'syncthing metrics', argv: ['syncthing', 'metrics', '--json'], mode: 'off' },
      ];

      for (const testCase of cases) {
        const capture = createCapture();
        const exitCode = await runCli(testCase.argv, {
          io: capture.io,
          toolRuntime: runtime,
          persistedStateMode: testCase.mode ?? 'on',
        });

        expect(exitCode, testCase.label).toBe(0);
        expect(capture.getStderr(), testCase.label).toBe('');

        const payload = JSON.parse(capture.getStdout()) as Record<string, unknown>;
        expect(payload.ok, testCase.label).toBe(true);
      }
    });
  });
});
