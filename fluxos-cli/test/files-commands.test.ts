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
  const stateDir = await mkdtemp(join(tmpdir(), 'fluxos-cli-files-'));
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

describe.sequential('files commands', () => {
  let serverPort = 0;

  const server = createServer((req, res) => {
    const url = req.url ?? '';

    if (url.startsWith('/apps/getfolderinfo')) {
      return json(res, 200, {
        status: 'success',
        data: [
          {
            name: 'hello.txt',
            size: 5,
            isDirectory: false,
            isFile: true,
            isSymbolicLink: false,
            modifiedAt: '2020-01-01T00:00:00.000Z',
          },
        ],
      });
    }

    if (url.startsWith('/apps/downloadfile')) {
      const body = Buffer.from('hello', 'utf-8');
      res.statusCode = 200;
      res.setHeader('content-type', 'text/plain');
      res.setHeader('content-disposition', 'attachment; filename=hello.txt');
      res.setHeader('content-length', String(body.length));
      res.end(body);
      return;
    }

    if (url.startsWith('/apps/downloadfolder')) {
      const body = Buffer.from('zip', 'utf-8');
      res.statusCode = 200;
      res.setHeader('content-type', 'application/zip');
      res.setHeader('content-disposition', 'attachment; filename=folder.zip');
      res.setHeader('content-length', String(body.length));
      res.end(body);
      return;
    }

    if (url.startsWith('/apps/createfolder')) {
      return json(res, 200, { status: 'success', data: 'Folder Created' });
    }

    if (url.startsWith('/apps/renameobject')) {
      return json(res, 200, { status: 'success', data: 'Rename successful' });
    }

    if (url.startsWith('/apps/removeobject')) {
      return json(res, 200, { status: 'success', data: 'File Removed' });
    }

    return json(res, 404, { status: 'error', data: `Unhandled path: ${url}` });
  });

  beforeAll(async () => {
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Failed to bind files test server');
    serverPort = address.port;
  });

  afterAll(async () => {
    await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  });

  it('lists app volume entries in JSON mode', async () => {
    await withTempStateDir(async () => {
      await setBaseUrl(`http://127.0.0.1:${serverPort}`);
      const runtime = await createSourceFluxMcpRuntime();
      const capture = createCapture();

      const exitCode = await runCli(['files', 'list', '--appname', 'myapp', '--component', 'web', '--json'], {
        io: capture.io,
        toolRuntime: runtime,
        persistedStateMode: 'on',
      });

      expect(exitCode).toBe(0);
      const payload = JSON.parse(capture.getStdout()) as Record<string, unknown>;
      expect(payload.ok).toBe(true);
      expect(payload.status).toBe('ok');
      expect(payload.count).toBe(1);

      const items = payload.items as Array<Record<string, unknown>>;
      expect(items[0]?.name).toBe('hello.txt');
      expect(items[0]?.type).toBe('file');
    });
  });

  it('downloads a file as a resource-backed artifact', async () => {
    await withTempStateDir(async () => {
      await setBaseUrl(`http://127.0.0.1:${serverPort}`);
      const runtime = await createSourceFluxMcpRuntime();
      const capture = createCapture();

      const exitCode = await runCli(
        ['files', 'download', '--appname', 'myapp', '--component', 'web', '--file', 'hello.txt', '--pretty'],
        {
          io: capture.io,
          toolRuntime: runtime,
          persistedStateMode: 'on',
        }
      );

      expect(exitCode).toBe(0);
      expect(capture.getStdout()).toContain('Download file myapp/web');
      expect(capture.getStdout()).toContain('Bytes: 5');
      expect(capture.getStdout()).toContain('MIME type: text/plain');
      expect(capture.getStdout()).toContain('Resource URI: flux://resource/');
    });
  });

  it('downloads a folder as a zipped artifact when confirmed', async () => {
    await withTempStateDir(async () => {
      await setBaseUrl(`http://127.0.0.1:${serverPort}`);
      const runtime = await createSourceFluxMcpRuntime();
      const capture = createCapture();

      const exitCode = await runCli(
        ['files', 'download-folder', '--appname', 'myapp', '--component', 'web', '--folder', 'logs', '--confirm', '--json'],
        {
          io: capture.io,
          toolRuntime: runtime,
          persistedStateMode: 'on',
        }
      );

      expect(exitCode).toBe(0);
      const payload = JSON.parse(capture.getStdout()) as Record<string, unknown>;
      expect(payload.ok).toBe(true);
      expect(payload.mimeType).toBe('application/zip');
      expect(payload.bytes).toBe(3);
      expect(typeof payload.resourceUri).toBe('string');
    });
  });

  it('keeps confirm gating explicit for mkdir', async () => {
    await withTempStateDir(async () => {
      await setBaseUrl(`http://127.0.0.1:${serverPort}`);
      const runtime = await createSourceFluxMcpRuntime();
      const capture = createCapture();

      const exitCode = await runCli(['files', 'mkdir', '--appname', 'myapp', '--component', 'web', '--folder', 'logs', '--json'], {
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

  it('renames and removes app volume objects through the first-class surface', async () => {
    await withTempStateDir(async () => {
      await setBaseUrl(`http://127.0.0.1:${serverPort}`);
      const runtime = await createSourceFluxMcpRuntime();
      const renameCapture = createCapture();
      const removeCapture = createCapture();

      const renameExitCode = await runCli(
        [
          'files',
          'rename',
          '--appname',
          'myapp',
          '--component',
          'web',
          '--oldpath',
          'hello.txt',
          '--newname',
          'renamed.txt',
          '--confirm',
          '--json',
        ],
        {
          io: renameCapture.io,
          toolRuntime: runtime,
          persistedStateMode: 'on',
        }
      );

      expect(renameExitCode).toBe(0);
      const renamePayload = JSON.parse(renameCapture.getStdout()) as Record<string, unknown>;
      expect(renamePayload.ok).toBe(true);
      expect(renamePayload.status).toBe('success');
      expect(renamePayload.message).toBe('Rename successful');

      const removeExitCode = await runCli(
        ['files', 'remove', '--appname', 'myapp', '--component', 'web', '--object', 'renamed.txt', '--confirm', '--json'],
        {
          io: removeCapture.io,
          toolRuntime: runtime,
          persistedStateMode: 'on',
        }
      );

      expect(removeExitCode).toBe(0);
      const removePayload = JSON.parse(removeCapture.getStdout()) as Record<string, unknown>;
      expect(removePayload.ok).toBe(true);
      expect(removePayload.status).toBe('success');
      expect(removePayload.message).toBe('File Removed');
    });
  });
});
