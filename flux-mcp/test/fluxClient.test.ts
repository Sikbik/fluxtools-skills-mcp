import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createServer, IncomingMessage } from 'node:http';

import { FluxClient } from '../src/fluxClient.js';

type SeenRequest = {
  method: string;
  url: string;
  headers: Record<string, string | string[] | undefined>;
  body: string;
};

function readBody(req: IncomingMessage) {
  return new Promise<string>((resolve) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')));
  });
}

describe('FluxClient.request mutation gating', () => {
  const seen: SeenRequest[] = [];
  const server = createServer(async (req, res) => {
    const body = await readBody(req);
    seen.push({
      method: req.method ?? '',
      url: req.url ?? '',
      headers: req.headers,
      body,
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
  });

  afterAll(async () => {
    await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
  });

  it('allows POST /id/verifylogin without allowMutation', async () => {
    const client = new FluxClient({ baseUrl });
    const response = await client.request('/id/verifylogin', {
      method: 'POST',
      bodyType: 'form',
      body: { zelid: 'z', signature: 's', loginPhrase: 'p' },
    });

    expect(response.ok).toBe(true);
    const last = seen.at(-1);
    expect(last?.method).toBe('POST');
    expect(last?.url).toBe('/id/verifylogin');
    expect(String(last?.headers['content-type'] ?? '')).toContain('application/x-www-form-urlencoded');
    expect(last?.body).toContain('zelid=z');
    expect(last?.body).toContain('signature=s');
    expect(last?.body).toContain('loginPhrase=p');
  });

  it('allows POST /id/checkprivilege without allowMutation', async () => {
    const client = new FluxClient({ baseUrl });
    const response = await client.request('/id/checkprivilege', {
      method: 'POST',
      bodyType: 'form',
      body: { zelid: 'z', signature: 's', loginPhrase: 'p' },
    });

    expect(response.ok).toBe(true);
    const last = seen.at(-1);
    expect(last?.url).toBe('/id/checkprivilege');
    expect(String(last?.headers['content-type'] ?? '')).toContain('application/x-www-form-urlencoded');
  });

  it('blocks other POSTs unless allowMutation=true', async () => {
    const client = new FluxClient({ baseUrl });
    await expect(
      client.request('/apps/appregister', {
        method: 'POST',
        body: { any: 'thing' },
      })
    ).rejects.toThrow('Refusing mutating request without allowMutation=true');
  });

  it('blocks mutating GETs unless allowMutation=true', async () => {
    const client = new FluxClient({ baseUrl });
    await expect(client.request('/apps/appstart', { method: 'GET' })).rejects.toThrow(
      'Refusing mutating request without allowMutation=true'
    );
  });

  it('sends stored zelidauth header by default', async () => {
    const client = new FluxClient({ baseUrl });
    client.setZelidauth({ zelid: 'z', signature: 's', loginPhrase: 'p' });

    const response = await client.request('/flux/info');
    expect(response.ok).toBe(true);

    const last = seen.at(-1);
    expect(last?.url).toBe('/flux/info');
    const header = last?.headers['zelidauth'];
    expect(typeof header).toBe('string');
    expect(String(header)).toContain('"zelid":"z"');
  });
});
