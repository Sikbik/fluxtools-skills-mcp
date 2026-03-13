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

function jsonResultWithResource(
  payload: Record<string, unknown>,
  resourceUri: string,
  opts?: { isError?: boolean; mimeType?: string; text?: string }
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

function createAppsRuntimeDebugRuntime(): ToolRuntime {
  const resources = new Map<string, { text: string; mimeType: string }>();

  const setJsonResource = (uri: string, value: unknown) => {
    resources.set(uri, { text: JSON.stringify(value, null, 2), mimeType: 'application/json' });
  };

  const setTextResource = (uri: string, text: string, mimeType = 'text/plain') => {
    resources.set(uri, { text, mimeType });
  };

  const resolved = {
    baseUrl: 'http://127.0.0.1:16127',
    host: '127.0.0.1',
    apiPort: 16127,
    containerName: 'fluxdemo',
    previousBaseUrl: 'http://127.0.0.1:16117',
  };

  return {
    async listTools() {
      return [];
    },
    async callTool(name, rawArgs) {
      const args = rawArgs && typeof rawArgs === 'object' && !Array.isArray(rawArgs)
        ? (rawArgs as Record<string, unknown>)
        : {};
      const appname = typeof args.appname === 'string' ? args.appname : 'demo-app';

      switch (name) {
        case 'flux_app_health_report': {
          const inspectUri = 'flux://resource/apps/health/inspect';
          const statsUri = 'flux://resource/apps/health/stats';
          const topUri = 'flux://resource/apps/health/top';
          const monitorUri = 'flux://resource/apps/health/monitor';
          const logsUri = 'flux://resource/apps/health/logs';

          setJsonResource(inspectUri, createFluxRequestResult({
            Name: '/fluxdemo',
            Config: { Image: 'demo:latest' },
            State: { Status: 'running', Running: true, Health: { Status: 'healthy' } },
          }));
          setJsonResource(statsUri, createFluxRequestResult({
            memory_stats: { usage: 1024, limit: 2048 },
            networks: { eth0: { rx_bytes: 512, tx_bytes: 256 } },
            pids_stats: { current: 3 },
          }));
          setJsonResource(topUri, createFluxRequestResult({
            Titles: ['PID', 'CMD'],
            Processes: [['1', 'node server.js']],
          }));
          setJsonResource(monitorUri, createFluxRequestResult([
            { timestamp: 1700000000000, cpu: 0.2 },
            { timestamp: 1700000005000, cpu: 0.4 },
          ]));
          setJsonResource(logsUri, createFluxRequestResult('booting\nservice ready\nwarning: cache cold'));

          return {
            isError: false,
            structuredContent: {
              ok: true,
              appname,
              resolved: {
                ok: true,
                baseUrl: resolved.baseUrl,
                containerName: resolved.containerName,
                candidates: [{ host: resolved.host, apiPort: resolved.apiPort, baseUrl: resolved.baseUrl }],
              },
              inspect: { ok: true, status: 200 },
              stats: { ok: true, status: 200 },
              top: { ok: true, status: 200 },
              monitor: { ok: true, status: 200 },
              logs: { ok: false, status: 200 },
              resources: {
                inspect: inspectUri,
                stats: statsUri,
                top: topUri,
                monitor: monitorUri,
                logs: logsUri,
              },
              nextActions: [{ tool: 'flux_resource_read', arguments: { uri: logsUri } }],
            },
            content: [
              { type: 'text', text: JSON.stringify({ ok: true, appname }, null, 2) },
              { type: 'resource_link', uri: inspectUri, name: inspectUri, mimeType: 'application/json' },
              { type: 'resource_link', uri: statsUri, name: statsUri, mimeType: 'application/json' },
              { type: 'resource_link', uri: topUri, name: topUri, mimeType: 'application/json' },
              { type: 'resource_link', uri: monitorUri, name: monitorUri, mimeType: 'application/json' },
              { type: 'resource_link', uri: logsUri, name: logsUri, mimeType: 'application/json' },
            ],
          };
        }
        case 'flux_apps_logs': {
          const resourceUri = 'flux://resource/apps/logs/demo';
          setJsonResource(resourceUri, createFluxRequestResult('line 1\nline 2\nline 3\nline 4'));
          return jsonResultWithResource({
            ok: true,
            status: 200,
            appname,
            target: resolved.containerName,
            resolved,
            lines: typeof args.lines === 'string' ? args.lines : 'all',
            preview: ['line 2', 'line 3', 'line 4'],
            resourceUri,
            nextActions: [{ tool: 'flux_apps_inspect', arguments: { appname } }],
          }, resourceUri);
        }
        case 'flux_apps_inspect': {
          const resourceUri = 'flux://resource/apps/inspect/demo';
          setJsonResource(resourceUri, createFluxRequestResult({
            Name: '/fluxdemo',
            Config: { Image: 'demo:latest' },
            State: { Status: 'running', Running: true, Health: { Status: 'healthy' } },
          }));
          return jsonResultWithResource({
            ok: true,
            status: 200,
            appname,
            target: resolved.containerName,
            resolved,
            resourceUri,
          }, resourceUri);
        }
        case 'flux_apps_stats': {
          const resourceUri = 'flux://resource/apps/stats/demo';
          setJsonResource(resourceUri, createFluxRequestResult({
            memory_stats: { usage: 1024, limit: 4096 },
            networks: { eth0: { rx_bytes: 600, tx_bytes: 200 } },
            pids_stats: { current: 5 },
          }));
          return jsonResultWithResource({
            ok: true,
            status: 200,
            appname,
            target: resolved.containerName,
            resolved,
            resourceUri,
          }, resourceUri);
        }
        case 'flux_apps_top': {
          const resourceUri = 'flux://resource/apps/top/demo';
          setJsonResource(resourceUri, createFluxRequestResult({
            Titles: ['PID', 'CMD'],
            Processes: [
              ['1', 'node server.js'],
              ['8', 'sleep 1'],
            ],
          }));
          return jsonResultWithResource({
            ok: true,
            status: 200,
            appname,
            target: resolved.containerName,
            resolved,
            resourceUri,
          }, resourceUri);
        }
        case 'flux_apps_monitor': {
          const resourceUri = 'flux://resource/apps/monitor/demo';
          setJsonResource(resourceUri, createFluxRequestResult([
            { timestamp: 1700000000000, cpu: 0.2 },
            { timestamp: 1700000005000, cpu: 0.4 },
            { timestamp: 1700000010000, cpu: 0.1 },
          ]));
          return jsonResultWithResource({
            ok: true,
            status: 200,
            appname,
            target: resolved.containerName,
            resolved,
            range: typeof args.range === 'number' ? args.range : null,
            resourceUri,
          }, resourceUri);
        }
        case 'flux_apps_exec': {
          if (args.confirm !== true) {
            throw new Error('confirm=true is required for apps/appexec');
          }

          const resourceUri = `flux://resource/apps/exec/${typeof args.appname === 'string' ? args.appname : 'demo-app'}`;
          const cmd = Array.isArray(args.cmd) ? args.cmd : [];
          const env = Array.isArray(args.env) ? args.env : [];

          if (args.appname === 'denied') {
            setTextResource(resourceUri, JSON.stringify({ status: 'error', data: 'Permission denied' }, null, 2));
            return jsonResultWithResource(
              {
                ok: false,
                status: 200,
                appname: 'denied',
                target: resolved.containerName,
                resolved,
                cmd,
                envCount: env.length,
                fluxOk: false,
                error: 'Permission denied',
                resourceUri,
              },
              resourceUri,
              { isError: true, mimeType: 'text/plain' }
            );
          }

          setTextResource(
            resourceUri,
            JSON.stringify({ status: 'success', data: { stdout: 'uid=1000(flux)\n', stderr: '' } }, null, 2)
          );
          return jsonResultWithResource(
            {
              ok: true,
              status: 200,
              appname,
              target: resolved.containerName,
              resolved,
              cmd,
              envCount: env.length,
              fluxOk: true,
              resourceUri,
            },
            resourceUri,
            { mimeType: 'text/plain' }
          );
        }
        case 'flux_apps_test_install': {
          if (args.confirm !== true) {
            throw new Error('confirm=true is required for apps/testappinstall');
          }

          const hash = typeof args.hash === 'string' ? args.hash : 'good-hash';
          const resourceUri = `flux://resource/apps/test-install/${hash}`;

          if (hash === 'bad-hash') {
            setJsonResource(resourceUri, {
              request: { hash },
              response: { ok: true, status: 200 },
              parsed: {
                events: ['pulling image', 'error: image pull failed'],
                jsonObjects: [{ status: 'error', data: { message: 'Image pull failed' } }],
              },
            });
            return jsonResultWithResource(
              {
                ok: false,
                httpStatus: 200,
                hash,
                timeoutMs: 120000,
                eventCount: 2,
                events: ['pulling image', 'error: image pull failed'],
                resourceUri,
                nextActions: [{ tool: 'flux_resource_read', arguments: { uri: resourceUri } }],
              },
              resourceUri,
              { isError: true }
            );
          }

          setJsonResource(resourceUri, {
            request: { hash },
            response: { ok: true, status: 200 },
            parsed: {
              events: ['pulling image', 'success: Installed'],
              jsonObjects: [{ status: 'success', data: { message: 'Installed' } }],
            },
          });
          return jsonResultWithResource(
            {
              ok: false,
              httpStatus: 200,
              hash,
              timeoutMs: 120000,
              eventCount: 2,
              events: ['pulling image', 'success: Installed'],
              resourceUri,
              nextActions: [{ tool: 'flux_resource_read', arguments: { uri: resourceUri } }],
            },
            resourceUri,
            { isError: true }
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
  const stateDir = await mkdtemp(join(tmpdir(), 'fluxos-cli-app-runtime-'));
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

describe.sequential('apps runtime debug, exec, and test-install', () => {
  it('returns explicit health summaries and resource-backed observability handles', async () => {
    await withTempStateDir(async () => {
      const runtime = createAppsRuntimeDebugRuntime();
      const result = await invokeCli(['apps', 'health', '--appname', 'demo-app', '--json'], runtime);

      expect(result.exitCode).toBe(0);
      expect(JSON.parse(result.stdout)).toMatchObject({
        ok: true,
        appname: 'demo-app',
        status: 'degraded',
        health: {
          overallStatus: 'degraded',
          totalChecks: 5,
          passedChecks: 4,
          failedChecks: ['logs'],
        },
        checks: {
          inspect: { ok: true, status: 200 },
          logs: { ok: false, status: 200 },
        },
        resources: {
          inspect: 'flux://resource/apps/health/inspect',
          logs: 'flux://resource/apps/health/logs',
        },
      });
    });
  });

  it('returns resource-backed summaries for logs, inspect, stats, top, and monitor', async () => {
    await withTempStateDir(async () => {
      const runtime = createAppsRuntimeDebugRuntime();

      const logs = await invokeCli(['apps', 'logs', 'demo-app', '--lines', '25', '--json'], runtime);
      expect(logs.exitCode).toBe(0);
      expect(JSON.parse(logs.stdout)).toMatchObject({
        ok: true,
        status: 'available',
        appname: 'demo-app',
        target: 'fluxdemo',
        totalLineCount: 4,
        previewLineCount: 3,
        resourceUri: 'flux://resource/apps/logs/demo',
      });

      const inspect = await invokeCli(['apps', 'inspect', 'demo-app', '--json'], runtime);
      expect(inspect.exitCode).toBe(0);
      expect(JSON.parse(inspect.stdout)).toMatchObject({
        ok: true,
        status: 'available',
        inspectSummary: {
          containerName: 'fluxdemo',
          image: 'demo:latest',
          stateStatus: 'running',
          healthStatus: 'healthy',
        },
      });

      const stats = await invokeCli(['apps', 'stats', 'demo-app', '--json'], runtime);
      expect(stats.exitCode).toBe(0);
      expect(JSON.parse(stats.stdout)).toMatchObject({
        ok: true,
        status: 'available',
        statsSummary: {
          memoryUsageBytes: 1024,
          memoryLimitBytes: 4096,
          networkRxBytes: 600,
          networkTxBytes: 200,
          pidCount: 5,
        },
      });

      const top = await invokeCli(['apps', 'top', 'demo-app', '--json'], runtime);
      expect(top.exitCode).toBe(0);
      expect(JSON.parse(top.stdout)).toMatchObject({
        ok: true,
        status: 'available',
        topSummary: {
          processCount: 2,
          columnCount: 2,
          firstCommand: 'node server.js',
        },
      });

      const monitor = await invokeCli(['apps', 'monitor', 'demo-app', '--range', '120000', '--json'], runtime);
      expect(monitor.exitCode).toBe(0);
      expect(JSON.parse(monitor.stdout)).toMatchObject({
        ok: true,
        status: 'available',
        range: 120000,
        monitorSummary: {
          pointCount: 3,
          firstTimestamp: 1700000000000,
          lastTimestamp: 1700000010000,
        },
      });
    });
  });

  it('keeps exec confirmation explicit and returns an explicit execution status', async () => {
    await withTempStateDir(async () => {
      const runtime = createAppsRuntimeDebugRuntime();

      const missingConfirm = await invokeCli(['apps', 'exec', 'demo-app', '--cmd', 'echo', '--cmd', 'hi', '--json'], runtime);
      expect(missingConfirm.exitCode).toBe(4);
      expect(JSON.parse(missingConfirm.stdout)).toMatchObject({
        ok: false,
        status: 'confirm_required',
      });

      const success = await invokeCli(
        ['apps', 'exec', 'demo-app', '--cmd', 'echo', '--cmd', 'hi', '--env', 'MODE=test', '--confirm', '--json'],
        runtime
      );
      expect(success.exitCode).toBe(0);
      expect(JSON.parse(success.stdout)).toMatchObject({
        ok: true,
        status: 'success',
        httpStatus: 200,
        cmd: ['echo', 'hi'],
        envCount: 1,
        outputSummary: {
          parsedJson: true,
          stdoutPreview: 'uid=1000(flux)',
        },
        resourceUri: 'flux://resource/apps/exec/demo-app',
      });
    });
  });

  it('derives test-install success and failure from semantic progress output', async () => {
    await withTempStateDir(async () => {
      const runtime = createAppsRuntimeDebugRuntime();

      const success = await invokeCli(['apps', 'test-install', 'good-hash', '--confirm', '--json'], runtime);
      expect(success.exitCode).toBe(0);
      expect(JSON.parse(success.stdout)).toMatchObject({
        ok: true,
        status: 'success',
        semanticSource: 'json',
        httpStatus: 200,
        hash: 'good-hash',
        lastEvent: 'success: Installed',
        resourceUri: 'flux://resource/apps/test-install/good-hash',
      });

      const failure = await invokeCli(['apps', 'test-install', 'bad-hash', '--confirm', '--json'], runtime);
      expect(failure.exitCode).toBe(6);
      expect(JSON.parse(failure.stdout)).toMatchObject({
        ok: false,
        status: 'error',
        semanticSource: 'json',
        hash: 'bad-hash',
        lastEvent: 'error: image pull failed',
        resourceUri: 'flux://resource/apps/test-install/bad-hash',
      });
    });
  });
});
