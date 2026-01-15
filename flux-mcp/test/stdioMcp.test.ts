import { afterAll, describe, expect, it } from 'vitest';

import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { ListToolsResultSchema, CallToolResultSchema, ReadResourceResultSchema } from '@modelcontextprotocol/sdk/types.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

describe('flux-mcp stdio integration', () => {
  const transport = new StdioClientTransport({
    command: 'node',
    args: [path.resolve(__dirname, '..', 'dist', 'index.js')],
    cwd: path.resolve(__dirname, '..'),
    stderr: 'pipe',
  });

  const client = new Client({ name: 'flux-mcp-test-client', version: '1.0.0' });

  afterAll(async () => {
    await transport.close();
  });

  it('lists tools and enforces allowMutation for flux_request', async () => {
    await client.connect(transport);

    const toolsResult = await client.request({ method: 'tools/list', params: {} }, ListToolsResultSchema);
    const toolNames = new Set(toolsResult.tools.map((t) => t.name));

    expect(toolNames.has('flux_request')).toBe(true);
    expect(toolNames.has('flux_verify_login')).toBe(true);
    expect(toolNames.has('flux_auth_flow')).toBe(true);
    expect(toolNames.has('flux_auth_diagnose')).toBe(true);
    expect(toolNames.has('flux_logs_tail')).toBe(true);
    expect(toolNames.has('flux_app_health_report')).toBe(true);
    expect(toolNames.has('flux_set_http_defaults')).toBe(true);

    const setBase = await client.request(
      {
        method: 'tools/call',
        params: {
          name: 'flux_set_base_url',
          arguments: { baseUrl: 'http://127.0.0.1:1' },
        },
      },
      CallToolResultSchema
    );
    expect(setBase.isError).not.toBe(true);

    const flow = await client.request(
      {
        method: 'tools/call',
        params: {
          name: 'flux_auth_flow',
          arguments: {},
        },
      },
      CallToolResultSchema
    );
    expect(flow.isError).not.toBe(true);

    const blocked = await client.request(
      {
        method: 'tools/call',
        params: {
          name: 'flux_request',
          arguments: { method: 'POST', path: '/apps/appregister', body: { ok: true } },
        },
      },
      CallToolResultSchema
    );

    expect(blocked.isError).toBe(true);
    const first = blocked.content[0];
    expect(first?.type).toBe('text');
    if (!first || first.type !== 'text') throw new Error('Expected text content');
    expect(first.text).toContain('allowMutation=true');
  });
});
