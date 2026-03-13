import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { runCli, type ToolRuntime } from '../src/cli.js';

const MANAGED_ENV_KEYS = [
  'FLUXOS_CLI_STATE_DIR',
  'XDG_STATE_HOME',
  'FLUX_API_BASE_URL',
  'FLUX_ZELIDAUTH',
  'FLUX_ENTERPRISE_KEY',
  'FLUXDRIVE_MWS_BASE_URL',
  'FLUX_HTTP_TIMEOUT_MS',
  'FLUX_HTTP_RETRY_COUNT',
  'FLUX_HTTP_RETRY_BACKOFF_MS',
] as const;

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

function createFluxRequestResult(data: unknown, status = 200) {
  return {
    ok: true,
    status,
    data: {
      status: 'success',
      data,
    },
  };
}

function jsonResultWithResource(payload: Record<string, unknown>, resourceUri: string) {
  return {
    isError: false,
    structuredContent: payload,
    content: [
      { type: 'text', text: JSON.stringify(payload, null, 2) },
      { type: 'resource_link', uri: resourceUri, name: resourceUri, mimeType: 'application/json' },
    ],
  };
}

function createStatusTroubleshootRuntime(): ToolRuntime {
  const resources = new Map<string, { text: string; mimeType: string }>();

  const setJsonResource = (uri: string, value: unknown) => {
    resources.set(uri, { text: JSON.stringify(value, null, 2), mimeType: 'application/json' });
  };

  return {
    async listTools() {
      return [];
    },
    async callTool(name, rawArgs) {
      const args = rawArgs && typeof rawArgs === 'object' && !Array.isArray(rawArgs)
        ? (rawArgs as Record<string, unknown>)
        : {};

      switch (name) {
        case 'flux_apps_global_status': {
          const resourceUri = 'flux://resource/apps/global-status/demo';
          setJsonResource(resourceUri, {
            appname: typeof args.appname === 'string' ? args.appname : null,
            currentHeight: 150,
            computed: [
              {
                name: 'demo-app',
                owner: 'demo-owner',
                hash: 'demo-hash',
                instances: 3,
                height: 100,
                expirationHeight: 220,
                blocksRemaining: 70,
                expired: false,
                hasTemporary: true,
                hasPermanent: false,
              },
            ],
            location: { appname: 'demo-app', count: 2 },
            localRuntime: { appname: 'demo-app', runningCount: 1 },
          });

          return jsonResultWithResource(
            {
              ok: true,
              status: 'ok',
              appname: typeof args.appname === 'string' ? args.appname : null,
              zelid: null,
              count: 1,
              shown: 1,
              temporaryCount: 1,
              permanentCount: 0,
              locationsCount: 2,
              localRunningCount: 1,
              propagation: { tempYes: 1, permYes: 0, both: 0, neither: 0 },
              resourceUri,
            },
            resourceUri
          );
        }
        case 'flux_apps_troubleshoot': {
          const appname = typeof args.appname === 'string' ? args.appname : 'demo-app';
          const resourceUri = 'flux://resource/apps/troubleshoot/demo';
          const suspects = [
            {
              code: 'install_errors',
              title: 'Install errors reported by locations endpoint',
              severity: 'high',
              evidence: { errorsCount: 2 },
            },
          ];
          const nextActions = [
            { tool: 'flux_apps_get_spec', arguments: { appname } },
            { tool: 'flux_apps_get_owner', arguments: { appname } },
          ];

          setJsonResource(resourceUri, {
            appname,
            derived: {
              globalExists: true,
              locationCount: 2,
              installingCount: 1,
              errorsCount: 2,
              localRunningCount: 0,
              suspects,
              nextActions,
            },
            health: args.deep === true ? { inspect: createFluxRequestResult({ status: 'missing' }) } : null,
          });

          return jsonResultWithResource(
            {
              ok: true,
              status: 'install_errors',
              appname,
              globalExists: true,
              locationsCount: 2,
              installingCount: 1,
              errorsCount: 2,
              localRunningCount: 0,
              suspects,
              nextActions,
              resourceUri,
            },
            resourceUri
          );
        }
        default:
          return {
            isError: true,
            structuredContent: { ok: false, error: `Unknown tool: ${name}` },
            content: [{ type: 'text', text: JSON.stringify({ ok: false, error: `Unknown tool: ${name}` }) }],
          };
      }
    },
    async readResource(uri) {
      const resource = resources.get(uri);
      if (!resource) return null;
      return { uri, mimeType: resource.mimeType, text: resource.text };
    },
  };
}

