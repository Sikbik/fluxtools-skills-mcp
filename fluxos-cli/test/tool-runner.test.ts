import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { callTool, tools } from 'flux-mcp';
import { runCli, type ToolRuntime } from '../src/cli.js';

function readBody(req: IncomingMessage) {
  return new Promise<string>((resolve) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
  });
}

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

async function withTempStateDir<T>(run: (stateDir: string) => Promise<T>) {
  const stateDir = await mkdtemp(join(tmpdir(), 'fluxos-cli-tool-runner-'));
  const previousStateDir = process.env.FLUXOS_CLI_STATE_DIR;

  process.env.FLUXOS_CLI_STATE_DIR = stateDir;

  try {
    return await run(stateDir);
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

describe('tool runner integration', () => {
  let serverPort = 0;

  const server = createServer(async (req, res) => {
    const url = req.url ?? '';

    if (url === '/apps/verifyappregistrationspecifications') {
      const bodyRaw = await readBody(req);
      const body = bodyRaw ? (JSON.parse(bodyRaw) as Record<string, unknown>) : {};
      return json(res, 200, { status: 'success', data: body });
    }

    if (url === '/apps/calculateprice') {
      await readBody(req);
      return json(res, 200, { status: 'success', data: { flux: 1.23 } });
    }

    if (url === '/apps/registrationinformation') {
      return json(res, 200, { status: 'success', data: { blocksLasting: 100, daemonPONFork: 1 } });
    }

    if (url === '/apps/deploymentinformation') {
      return json(res, 200, { status: 'success', data: { address: 't1pay' } });
    }

    return json(res, 404, { status: 'error', data: `Unhandled path: ${url}` });
  });

  beforeAll(async () => {
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Failed to bind tool runner test server');
    serverPort = address.port;
  });

  afterAll(async () => {
    await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  });

  it('lists the callable tool catalog in JSON mode', async () => {
    const capture = createCapture();

    const exitCode = await runCli(['tool', 'list', '--json'], { io: capture.io });

    expect(exitCode).toBe(0);
    expect(capture.getStderr()).toBe('');

    const payload = JSON.parse(capture.getStdout()) as Record<string, unknown>;
    expect(payload.ok).toBe(true);
    expect(payload.status).toBe('ok');
    expect(payload.count).toBe(tools.length);

    const listedTools = payload.tools as Array<{ name: string }>;
    expect(listedTools.some((tool) => tool.name === 'flux_get_state')).toBe(true);
    expect(listedTools.some((tool) => tool.name === 'flux_maintenance_checklist')).toBe(true);
  });

  it('renders a readable tool catalog in pretty mode', async () => {
    const capture = createCapture();

    const exitCode = await runCli(['tool', 'list', '--pretty'], { io: capture.io });

    expect(exitCode).toBe(0);
    expect(capture.getStderr()).toBe('');
    expect(capture.getStdout()).toContain('Flux tool catalog');
    expect(capture.getStdout()).toContain('flux_get_state');
    expect(capture.getStdout()).toContain('flux_maintenance_checklist');
  });

  it('wraps a tool that maps to a future first-class command in the stable envelope', async () => {
    await withTempStateDir(async () => {
      const genericCapture = createCapture();
      const firstClassCapture = createCapture();

      const genericExitCode = await runCli(['tool', 'call', 'flux_resource_prune', '--json'], { io: genericCapture.io });
      const firstClassExitCode = await runCli(['resource', 'prune', '--json'], { io: firstClassCapture.io });

      expect(genericExitCode).toBe(0);
      expect(firstClassExitCode).toBe(0);
      expect(genericCapture.getStderr()).toBe('');
      expect(firstClassCapture.getStderr()).toBe('');

      const genericPayload = JSON.parse(genericCapture.getStdout()) as Record<string, unknown>;
      const firstClassPayload = JSON.parse(firstClassCapture.getStdout()) as Record<string, unknown>;
      const firstClassComparable = { ...firstClassPayload };
      delete (firstClassComparable as { status?: unknown }).status;

      expect(genericPayload.ok).toBe(true);
      expect(genericPayload.status).toBe('ok');
      expect(genericPayload.tool).toBe('flux_resource_prune');
      expect(genericPayload.result).toEqual(firstClassComparable);
    });
  });

  it('preserves nextActions for a generic-only tool call', async () => {
    const capture = createCapture();

    const exitCode = await runCli(['tool', 'call', 'flux_maintenance_checklist', '--json'], { io: capture.io });

    expect(exitCode).toBe(0);
    expect(capture.getStderr()).toBe('');

    const payload = JSON.parse(capture.getStdout()) as Record<string, unknown>;
    const direct = await callTool('flux_maintenance_checklist', {});
    const directStructured = direct.structuredContent as Record<string, unknown>;

    expect(payload.ok).toBe(true);
    expect(payload.status).toBe('ok');
    expect(payload.tool).toBe('flux_maintenance_checklist');
    expect(payload.result).toEqual(directStructured);
    expect(payload.nextActions).toEqual(directStructured.nextActions);
  });

  it('keeps one-shot JSON tool calls from holding the local launcher open for git planning flows', async () => {
    await withTempStateDir(async () => {
      const previousLocalLauncherEnv = process.env.FLUX_MCP_LOCAL_LAUNCHER;
      process.env.FLUX_MCP_LOCAL_LAUNCHER = '1';

      const runtime = await createSourceFluxMcpRuntime();

      try {
        await runtime.closeLocalLaunchersForTests?.();
        await runtime.callTool('flux_set_base_url', { baseUrl: `http://127.0.0.1:${serverPort}` });

        const capture = createCapture();
        const exitCode = await runCli(
          [
            'tool',
            'call',
            'flux_git_deploy_plan_registration',
            '--json',
            '--arg', 'name=mygitapp',
            '--arg', 'owner=t1owner',
            '--arg', 'repoUrl=https://github.com/test/repo',
            '--arg', 'exposedPort=20001',
            '--arg', 'managementPort=20002',
            '--arg', 'appPort=3000',
          ],
          { io: capture.io, toolRuntime: runtime }
        );

        expect(exitCode).toBe(0);
        expect(capture.getStderr()).toBe('');

        const payload = JSON.parse(capture.getStdout()) as Record<string, unknown>;
        expect(payload.ok).toBe(true);
        expect(payload.tool).toBe('flux_git_deploy_plan_registration');

        const state = await runtime.getLauncherDebugState?.();
        expect(state?.keepAlive).toBe(false);
        expect(typeof state?.localLauncherPort).toBe('number');
        expect(state?.localLauncherRefed).toBe(false);
        expect(state?.zelcoreLauncherPort).toBe(state?.localLauncherPort ?? null);
        expect(state?.zelcoreLauncherRefed).toBe(false);
      } finally {
        await runtime.closeLocalLaunchersForTests?.();
        if (previousLocalLauncherEnv === undefined) delete process.env.FLUX_MCP_LOCAL_LAUNCHER;
        else process.env.FLUX_MCP_LOCAL_LAUNCHER = previousLocalLauncherEnv;
      }
    });
  });

  it('keeps launcher servers refed for pretty generic tool calls that emit signing launchers', async () => {
    await withTempStateDir(async () => {
      const previousLocalLauncherEnv = process.env.FLUX_MCP_LOCAL_LAUNCHER;
      process.env.FLUX_MCP_LOCAL_LAUNCHER = '1';

      const runtime = await createSourceFluxMcpRuntime();

      try {
        await runtime.closeLocalLaunchersForTests?.();

        const capture = createCapture();
        const exitCode = await runCli(
          [
            'tool',
            'call',
            'flux_build_message_to_sign',
            '--pretty',
            '--args-json',
            JSON.stringify({
              type: 'fluxappregister',
              version: 1,
              timestamp: 123,
              spec: {
                version: 8,
                name: 'mygitapp',
                owner: 't1owner',
                compose: [],
              },
            }),
          ],
          { io: capture.io, toolRuntime: runtime }
        );

        expect(exitCode).toBe(0);
        expect(capture.getStderr()).toBe('');
        expect(capture.getStdout()).toContain('flux_build_message_to_sign');

        const state = await runtime.getLauncherDebugState?.();
        expect(state?.keepAlive).toBe(true);
        expect(typeof state?.localLauncherPort).toBe('number');
        expect(state?.localLauncherRefed).toBe(true);
        expect(state?.zelcoreLauncherPort).toBe(state?.localLauncherPort ?? null);
        expect(state?.zelcoreLauncherRefed).toBe(true);
      } finally {
        await runtime.closeLocalLaunchersForTests?.();
        if (previousLocalLauncherEnv === undefined) delete process.env.FLUX_MCP_LOCAL_LAUNCHER;
        else process.env.FLUX_MCP_LOCAL_LAUNCHER = previousLocalLauncherEnv;
      }
    });
  });
});
