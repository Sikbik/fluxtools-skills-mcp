import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { EXIT_CODE_CONFIRM, runCli, type ToolRuntime } from '../src/cli.js';

function json(res: ServerResponse, status: number, body: unknown) {
  res.statusCode = status;
  res.setHeader('content-type', 'application/json');
  res.end(JSON.stringify(body));
}

function readBody(req: IncomingMessage) {
  return new Promise<string>((resolve) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
  });
}

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

async function withTempStateDir<T>(run: () => Promise<T>) {
  const stateDir = await mkdtemp(join(tmpdir(), 'fluxos-cli-syncthing-'));
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

async function createSourceFluxMcpRuntime(): Promise<ToolRuntime> {
  const module = await import('../../flux-mcp/src/index.ts');

  return {
    async listTools() {
      return module.tools.map((tool) => ({
        name: tool.name,
        description: tool.description,
        inputSchema: tool.inputSchema,
      }));
    },
    async callTool(name, rawArgs) {
      const result = await module.callTool(name, rawArgs);
      return {
        isError: result.isError,
        structuredContent: result.structuredContent,
        content: result.content.map((item) => ({ ...item })),
      };
    },
    async readResource(uri) {
      const result = await module.callTool('flux_resource_read', { uri });
      if (result.isError) return null;

      const textItem = result.content.find((item) => item.type === 'text' && typeof item.text === 'string');
      const structured = result.structuredContent;
      const mimeType =
        structured && typeof structured === 'object' && !Array.isArray(structured) && typeof structured.mimeType === 'string'
          ? structured.mimeType
          : undefined;

      if (!textItem || typeof textItem.text !== 'string') return null;
      return { uri, mimeType, text: textItem.text };
    },
    async hydrateResource(resource) {
      await module.hydrateResource(resource);
    },
    async setLauncherKeepAlive(keepAlive) {
      module.setLocalLauncherKeepAlive(keepAlive);
    },
    async getLauncherDebugState() {
      return module.__getLocalLauncherDebugState();
    },
    async closeLocalLaunchersForTests() {
      await module.__closeLocalLaunchersForTests();
    },
  };
}

async function setBaseUrl(baseUrl: string) {
  const capture = createCapture();
  const exitCode = await runCli(['node', 'use-base-url', baseUrl, '--json'], { io: capture.io });
  expect(exitCode).toBe(0);
  expect(capture.getStderr()).toBe('');
}

describe.sequential('syncthing commands', () => {
  let serverPort = 0;

  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');

    if (url.pathname === '/syncthing/metrics') {
      return json(res, 200, { status: 'success', data: { cpuPercent: 1, memBytes: 1024 } });
    }

    if (url.pathname === '/syncthing/metrics/health') {
      return json(res, 200, { status: 'success', data: { ok: true, message: 'healthy' } });
    }

    if (url.pathname === '/syncthing/system/status') {
      return json(res, 200, { status: 'success', data: { myID: 'ABC', guiAddressUsed: '127.0.0.1:8384' } });
    }

    if (url.pathname === '/syncthing/config/folders') {
      return json(res, 200, {
        status: 'success',
        data: [{ id: 'default', label: 'Default', path: '/data', type: 'sendreceive', rescanIntervalS: 60 }],
      });
    }

    if (url.pathname === '/syncthing/config/devices') {
      return json(res, 200, {
        status: 'success',
        data: [{ name: 'node-1', deviceID: 'DEV1', addresses: ['dynamic'], introducer: false, paused: false }],
      });
    }

    if (url.pathname === '/syncthing/db/browse/default') {
      return json(res, 200, { status: 'success', data: { prefix: url.searchParams.get('prefix'), children: [{ name: 'foo.txt' }] } });
    }

    if (url.pathname === '/syncthing/db/scan') {
      await readBody(req);
      return json(res, 200, { status: 'success', data: { queued: true } });
    }

    if (url.pathname === '/syncthing/system/restart') {
      return json(res, 200, { status: 'success', data: 'restarting' });
    }

    return json(res, 404, { status: 'error', data: `Unhandled path: ${url.pathname}` });
  });

  beforeAll(async () => {
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Failed to bind Syncthing test server');
    serverPort = address.port;
  });

  afterAll(async () => {
    await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  });

  it('reads Syncthing metrics and health through the first-class surface', async () => {
    await withTempStateDir(async () => {
      await setBaseUrl(`http://127.0.0.1:${serverPort}`);
      const runtime = await createSourceFluxMcpRuntime();
      const metricsCapture = createCapture();
      const healthCapture = createCapture();

      const metricsExitCode = await runCli(['syncthing', 'metrics', '--json'], {
        io: metricsCapture.io,
        toolRuntime: runtime,
        persistedStateMode: 'on',
      });

      expect(metricsExitCode).toBe(0);
      const metricsPayload = JSON.parse(metricsCapture.getStdout()) as Record<string, unknown>;
      expect(metricsPayload.ok).toBe(true);
      expect((metricsPayload.data as Record<string, unknown>).cpuPercent).toBe(1);

      const healthExitCode = await runCli(['syncthing', 'metrics-health', '--json'], {
        io: healthCapture.io,
        toolRuntime: runtime,
        persistedStateMode: 'on',
      });

      expect(healthExitCode).toBe(0);
      const healthPayload = JSON.parse(healthCapture.getStdout()) as Record<string, unknown>;
      expect(healthPayload.ok).toBe(true);
      expect((healthPayload.data as Record<string, unknown>).message).toBe('healthy');
    });
  });

  it('lists Syncthing folders and devices', async () => {
    await withTempStateDir(async () => {
      await setBaseUrl(`http://127.0.0.1:${serverPort}`);
      const runtime = await createSourceFluxMcpRuntime();
      const foldersCapture = createCapture();
      const devicesCapture = createCapture();

      const foldersExitCode = await runCli(['syncthing', 'list-folders', '--pretty'], {
        io: foldersCapture.io,
        toolRuntime: runtime,
        persistedStateMode: 'on',
      });

      expect(foldersExitCode).toBe(0);
      expect(foldersCapture.getStdout()).toContain('Syncthing folders');
      expect(foldersCapture.getStdout()).toContain('default');

      const devicesExitCode = await runCli(['syncthing', 'list-devices', '--json'], {
        io: devicesCapture.io,
        toolRuntime: runtime,
        persistedStateMode: 'on',
      });

      expect(devicesExitCode).toBe(0);
      const devicesPayload = JSON.parse(devicesCapture.getStdout()) as Record<string, unknown>;
      expect(devicesPayload.ok).toBe(true);
      expect(devicesPayload.count).toBe(1);
    });
  });

  it('reads Syncthing system status and db browse payloads', async () => {
    await withTempStateDir(async () => {
      await setBaseUrl(`http://127.0.0.1:${serverPort}`);
      const runtime = await createSourceFluxMcpRuntime();
      const statusCapture = createCapture();
      const browseCapture = createCapture();

      const statusExitCode = await runCli(['syncthing', 'system-status', '--json'], {
        io: statusCapture.io,
        toolRuntime: runtime,
        persistedStateMode: 'on',
      });

      expect(statusExitCode).toBe(0);
      const statusPayload = JSON.parse(statusCapture.getStdout()) as Record<string, unknown>;
      expect((statusPayload.data as Record<string, unknown>).myID).toBe('ABC');

      const browseExitCode = await runCli(['syncthing', 'db-browse', 'default', '--levels', '1', '--prefix', 'foo', '--json'], {
        io: browseCapture.io,
        toolRuntime: runtime,
        persistedStateMode: 'on',
      });

      expect(browseExitCode).toBe(0);
      const browsePayload = JSON.parse(browseCapture.getStdout()) as Record<string, unknown>;
      expect(browsePayload.folder).toBe('default');
      expect(((browsePayload.data as Record<string, unknown>).children as Array<Record<string, unknown>>)[0]?.name).toBe('foo.txt');
    });
  });

  it('keeps confirm gating explicit for syncthing db-scan', async () => {
    await withTempStateDir(async () => {
      await setBaseUrl(`http://127.0.0.1:${serverPort}`);
      const runtime = await createSourceFluxMcpRuntime();
      const capture = createCapture();

      const exitCode = await runCli(['syncthing', 'db-scan', 'default', '--json'], {
        io: capture.io,
        toolRuntime: runtime,
        persistedStateMode: 'on',
      });

      expect(exitCode).toBe(EXIT_CODE_CONFIRM);
      const payload = JSON.parse(capture.getStdout()) as Record<string, unknown>;
      expect(payload.ok).toBe(false);
      expect(payload.status).toBe('confirm_required');
    });
  });

  it('triggers syncthing db-scan and restart when confirmed', async () => {
    await withTempStateDir(async () => {
      await setBaseUrl(`http://127.0.0.1:${serverPort}`);
      const runtime = await createSourceFluxMcpRuntime();
      const scanCapture = createCapture();
      const restartCapture = createCapture();

      const scanExitCode = await runCli(['syncthing', 'db-scan', 'default', '--sub', 'foo', '--confirm', '--json'], {
        io: scanCapture.io,
        toolRuntime: runtime,
        persistedStateMode: 'on',
      });

      expect(scanExitCode).toBe(0);
      const scanPayload = JSON.parse(scanCapture.getStdout()) as Record<string, unknown>;
      expect(scanPayload.ok).toBe(true);
      expect(scanPayload.status).toBe('success');
      expect((scanPayload.data as Record<string, unknown>).queued).toBe(true);

      const restartExitCode = await runCli(['syncthing', 'restart', '--confirm', '--json'], {
        io: restartCapture.io,
        toolRuntime: runtime,
        persistedStateMode: 'on',
      });

      expect(restartExitCode).toBe(0);
      const restartPayload = JSON.parse(restartCapture.getStdout()) as Record<string, unknown>;
      expect(restartPayload.ok).toBe(true);
      expect(restartPayload.status).toBe('success');
      expect(restartPayload.data).toBe('restarting');
    });
  });
});
