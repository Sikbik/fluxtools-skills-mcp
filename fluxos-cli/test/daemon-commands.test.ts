import { createServer, type ServerResponse } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { EXIT_CODE_FLUX_FAILURE, runCli, type ToolRuntime } from '../src/cli.js';

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
  const stateDir = await mkdtemp(join(tmpdir(), 'fluxos-cli-daemon-'));
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

describe.sequential('daemon commands', () => {
  const seen: string[] = [];
  let serverPort = 0;

  const server = createServer((req, res) => {
    const url = req.url ?? '';
    seen.push(url);

    if (url === '/daemon/getinfo') {
      return json(res, 200, { status: 'success', data: { version: 1, secret: 'abc', rawtxhex: 'f'.repeat(200) } });
    }

    if (url === '/daemon/getblockchaininfo') {
      return json(res, 200, { status: 'success', data: { blocks: 123456, headers: 123460 } });
    }

    if (url === '/daemon/getnetworkinfo') {
      return json(res, 200, { status: 'success', data: { version: 190100, connections: 8 } });
    }

    if (url === '/daemon/getpeerinfo') {
      return json(res, 200, {
        status: 'success',
        data: [{ addr: '1.2.3.4:16125', inbound: false, pingtime: 0.12, subver: '/Satoshi:0.21.0/' }],
      });
    }

    if (url === '/daemon/getmempoolinfo') {
      return json(res, 200, { status: 'success', data: { size: 2, bytes: 100 } });
    }

    if (url === '/daemon/getrawmempool') {
      return json(res, 200, { status: 'success', data: ['tx1', 'tx2'] });
    }

    if (url === '/daemon/getrawmempool/true') {
      return json(res, 200, { status: 'success', data: { tx1: { size: 1 } } });
    }

    if (url === '/daemon/getblockcount') {
      return json(res, 200, { status: 'success', data: 123456 });
    }

    if (url === '/daemon/getconnectioncount') {
      return json(res, 200, { status: 'success', data: 8 });
    }

    if (url === '/daemon/getdifficulty') {
      return json(res, 200, { status: 'success', data: 12345.67 });
    }

    return json(res, 404, { status: 'error', data: `Unhandled path: ${url}` });
  });

  beforeAll(async () => {
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Failed to bind daemon test server');
    serverPort = address.port;
  });

  afterAll(async () => {
    await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  });

  it('returns daemon info JSON with the persisted redacted payload', async () => {
    await withTempStateDir(async () => {
      await setBaseUrl(`http://127.0.0.1:${serverPort}`);
      const runtime = await createSourceFluxMcpRuntime();
      const capture = createCapture();

      const exitCode = await runCli(['daemon', 'info', '--json'], {
        io: capture.io,
        toolRuntime: runtime,
        persistedStateMode: 'on',
      });

      expect(exitCode).toBe(0);
      expect(capture.getStderr()).toBe('');

      const payload = JSON.parse(capture.getStdout()) as Record<string, unknown>;
      expect(payload.ok).toBe(true);
      expect(payload.status).toBe('ok');
      expect(payload.method).toBe('getinfo');
      expect(typeof payload.resourceUri).toBe('string');

      const data = payload.data as Record<string, unknown>;
      expect(data.version).toBe(1);
      expect(data.secret).toBe('[REDACTED]');
      expect(data.rawtxhex).not.toBe('f'.repeat(200));
    });
  });

  it('supports generic daemon calls with parsed params', async () => {
    await withTempStateDir(async () => {
      await setBaseUrl(`http://127.0.0.1:${serverPort}`);
      const runtime = await createSourceFluxMcpRuntime();
      const capture = createCapture();

      const exitCode = await runCli(['daemon', 'call', 'getrawmempool', '--param', 'true', '--json'], {
        io: capture.io,
        toolRuntime: runtime,
        persistedStateMode: 'on',
      });

      expect(exitCode).toBe(0);
      expect(capture.getStderr()).toBe('');

      const payload = JSON.parse(capture.getStdout()) as Record<string, unknown>;
      expect(payload.ok).toBe(true);
      expect(payload.method).toBe('getrawmempool');

      const data = payload.data as Record<string, unknown>;
      expect(data.tx1).toEqual({ size: 1 });
      expect(seen).toContain('/daemon/getrawmempool/true');
    });
  });

  it('renders daemon peer info in pretty mode', async () => {
    await withTempStateDir(async () => {
      await setBaseUrl(`http://127.0.0.1:${serverPort}`);
      const runtime = await createSourceFluxMcpRuntime();
      const capture = createCapture();

      const exitCode = await runCli(['daemon', 'peer-info', '--pretty'], {
        io: capture.io,
        toolRuntime: runtime,
        persistedStateMode: 'on',
      });

      expect(exitCode).toBe(0);
      expect(capture.getStderr()).toBe('');
      expect(capture.getStdout()).toContain('Daemon peer info');
      expect(capture.getStdout()).toContain('Count: 1');
      expect(capture.getStdout()).toContain('1.2.3.4:16125');
    });
  });

  it('passes the verbose raw mempool flag through to the shared tool', async () => {
    await withTempStateDir(async () => {
      await setBaseUrl(`http://127.0.0.1:${serverPort}`);
      const runtime = await createSourceFluxMcpRuntime();
      const capture = createCapture();

      const exitCode = await runCli(['daemon', 'raw-mempool', '--verbose', '--json'], {
        io: capture.io,
        toolRuntime: runtime,
        persistedStateMode: 'on',
      });

      expect(exitCode).toBe(0);
      const payload = JSON.parse(capture.getStdout()) as Record<string, unknown>;
      expect(payload.ok).toBe(true);
      expect(payload.method).toBe('getrawmempool');

      const data = payload.data as Record<string, unknown>;
      expect(data.tx1).toEqual({ size: 1 });
      expect(seen).toContain('/daemon/getrawmempool/true');
    });
  });

  it('surfaces allowlist failures for unsafe daemon methods', async () => {
    await withTempStateDir(async () => {
      await setBaseUrl(`http://127.0.0.1:${serverPort}`);
      const runtime = await createSourceFluxMcpRuntime();
      const capture = createCapture();

      const exitCode = await runCli(['daemon', 'call', 'sendtoaddress', '--json'], {
        io: capture.io,
        toolRuntime: runtime,
        persistedStateMode: 'on',
      });

      expect(exitCode).toBe(EXIT_CODE_FLUX_FAILURE);
      expect(capture.getStderr()).toBe('');

      const payload = JSON.parse(capture.getStdout()) as Record<string, unknown>;
      expect(payload.ok).toBe(false);
      expect(payload.status).toBe('flux_error');
      expect(String(payload.error)).toContain('read-only allowlist');
    });
  });
});
