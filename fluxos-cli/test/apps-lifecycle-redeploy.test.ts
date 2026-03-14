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

function fluxRequestToolResult(data: unknown, status = 200) {
  const payload = createFluxRequestResult(data, status);
  return {
    isError: false,
    content: [{ type: 'text', text: JSON.stringify(payload, null, 2) }],
  };
}

function jsonResultWithResource(
  payload: Record<string, unknown>,
  resourceUri: string,
  opts?: { isError?: boolean; mimeType?: string }
) {
  return {
    isError: opts?.isError ?? false,
    structuredContent: payload,
    content: [
      { type: 'text', text: JSON.stringify(payload, null, 2) },
      {
        type: 'resource_link',
        uri: resourceUri,
        name: resourceUri,
        mimeType: opts?.mimeType ?? 'application/json',
      },
    ],
  };
}

function createAppsLifecycleRuntime(): { runtime: ToolRuntime; calls: Array<{ name: string; args: Record<string, unknown> }> } {
  const resources = new Map<string, { text: string; mimeType: string }>();
  const calls: Array<{ name: string; args: Record<string, unknown> }> = [];

  const setJsonResource = (uri: string, value: unknown) => {
    resources.set(uri, { text: JSON.stringify(value, null, 2), mimeType: 'application/json' });
  };

  const runtime: ToolRuntime = {
    async listTools() {
      return [];
    },
    async callTool(name, rawArgs) {
      const args = rawArgs && typeof rawArgs === 'object' && !Array.isArray(rawArgs)
        ? ({ ...rawArgs } as Record<string, unknown>)
        : {};
      calls.push({ name, args });

      const appname = typeof args.appname === 'string' ? args.appname : 'demo-app';

      switch (name) {
        case 'flux_apps_start': {
          if (args.confirm !== true) {
            throw new Error('confirm=true is required to run: apps/appstart');
          }

          return fluxRequestToolResult({
            message: 'Start accepted',
            appname,
            global: args.global === true,
          });
        }
        case 'flux_apps_stop': {
          if (args.confirm !== true) {
            throw new Error('confirm=true is required to run: apps/appstop');
          }

          return fluxRequestToolResult({
            message: 'Stop accepted',
            appname,
            global: args.global === true,
          });
        }
        case 'flux_apps_restart': {
          if (args.confirm !== true) {
            throw new Error('confirm=true is required to run: apps/apprestart');
          }

          return fluxRequestToolResult({
            message: 'Restart accepted',
            appname,
            global: args.global === true,
          });
        }
        case 'flux_apps_redeploy': {
          if (args.confirm !== true) {
            throw new Error('confirm=true is required to run: apps/redeploy');
          }

          const resourceUri = `flux://resource/apps/redeploy/${appname}`;
          if (appname === 'mixed-app') {
            setJsonResource(resourceUri, {
              request: {
                appname,
                force: args.force === true ? true : null,
                global: args.global === true ? true : null,
                timeoutMs: typeof args.timeoutMs === 'number' ? args.timeoutMs : null,
              },
              response: { ok: true, status: 200 },
              parsed: {
                events: [
                  'redeploy: draining old container',
                  'success: redeploy complete',
                  'error: container failed health check',
                ],
                jsonObjects: [{ status: 'success', data: { message: 'Redeploy complete' } }],
              },
            });

            return jsonResultWithResource(
              {
                ok: true,
                status: 200,
                appname,
                force: args.force === true ? true : null,
                global: args.global === true ? true : null,
                eventCount: 3,
                events: [
                  'redeploy: draining old container',
                  'success: redeploy complete',
                  'error: container failed health check',
                ],
                resourceUri,
                nextActions: [{ tool: 'flux_apps_logs', arguments: { appname } }],
              },
              resourceUri,
            );
          }

          setJsonResource(resourceUri, {
            request: {
              appname,
              force: args.force === true ? true : null,
              global: args.global === true ? true : null,
              timeoutMs: typeof args.timeoutMs === 'number' ? args.timeoutMs : null,
            },
            response: { ok: true, status: 200 },
            parsed: {
              events: [
                'redeploy: draining old container',
                'redeploy: pulling image',
                'success: redeploy complete',
              ],
              jsonObjects: [{ status: 'success', data: { message: 'Redeploy complete' } }],
            },
          });

          return jsonResultWithResource(
            {
              ok: true,
              status: 200,
              appname,
              force: args.force === true ? true : null,
              global: args.global === true ? true : null,
              eventCount: 3,
              events: [
                'redeploy: draining old container',
                'redeploy: pulling image',
                'success: redeploy complete',
              ],
              resourceUri,
              nextActions: [{ tool: 'flux_apps_logs', arguments: { appname } }],
            },
            resourceUri,
          );
        }
        case 'flux_apps_redeploy_component': {
          if (args.confirm !== true) {
            throw new Error('confirm=true is required to run: apps/redeploycomponent');
          }

          const component = typeof args.component === 'string' ? args.component : 'api';
          const resourceUri = `flux://resource/apps/redeploy-component/${appname}/${component}`;
          setJsonResource(resourceUri, {
            request: {
              appname,
              component,
              force: args.force === true ? true : null,
              timeoutMs: typeof args.timeoutMs === 'number' ? args.timeoutMs : null,
            },
            response: { ok: true, status: 200 },
            parsed: {
              events: ['component: stopping api', 'error: component restart failed'],
              jsonObjects: [],
            },
          });

          return jsonResultWithResource(
            {
              ok: true,
              status: 200,
              appname,
              component,
              force: args.force === true ? true : null,
              eventCount: 2,
              events: ['component: stopping api', 'error: component restart failed'],
              resourceUri,
              nextActions: [{ tool: 'flux_apps_logs', arguments: { appname } }],
            },
            resourceUri,
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

  return { runtime, calls };
}

async function withTempStateDir<T>(run: () => Promise<T>) {
  const stateDir = await mkdtemp(join(tmpdir(), 'fluxos-cli-app-lifecycle-'));
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

describe.sequential('apps lifecycle and redeploy', () => {
  it('keeps confirmation explicit for lifecycle and redeploy mutations', async () => {
    await withTempStateDir(async () => {
      const { runtime } = createAppsLifecycleRuntime();

      const start = await invokeCli(['apps', 'start', 'demo-app', '--json'], runtime);
      expect(start.exitCode).toBe(4);
      expect(JSON.parse(start.stdout)).toMatchObject({
        ok: false,
        status: 'confirm_required',
      });

      const redeploy = await invokeCli(['apps', 'redeploy', 'demo-app', '--json'], runtime);
      expect(redeploy.exitCode).toBe(4);
      expect(JSON.parse(redeploy.stdout)).toMatchObject({
        ok: false,
        status: 'confirm_required',
      });
    });
  });

  it('preserves start, stop, and restart flags in confirmed lifecycle invocations', async () => {
    await withTempStateDir(async () => {
      const { runtime, calls } = createAppsLifecycleRuntime();

      const start = await invokeCli(['apps', 'start', 'demo-app', '--global', '--confirm', '--json'], runtime);
      expect(start.exitCode).toBe(0);
      expect(JSON.parse(start.stdout)).toMatchObject({
        ok: true,
        status: 'success',
        operation: 'start',
        appname: 'demo-app',
        global: true,
        httpStatus: 200,
        fluxStatus: 'success',
        message: 'Start accepted',
      });

      const stop = await invokeCli(['apps', 'stop', 'demo-app', '--confirm', '--json'], runtime);
      expect(stop.exitCode).toBe(0);
      expect(JSON.parse(stop.stdout)).toMatchObject({
        ok: true,
        status: 'success',
        operation: 'stop',
        appname: 'demo-app',
        global: false,
        httpStatus: 200,
        fluxStatus: 'success',
        message: 'Stop accepted',
      });

      const restart = await invokeCli(['apps', 'restart', '--appname', 'demo-app', '--global', '--confirm', '--json'], runtime);
      expect(restart.exitCode).toBe(0);
      expect(JSON.parse(restart.stdout)).toMatchObject({
        ok: true,
        status: 'success',
        operation: 'restart',
        appname: 'demo-app',
        global: true,
        httpStatus: 200,
        fluxStatus: 'success',
        message: 'Restart accepted',
      });

      expect(calls).toEqual([
        {
          name: 'flux_apps_start',
          args: { appname: 'demo-app', global: true, confirm: true },
        },
        {
          name: 'flux_apps_stop',
          args: { appname: 'demo-app', confirm: true },
        },
        {
          name: 'flux_apps_restart',
          args: { appname: 'demo-app', global: true, confirm: true },
        },
      ]);
    });
  });

  it('parses redeploy progress summaries and preserves force/global/timeout flags', async () => {
    await withTempStateDir(async () => {
      const { runtime, calls } = createAppsLifecycleRuntime();

      const redeploy = await invokeCli(
        ['apps', 'redeploy', 'demo-app', '--force', '--global', '--timeout-ms', '45000', '--confirm', '--json'],
        runtime,
      );

      expect(redeploy.exitCode).toBe(0);
      expect(JSON.parse(redeploy.stdout)).toMatchObject({
        ok: true,
        status: 'success',
        operation: 'redeploy',
        appname: 'demo-app',
        force: true,
        global: true,
        timeoutMs: 45000,
        httpStatus: 200,
        semanticSource: 'json',
        semanticMessage: 'Redeploy complete',
        lastEvent: 'success: redeploy complete',
        resourceUri: 'flux://resource/apps/redeploy/demo-app',
      });

      expect(calls).toEqual([
        {
          name: 'flux_apps_redeploy',
          args: { appname: 'demo-app', force: true, global: true, timeoutMs: 45000, confirm: true },
        },
      ]);
    });
  });

  it('treats later redeploy error events as failures even when the last JSON object reports success', async () => {
    await withTempStateDir(async () => {
      const { runtime } = createAppsLifecycleRuntime();

      const result = await invokeCli(
        ['apps', 'redeploy', 'mixed-app', '--timeout-ms', '45000', '--confirm', '--json'],
        runtime,
      );

      expect(result.exitCode).toBe(6);
      expect(JSON.parse(result.stdout)).toMatchObject({
        ok: false,
        status: 'error',
        operation: 'redeploy',
        appname: 'mixed-app',
        timeoutMs: 45000,
        semanticSource: 'events',
        semanticMessage: 'error: container failed health check',
        lastEvent: 'error: container failed health check',
        resourceUri: 'flux://resource/apps/redeploy/mixed-app',
      });
    });
  });

  it('requires a component and reports event-derived failures for redeploy-component', async () => {
    await withTempStateDir(async () => {
      const invalidRuntime = createAppsLifecycleRuntime().runtime;
      const invalid = await invokeCli(['apps', 'redeploy-component', 'demo-app', '--json'], invalidRuntime);
      expect(invalid.exitCode).toBe(2);
      expect(JSON.parse(invalid.stdout)).toMatchObject({
        ok: false,
        status: 'validation_error',
      });

      const { runtime, calls } = createAppsLifecycleRuntime();
      const failure = await invokeCli(
        ['apps', 'redeploy-component', 'demo-app', '--component', 'api', '--force', '--timeout-ms', '15000', '--confirm', '--json'],
        runtime,
      );

      expect(failure.exitCode).toBe(6);
      expect(JSON.parse(failure.stdout)).toMatchObject({
        ok: false,
        status: 'error',
        operation: 'redeploy-component',
        appname: 'demo-app',
        component: 'api',
        force: true,
        timeoutMs: 15000,
        httpStatus: 200,
        semanticSource: 'events',
        semanticMessage: 'error: component restart failed',
        lastEvent: 'error: component restart failed',
        resourceUri: 'flux://resource/apps/redeploy-component/demo-app/api',
      });

      expect(calls).toEqual([
        {
          name: 'flux_apps_redeploy_component',
          args: { appname: 'demo-app', component: 'api', force: true, timeoutMs: 15000, confirm: true },
        },
      ]);
    });
  });
});
