import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createServer, IncomingMessage, ServerResponse } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { CallToolResultSchema, ReadResourceResultSchema, ListResourcesResultSchema } from '@modelcontextprotocol/sdk/types.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

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

describe.sequential('flux-mcp resources over stdio', () => {
  const server = createServer(async (req, res) => {
    await readBody(req);

    if (req.url === '/apps/appspecifications/myapp') {
      return json(res, 200, { status: 'success', data: { version: 8, name: 'myapp' } });
    }

    if (req.url === '/syncthing/metrics') {
      return json(res, 200, { status: 'success', data: { ok: true, sample: 1 } });
    }

    return json(res, 404, { status: 'error', data: 'not found' });
  });

  let apiBaseUrl: string;

  const transport = new StdioClientTransport({
    command: 'node',
    args: [path.resolve(__dirname, '..', 'dist', 'index.js')],
    cwd: path.resolve(__dirname, '..'),
    stderr: 'pipe',
  });

  const client = new Client({ name: 'flux-mcp-test-client', version: '1.0.0' });

  beforeAll(async () => {
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Failed to bind test server');
    apiBaseUrl = `http://127.0.0.1:${address.port}`;

    await client.connect(transport);

    const setBase = await client.request(
      {
        method: 'tools/call',
        params: {
          name: 'flux_set_base_url',
          arguments: { baseUrl: apiBaseUrl },
        },
      },
      CallToolResultSchema
    );
    expect(setBase.isError).not.toBe(true);
  });

  afterAll(async () => {
    await transport.close();
    await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
  });

  it('serves static inventory resource', async () => {
    const list = await client.request({ method: 'resources/list', params: {} }, ListResourcesResultSchema);
    expect(list.resources.some((r) => r.uri === 'flux://inventory/endpoints')).toBe(true);

    const read = await client.request(
      { method: 'resources/read', params: { uri: 'flux://inventory/endpoints' } },
      ReadResourceResultSchema
    );

    expect(read.contents.length).toBeGreaterThan(0);
    expect(read.contents[0].uri).toBe('flux://inventory/endpoints');
    expect(read.contents[0].mimeType).toBe('application/json');
  });

  it('creates and reads dynamic resources from tools', async () => {
    const spec = await client.request(
      { method: 'tools/call', params: { name: 'flux_apps_get_spec', arguments: { appname: 'myapp' } } },
      CallToolResultSchema
    );

    expect(spec.isError).not.toBe(true);

    const link = spec.content.find((c) => c.type === 'resource_link');
    expect(link && link.type === 'resource_link').toBe(true);
    if (!link || link.type !== 'resource_link') throw new Error('Expected resource_link content');

    const read = await client.request({ method: 'resources/read', params: { uri: link.uri } }, ReadResourceResultSchema);
    expect(read.contents[0].mimeType).toBe('application/json');
    expect(read.contents[0].text).toContain('"name": "myapp"');

    const readViaTool = await client.request(
      { method: 'tools/call', params: { name: 'flux_resource_read', arguments: { uri: link.uri } } },
      CallToolResultSchema
    );
    expect(readViaTool.isError).not.toBe(true);

    const metrics = await client.request(
      { method: 'tools/call', params: { name: 'flux_syncthing_metrics', arguments: {} } },
      CallToolResultSchema
    );

    expect(metrics.isError).not.toBe(true);
    const metricsLink = metrics.content.find((c) => c.type === 'resource_link');
    expect(metricsLink && metricsLink.type === 'resource_link').toBe(true);
    if (!metricsLink || metricsLink.type !== 'resource_link') throw new Error('Expected resource_link content');

    const metricsRead = await client.request(
      { method: 'resources/read', params: { uri: metricsLink.uri } },
      ReadResourceResultSchema
    );
    expect(metricsRead.contents[0].mimeType).toBe('application/json');

    const search = await client.request(
      { method: 'tools/call', params: { name: 'flux_search_endpoints', arguments: { query: 'applog', limit: 3 } } },
      CallToolResultSchema
    );

    expect(search.isError).not.toBe(true);
    const searchLink = search.content.find((c) => c.type === 'resource_link');
    expect(searchLink && searchLink.type === 'resource_link').toBe(true);
    if (!searchLink || searchLink.type !== 'resource_link') throw new Error('Expected resource_link content');

    const searchRead = await client.request(
      { method: 'resources/read', params: { uri: searchLink.uri } },
      ReadResourceResultSchema
    );
    expect(searchRead.contents[0].mimeType).toBe('application/json');

    const cleared = await client.request(
      { method: 'tools/call', params: { name: 'flux_resource_prune', arguments: { clearAll: true } } },
      CallToolResultSchema
    );
    expect(cleared.isError).not.toBe(true);
  });
});
