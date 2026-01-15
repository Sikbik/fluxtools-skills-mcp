import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createServer, IncomingMessage } from 'node:http';

import { FluxClient } from '../src/fluxClient.js';

type Seen = { url: string };

function readBody(req: IncomingMessage) {
  return new Promise<void>((resolve) => {
    req.on('data', () => undefined);
    req.on('end', () => resolve());
  });
}

describe('FluxClient HTTP defaults', () => {
  const seen: Seen[] = [];
  let versionCalls = 0;

  const server = createServer(async (req, res) => {
    await readBody(req);

    const url = req.url ?? '';
    seen.push({ url });

    if (url === '/flux/version') {
      versionCalls += 1;
      if (versionCalls < 3) {
        res.statusCode = 503;
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify({ status: 'error', data: 'temporary' }));
        return;
      }

      res.statusCode = 200;
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ status: 'success', data: { version: 'ok' } }));
      return;
    }

    res.statusCode = 404;
    res.end('not found');
  });

  let baseUrl: string;

  beforeAll(async () => {
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Failed to bind test server');
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
  });

  it('retries safe GETs on 503 when configured', async () => {
    const client = new FluxClient({ baseUrl });
    client.setHttpDefaults({ retryCount: 2, retryBackoffMs: 1 });

    const res = await client.request('/flux/version');
    expect(res.ok).toBe(true);
    expect(versionCalls).toBe(3);
    expect(seen.filter((x) => x.url === '/flux/version').length).toBe(3);
  });

  it('does not retry mutating GETs', async () => {
    const client = new FluxClient({ baseUrl });
    client.setHttpDefaults({ retryCount: 2, retryBackoffMs: 1 });

    await expect(client.request('/apps/appstart', { method: 'GET' })).rejects.toThrow('allowMutation=true');
  });
});
