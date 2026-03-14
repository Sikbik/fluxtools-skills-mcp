import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { runCli, type ToolRuntime } from '../src/cli.js';

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
  const stateDir = await mkdtemp(join(tmpdir(), 'fluxos-cli-fluxdrive-'));
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

async function setFluxDriveBaseUrl(baseUrl: string) {
  const capture = createCapture();
  const exitCode = await runCli(['fluxdrive', 'set-base-url', baseUrl, '--json'], { io: capture.io });
  expect(exitCode).toBe(0);
  expect(capture.getStderr()).toBe('');
}

describe.sequential('fluxdrive commands', () => {
  let serverPort = 0;

  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');

    if (url.pathname === '/registerbackupfile') {
      const bodyRaw = await readBody(req);
      const body = bodyRaw ? (JSON.parse(bodyRaw) as Record<string, unknown>) : {};
      return json(res, 200, { status: 'success', data: { taskId: 42, queued: true, request: body } });
    }

    if (url.pathname === '/gettaskstatus') {
      return json(res, 200, { status: 'success', data: { taskId: Number(url.searchParams.get('taskId')), state: 'done' } });
    }

    if (url.pathname === '/getbackuplist') {
      return json(res, 200, {
        status: 'success',
        data: [{ appname: url.searchParams.get('appname'), timestamp: 1700000000000, files: ['a.tar.gz'] }],
      });
    }

    if (url.pathname === '/removeCheckpoint') {
      const bodyRaw = await readBody(req);
      const body = bodyRaw ? (JSON.parse(bodyRaw) as Record<string, unknown>) : {};
      return json(res, 200, { status: 'success', data: { removed: true, request: body } });
    }

    return json(res, 404, { status: 'error', data: `Unhandled path: ${url.pathname}` });
  });

  beforeAll(async () => {
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Failed to bind FluxDrive test server');
    serverPort = address.port;
  });

  afterAll(async () => {
    await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  });

  it('persists the FluxDrive base URL through the first-class command', async () => {
    await withTempStateDir(async () => {
      const baseUrl = `http://127.0.0.1:${serverPort}`;
      const capture = createCapture();

      const exitCode = await runCli(['fluxdrive', 'set-base-url', baseUrl, '--json'], { io: capture.io });

      expect(exitCode).toBe(0);
      const payload = JSON.parse(capture.getStdout()) as Record<string, unknown>;
      expect(payload.ok).toBe(true);
      expect(payload.fluxDriveMwsBaseUrl).toBe(baseUrl);
    });
  });

  it('registers a backup file through the persisted FluxDrive base URL', async () => {
    await withTempStateDir(async () => {
      const baseUrl = `http://127.0.0.1:${serverPort}`;
      await setFluxDriveBaseUrl(baseUrl);
      const runtime = await createSourceFluxMcpRuntime();
      const capture = createCapture();

      const exitCode = await runCli(
        [
          'fluxdrive',
          'register-backup-file',
          '--appname',
          'myapp',
          '--component',
          'web',
          '--filename',
          'a.tar.gz',
          '--filesize',
          '10',
          '--host',
          'node-1',
          '--timestamp',
          '1700000000000',
          '--json',
        ],
        {
          io: capture.io,
          toolRuntime: runtime,
          persistedStateMode: 'on',
        }
      );

      expect(exitCode).toBe(0);
      const payload = JSON.parse(capture.getStdout()) as Record<string, unknown>;
      expect(payload.ok).toBe(true);

      const data = payload.data as Record<string, unknown>;
      expect(data.taskId).toBe(42);
      expect(data.queued).toBe(true);
    });
  });

  it('reads FluxDrive task status through the first-class command', async () => {
    await withTempStateDir(async () => {
      const baseUrl = `http://127.0.0.1:${serverPort}`;
      await setFluxDriveBaseUrl(baseUrl);
      const runtime = await createSourceFluxMcpRuntime();
      const capture = createCapture();

      const exitCode = await runCli(['fluxdrive', 'task-status', '42', '--pretty'], {
        io: capture.io,
        toolRuntime: runtime,
        persistedStateMode: 'on',
      });

      expect(exitCode).toBe(0);
      expect(capture.getStdout()).toContain('FluxDrive task status');
      expect(capture.getStdout()).toContain('Task ID: 42');
      expect(capture.getStdout()).toContain('done');
    });
  });

  it('reads the FluxDrive backup list', async () => {
    await withTempStateDir(async () => {
      const baseUrl = `http://127.0.0.1:${serverPort}`;
      await setFluxDriveBaseUrl(baseUrl);
      const runtime = await createSourceFluxMcpRuntime();
      const capture = createCapture();

      const exitCode = await runCli(['fluxdrive', 'backup-list', 'myapp', '--json'], {
        io: capture.io,
        toolRuntime: runtime,
        persistedStateMode: 'on',
      });

      expect(exitCode).toBe(0);
      const payload = JSON.parse(capture.getStdout()) as Record<string, unknown>;
      expect(payload.ok).toBe(true);
      expect(payload.appname).toBe('myapp');

      const data = payload.data as Array<Record<string, unknown>>;
      expect(data[0]?.appname).toBe('myapp');
    });
  });

  it('removes a FluxDrive checkpoint', async () => {
    await withTempStateDir(async () => {
      const baseUrl = `http://127.0.0.1:${serverPort}`;
      await setFluxDriveBaseUrl(baseUrl);
      const runtime = await createSourceFluxMcpRuntime();
      const capture = createCapture();

      const exitCode = await runCli(
        ['fluxdrive', 'remove-checkpoint', '--appname', 'myapp', '--timestamp', '1700000000000', '--json'],
        {
          io: capture.io,
          toolRuntime: runtime,
          persistedStateMode: 'on',
        }
      );

      expect(exitCode).toBe(0);
      const payload = JSON.parse(capture.getStdout()) as Record<string, unknown>;
      expect(payload.ok).toBe(true);

      const data = payload.data as Record<string, unknown>;
      expect(data.removed).toBe(true);
    });
  });
});
