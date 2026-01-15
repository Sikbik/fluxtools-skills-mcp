import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createServer } from 'node:http';

import { callTool } from '../src/index.js';

type Seen = { method: string; url: string; body: string };

describe.sequential('callTool flux_request gating', () => {
  const seen: Seen[] = [];
  const server = createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    await new Promise<void>((resolve) => req.on('end', () => resolve()));

    seen.push({
      method: req.method ?? '',
      url: req.url ?? '',
      body: Buffer.concat(chunks).toString('utf-8'),
    });

    res.statusCode = 200;
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ status: 'success', data: { ok: true } }));
  });

  let baseUrl: string;

  beforeAll(async () => {
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Failed to bind test server');
    baseUrl = `http://127.0.0.1:${address.port}`;

    const r = await callTool('flux_set_base_url', { baseUrl });
    expect(r.isError).not.toBe(true);
  });

  afterAll(async () => {
    await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
  });

  it('rejects mutating POST via flux_request without allowMutation', async () => {
    const r = await callTool('flux_request', {
      method: 'POST',
      path: '/apps/appregister',
      body: { any: 'thing' },
    });

    expect(r.isError).toBe(true);
    const payload = JSON.parse(r.content[0].text) as Record<string, unknown>;
    expect(String(payload.error)).toContain('allowMutation=true');
  });

  it('allows mutating POST via flux_request with allowMutation=true', async () => {
    const r = await callTool('flux_request', {
      method: 'POST',
      path: '/apps/appregister',
      body: { ok: true },
      allowMutation: true,
    });

    expect(r.isError).not.toBe(true);

    const last = seen.at(-1);
    expect(last?.method).toBe('POST');
    expect(last?.url).toBe('/apps/appregister');
  });
});
