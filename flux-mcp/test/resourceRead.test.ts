import { createServer, IncomingMessage, ServerResponse } from 'node:http';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { callTool } from '../src/index.js';

function readBody(req: IncomingMessage) {
  return new Promise<void>((resolve) => {
    req.on('data', () => undefined);
    req.on('end', () => resolve());
  });
}

function json(res: ServerResponse, status: number, body: unknown) {
  res.statusCode = status;
  res.setHeader('content-type', 'application/json');
  res.end(JSON.stringify(body));
}

describe.sequential('flux_resource_read', () => {
  const server = createServer(async (req, res) => {
    await readBody(req);

    if (req.url === '/apps/appspecifications/myapp') {
      return json(res, 200, { status: 'success', data: { version: 8, name: 'myapp' } });
    }

    return json(res, 404, { status: 'error', data: 'not found' });
  });

  let baseUrl: string;

  beforeAll(async () => {
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Failed to bind test server');
    baseUrl = `http://127.0.0.1:${address.port}`;

    const setBase = await callTool('flux_set_base_url', { baseUrl });
    expect(setBase.isError).not.toBe(true);
  });

  afterAll(async () => {
    await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
  });

  it('reads a dynamic resource created by flux_apps_get_spec', async () => {
    const spec = await callTool('flux_apps_get_spec', { appname: 'myapp' });
    expect(spec.isError).not.toBe(true);

    const structured = spec.structuredContent as Record<string, unknown> | undefined;
    const uri = structured?.resourceUri;
    expect(typeof uri).toBe('string');

    const read = await callTool('flux_resource_read', { uri });
    expect(read.isError).not.toBe(true);
    expect(read.content[0].type).toBe('text');
    if (read.content[0].type !== 'text') throw new Error('Expected text content');
    expect(read.content[0].text).toContain('"name": "myapp"');
  });
});
