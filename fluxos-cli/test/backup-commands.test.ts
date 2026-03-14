import { createServer, type ServerResponse } from 'node:http';
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
  const stateDir = await mkdtemp(join(tmpdir(), 'fluxos-cli-backup-'));
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

describe.sequential('backup commands', () => {
  let serverPort = 0;

  const server = createServer((req, res) => {
    const url = req.url ?? '';

    if (url.startsWith('/backup/getvolumedataofcomponent/')) {
      return json(res, 200, { status: 'success', data: { mount: '/data', used: 1, available: 2, size: 3 } });
    }

    if (url.startsWith('/backup/getremotefilesize/')) {
      return json(res, 200, { status: 'success', data: '10.00 MB' });
    }

    if (url.startsWith('/backup/getlocalbackuplist/')) {
      return json(res, 200, {
        status: 'success',
        data: [
          { name: 'a.tar.gz', size: '10.00 MB', create: 1700000000000 },
          { name: 'b.tar.gz', size: '20.00 MB', create: 1700000001000 },
        ],
      });
    }

    if (url.startsWith('/backup/removebackupfile/')) {
      return json(res, 200, { status: 'success', data: 'removed' });
    }

    if (url.startsWith('/backup/downloadlocalfile/')) {
      const body = Buffer.from('backup', 'utf-8');
      res.statusCode = 200;
      res.setHeader('content-type', 'application/gzip');
      res.setHeader('content-disposition', 'attachment; filename=backup.tar.gz');
      res.setHeader('content-length', String(body.length));
      res.end(body);
      return;
    }

    return json(res, 404, { status: 'error', data: `Unhandled path: ${url}` });
  });

  beforeAll(async () => {
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Failed to bind backup test server');
    serverPort = address.port;
  });

  afterAll(async () => {
    await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  });

  it('returns backup volume data in JSON mode', async () => {
    await withTempStateDir(async () => {
      await setBaseUrl(`http://127.0.0.1:${serverPort}`);
      const runtime = await createSourceFluxMcpRuntime();
      const capture = createCapture();

      const exitCode = await runCli(['backup', 'volume-data', '--appname', 'myapp', '--component', 'web', '--json'], {
        io: capture.io,
        toolRuntime: runtime,
        persistedStateMode: 'on',
      });

      expect(exitCode).toBe(0);
      const payload = JSON.parse(capture.getStdout()) as Record<string, unknown>;
      expect(payload.ok).toBe(true);
      expect(payload.mount).toBe('/data');
      expect(typeof payload.resourceUri).toBe('string');
    });
  });

  it('renders remote backup size in pretty mode', async () => {
    await withTempStateDir(async () => {
      await setBaseUrl(`http://127.0.0.1:${serverPort}`);
      const runtime = await createSourceFluxMcpRuntime();
      const capture = createCapture();

      const exitCode = await runCli(
        ['backup', 'remote-size', '--fileurl', 'https://example.com/file.tar.gz', '--appname', 'myapp', '--pretty'],
        {
          io: capture.io,
          toolRuntime: runtime,
          persistedStateMode: 'on',
        }
      );

      expect(exitCode).toBe(0);
      expect(capture.getStdout()).toContain('Backup remote size myapp');
      expect(capture.getStdout()).toContain('10.00 MB');
    });
  });

  it('lists local backup files in JSON mode', async () => {
    await withTempStateDir(async () => {
      await setBaseUrl(`http://127.0.0.1:${serverPort}`);
      const runtime = await createSourceFluxMcpRuntime();
      const capture = createCapture();

      const exitCode = await runCli(['backup', 'list-local', '--path', 'somepath', '--appname', 'myapp', '--json'], {
        io: capture.io,
        toolRuntime: runtime,
        persistedStateMode: 'on',
      });

      expect(exitCode).toBe(0);
      const payload = JSON.parse(capture.getStdout()) as Record<string, unknown>;
      expect(payload.ok).toBe(true);
      expect(payload.count).toBe(2);

      const items = payload.items as Array<Record<string, unknown>>;
      expect(items[0]?.name).toBe('a.tar.gz');
    });
  });

  it('keeps confirm gating explicit for backup remove-file', async () => {
    await withTempStateDir(async () => {
      await setBaseUrl(`http://127.0.0.1:${serverPort}`);
      const runtime = await createSourceFluxMcpRuntime();
      const capture = createCapture();

      const exitCode = await runCli(['backup', 'remove-file', '--filepath', 'x', '--appname', 'myapp', '--json'], {
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

  it('removes a backup file and surfaces the shared success message', async () => {
    await withTempStateDir(async () => {
      await setBaseUrl(`http://127.0.0.1:${serverPort}`);
      const runtime = await createSourceFluxMcpRuntime();
      const capture = createCapture();

      const exitCode = await runCli(['backup', 'remove-file', '--filepath', 'x', '--appname', 'myapp', '--confirm', '--json'], {
        io: capture.io,
        toolRuntime: runtime,
        persistedStateMode: 'on',
      });

      expect(exitCode).toBe(0);
      const payload = JSON.parse(capture.getStdout()) as Record<string, unknown>;
      expect(payload.ok).toBe(true);
      expect(payload.status).toBe('success');
      expect(payload.message).toBe('removed');
    });
  });

  it('downloads a local backup file as a resource-backed artifact', async () => {
    await withTempStateDir(async () => {
      await setBaseUrl(`http://127.0.0.1:${serverPort}`);
      const runtime = await createSourceFluxMcpRuntime();
      const capture = createCapture();

      const exitCode = await runCli(['backup', 'download-local', '--filepath', 'x', '--appname', 'myapp', '--confirm', '--json'], {
        io: capture.io,
        toolRuntime: runtime,
        persistedStateMode: 'on',
      });

      expect(exitCode).toBe(0);
      const payload = JSON.parse(capture.getStdout()) as Record<string, unknown>;
      expect(payload.ok).toBe(true);
      expect(payload.bytes).toBe(6);
      expect(payload.mimeType).toBe('application/gzip');
      expect(typeof payload.resourceUri).toBe('string');
    });
  });
});