async function withTempStateDir<T>(run: () => Promise<T>) {
  const stateDir = await mkdtemp(join(tmpdir(), 'fluxos-cli-status-'));
  const previousEnv = new Map<string, string | undefined>(MANAGED_ENV_KEYS.map((key) => [key, process.env[key]]));

  process.env.FLUXOS_CLI_STATE_DIR = stateDir;
  delete process.env.XDG_STATE_HOME;
  delete process.env.FLUX_API_BASE_URL;
  delete process.env.FLUX_ZELIDAUTH;
  delete process.env.FLUX_ENTERPRISE_KEY;
  delete process.env.FLUXDRIVE_MWS_BASE_URL;
  delete process.env.FLUX_HTTP_TIMEOUT_MS;
  delete process.env.FLUX_HTTP_RETRY_COUNT;
  delete process.env.FLUX_HTTP_RETRY_BACKOFF_MS;

  try {
    return await run();
  } finally {
    for (const [key, value] of previousEnv.entries()) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }

    await rm(stateDir, { recursive: true, force: true });
  }
}

async function invokeCli(argv: string[], toolRuntime: ToolRuntime) {
  const capture = createCapture();
  const exitCode = await runCli(argv, {
    io: capture.io,
    toolRuntime,
    persistedStateMode: 'off',
  });

  return {
    exitCode,
    stdout: capture.getStdout(),
    stderr: capture.getStderr(),
  };
}

describe.sequential('apps status and troubleshoot', () => {
  it('returns deterministic correlated global-status summaries', async () => {
    await withTempStateDir(async () => {
      const runtime = createStatusTroubleshootRuntime();
      const result = await invokeCli(['apps', 'global-status', '--appname', 'demo-app', '--json'], runtime);

      expect(result.exitCode).toBe(0);
      expect(JSON.parse(result.stdout)).toMatchObject({
        ok: true,
        currentHeight: 150,
        correlation: {
          appname: 'demo-app',
          propagationState: 'temporary_only',
          runtimeState: 'running_on_current_node',
          locationsCount: 2,
          localRunningCount: 1,
        },
        items: [
          {
            name: 'demo-app',
            propagationState: 'temporary_only',
          },
        ],
      });
    });
  });

  it('returns suspects and next-step guidance for troubleshoot', async () => {
    await withTempStateDir(async () => {
      const runtime = createStatusTroubleshootRuntime();
      const jsonResult = await invokeCli(['apps', 'troubleshoot', 'demo-app', '--json'], runtime);

      expect(jsonResult.exitCode).toBe(0);
      const payload = JSON.parse(jsonResult.stdout) as Record<string, unknown>;
      expect(payload).toMatchObject({
        ok: true,
        appname: 'demo-app',
        correlation: {
          globalExists: true,
          runtimeState: 'not_running_on_this_node',
          errorsCount: 2,
        },
      });
      expect(payload.suspects).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            code: 'install_errors',
            category: 'deployment',
            severity: 'high',
          }),
        ])
      );
      expect(payload.nextActions).toEqual(
        expect.arrayContaining([
          { tool: 'flux_apps_get_spec', arguments: { appname: 'demo-app' } },
        ])
      );

      const prettyResult = await invokeCli(['apps', 'troubleshoot', 'demo-app', '--pretty'], runtime);
      expect(prettyResult.exitCode).toBe(0);
      expect(prettyResult.stdout).toContain('Troubleshoot demo-app');
      expect(prettyResult.stdout).toContain('Top suspect: install_errors');
      expect(prettyResult.stdout).toContain('flux_apps_get_spec');
    });
  });
});
