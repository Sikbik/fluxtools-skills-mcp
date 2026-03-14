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
  const stateDir = await mkdtemp(join(tmpdir(), 'fluxos-cli-explorer-'));
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

describe.sequential('explorer commands', () => {
  const seen: string[] = [];
  let serverPort = 0;

  const server = createServer((req, res) => {
    const url = req.url ?? '';
    seen.push(url);

    if (url === '/explorer/scannedheight') {
      return json(res, 200, { status: 'success', data: { generalScannedHeight: 105 } });
    }

    if (url === '/explorer/issynced') {
      return json(res, 200, { status: 'success', data: true });
    }

    if (url === '/explorer/balance/t1test') {
      return json(res, 200, { status: 'success', data: { confirmed: 10, unconfirmed: 2, balance: 12 } });
    }

    if (url === '/explorer/restart') {
      return json(res, 200, { status: 'success', data: 'Explorer restarted' });
    }

    if (url === '/explorer/stop') {
      return json(res, 200, { status: 'success', data: 'Explorer stopped' });
    }

    if (url === '/explorer/reindex') {
      return json(res, 200, { status: 'success', data: 'Explorer reindexed' });
    }

    if (url === '/explorer/reindex/true') {
      return json(res, 200, { status: 'success', data: 'Explorer reindexed (apps)' });
    }

    if (url.startsWith('/explorer/rescan')) {
      return json(res, 200, { status: 'success', data: 'Explorer rescan started' });
    }

    return json(res, 404, { status: 'error', data: `Unhandled path: ${url}` });
  });

  beforeAll(async () => {
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Failed to bind explorer test server');
    serverPort = address.port;
  });

  afterAll(async () => {
    await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  });

  it('returns explorer status JSON with stable fields and a resource uri', async () => {
    await withTempStateDir(async () => {
      await setBaseUrl(`http://127.0.0.1:${serverPort}`);
      const runtime = await createSourceFluxMcpRuntime();
      const capture = createCapture();

      const exitCode = await runCli(['explorer', 'status', '--seconds-per-block', '60', '--json'], {
        io: capture.io,
        toolRuntime: runtime,
        persistedStateMode: 'on',
      });

      expect(exitCode).toBe(0);
      expect(capture.getStderr()).toBe('');

      const payload = JSON.parse(capture.getStdout()) as Record<string, unknown>;
      expect(payload.ok).toBe(true);
      expect(payload.status).toBe('ok');
      expect(payload.currentHeight).toBe(105);
      expect(payload.isSynced).toBe(true);
      expect(payload.secondsPerBlock).toBe(60);
      expect(payload.approxBlocksPerHour).toBe(60);
      expect(payload.approxBlocksPerDay).toBe(1440);
      expect(typeof payload.resourceUri).toBe('string');
    });
  });

  it('renders explorer balance in pretty mode', async () => {
    await withTempStateDir(async () => {
      await setBaseUrl(`http://127.0.0.1:${serverPort}`);
      const runtime = await createSourceFluxMcpRuntime();
      const capture = createCapture();

      const exitCode = await runCli(['explorer', 'balance', 't1test', '--pretty'], {
        io: capture.io,
        toolRuntime: runtime,
        persistedStateMode: 'on',
      });

      expect(exitCode).toBe(0);
      expect(capture.getStderr()).toBe('');
      expect(capture.getStdout()).toContain('Explorer balance t1test');
      expect(capture.getStdout()).toContain('Confirmed: 10');
      expect(capture.getStdout()).toContain('Balance: 12');
    });
  });

  it('keeps confirm gating explicit for explorer restart', async () => {
    await withTempStateDir(async () => {
      await setBaseUrl(`http://127.0.0.1:${serverPort}`);
      const runtime = await createSourceFluxMcpRuntime();
      const capture = createCapture();

      const exitCode = await runCli(['explorer', 'restart', '--json'], {
        io: capture.io,
        toolRuntime: runtime,
        persistedStateMode: 'on',
      });

      expect(exitCode).toBe(EXIT_CODE_CONFIRM);
      expect(capture.getStderr()).toBe('');

      const payload = JSON.parse(capture.getStdout()) as Record<string, unknown>;
      expect(payload.ok).toBe(false);
      expect(payload.status).toBe('confirm_required');
      expect(String(payload.error)).toContain('confirm=true');
    });
  });

  it('passes reindex and rescan flags through to the shared explorer tools', async () => {
    await withTempStateDir(async () => {
      await setBaseUrl(`http://127.0.0.1:${serverPort}`);
      const runtime = await createSourceFluxMcpRuntime();
      const reindexCapture = createCapture();
      const rescanCapture = createCapture();

      const reindexExitCode = await runCli(['explorer', 'reindex', '--reindex-apps', '--confirm', '--json'], {
        io: reindexCapture.io,
        toolRuntime: runtime,
        persistedStateMode: 'on',
      });

      expect(reindexExitCode).toBe(0);
      const reindexPayload = JSON.parse(reindexCapture.getStdout()) as Record<string, unknown>;
      expect(reindexPayload.ok).toBe(true);
      expect(reindexPayload.status).toBe('success');
      expect(reindexPayload.reindexApps).toBe(true);
      expect(reindexPayload.message).toBe('Explorer reindexed (apps)');

      const rescanExitCode = await runCli(['explorer', 'rescan', '--block-height', '0', '--rescan-apps', '--confirm', '--json'], {
        io: rescanCapture.io,
        toolRuntime: runtime,
        persistedStateMode: 'on',
      });

      expect(rescanExitCode).toBe(0);
      const rescanPayload = JSON.parse(rescanCapture.getStdout()) as Record<string, unknown>;
      expect(rescanPayload.ok).toBe(true);
      expect(rescanPayload.status).toBe('success');
      expect(rescanPayload.blockHeight).toBe(0);
      expect(rescanPayload.rescanApps).toBe(true);
      expect(rescanPayload.message).toBe('Explorer rescan started');

      expect(seen).toContain('/explorer/reindex/true');
      expect(seen).toContain('/explorer/rescan/0/true');
    });
  });
});
