import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';

import {
  __closeLocalLaunchersForTests,
  __getLocalLauncherDebugState,
  callTool,
  setLocalLauncherKeepAlive,
} from '../src/index.js';

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

describe.sequential('launcher lifecycle', () => {
  let serverPort = 0;
  const previousLocalLauncherEnv = process.env.FLUX_MCP_LOCAL_LAUNCHER;

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
    process.env.FLUX_MCP_LOCAL_LAUNCHER = '1';

    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Failed to bind launcher lifecycle test server');
    serverPort = address.port;

    const baseUrlResult = await callTool('flux_set_base_url', { baseUrl: `http://127.0.0.1:${serverPort}` });
    expect(baseUrlResult.isError).not.toBe(true);
  });

  afterEach(async () => {
    await __closeLocalLaunchersForTests();
  });

  afterAll(async () => {
    await __closeLocalLaunchersForTests();

    if (previousLocalLauncherEnv === undefined) delete process.env.FLUX_MCP_LOCAL_LAUNCHER;
    else process.env.FLUX_MCP_LOCAL_LAUNCHER = previousLocalLauncherEnv;

    await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  });

  it('keeps launcher servers refed for interactive signing helpers', async () => {
    setLocalLauncherKeepAlive(true);

    const result = await callTool('flux_build_message_to_sign', {
      type: 'fluxappregister',
      version: 1,
      timestamp: 123,
      spec: {
        version: 8,
        name: 'mygitapp',
        owner: 't1owner',
        compose: [],
      },
    });
    expect(result.isError).not.toBe(true);

    const payload = result.structuredContent as Record<string, unknown>;
    expect(typeof payload.signLauncherHttpUrl).toBe('string');
    expect(typeof payload.zelcoreLauncherHttpUrl).toBe('string');

    const state = __getLocalLauncherDebugState();
    expect(state.keepAlive).toBe(true);
    expect(typeof state.localLauncherPort).toBe('number');
    expect(state.localLauncherRefed).toBe(true);
    expect(state.zelcoreLauncherPort).toBe(state.localLauncherPort);
    expect(state.zelcoreLauncherRefed).toBe(true);
  });

  it('can unref launcher servers for one-shot git deploy planning without losing launcher urls', async () => {
    setLocalLauncherKeepAlive(false);

    const result = await callTool('flux_git_deploy_plan_registration', {
      name: 'mygitapp',
      owner: 't1owner',
      repoUrl: 'https://github.com/test/repo',
      exposedPort: 20001,
      managementPort: 20002,
      appPort: 3000,
    });
    expect(result.isError).not.toBe(true);

    const payload = result.structuredContent as Record<string, unknown>;
    expect(typeof payload.zelcoreLauncherHttpUrl).toBe('string');
    expect(typeof payload.messageToSignResourceUri).toBe('string');

    const state = __getLocalLauncherDebugState();
    expect(state.keepAlive).toBe(false);
    expect(typeof state.localLauncherPort).toBe('number');
    expect(state.localLauncherRefed).toBe(false);
    expect(state.localLauncherRouteCount).toBeGreaterThan(0);
    expect(state.zelcoreLauncherPort).toBe(state.localLauncherPort);
    expect(state.zelcoreLauncherRefed).toBe(false);
  });
});
