import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createServer, IncomingMessage, ServerResponse } from 'node:http';

import { callTool } from '../src/index.js';

type Seen = { method: string; url: string };

function readBody(req: IncomingMessage) {
  return new Promise<string>((resolve) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')));
  });
}

function json(res: ServerResponse, status: number, body: unknown) {
  res.statusCode = status;
  res.setHeader('content-type', 'application/json');
  res.end(JSON.stringify(body));
}

describe.sequential('UX tools', () => {
  const seen: Seen[] = [];

  const server = createServer(async (req, res) => {
    const url = req.url ?? '';
    seen.push({ method: req.method ?? '', url });

    if (url === '/flux/version') {
      return json(res, 200, { status: 'success', data: { version: 'test' } });
    }

    if (url === '/id/loginphrase') {
      return json(res, 500, { status: 'error', data: 'Syncthing is not running properly' });
    }

    if (url === '/id/emergencyphrase') {
      return json(res, 200, { status: 'success', data: 'EMERGENCY_PHRASE' });
    }

    if (url.startsWith('/apps/applogpolling/')) {
      return json(res, 200, {
        status: 'success',
        data: {
          logs: 'line1\nline2\n',
          sinceTimestamp: '123',
        },
      });
    }

    if (url === '/explorer/scannedheight') {
      return json(res, 200, { status: 'success', data: { generalScannedHeight: 12345 } });
    }

    if (url === '/explorer/issynced') {
      return json(res, 200, { status: 'success', data: true });
    }

    if (url === '/explorer/balance/t1test') {
      return json(res, 200, { status: 'success', data: { confirmed: 10, unconfirmed: 2, balance: 12 } });
    }

    if (url === '/daemon/getinfo') {
      return json(res, 200, { status: 'success', data: { version: 1, secret: 'abc', rawtxhex: 'f'.repeat(200) } });
    }

    if (url === '/daemon/getpeerinfo') {
      return json(res, 200, {
        status: 'success',
        data: [{ addr: '1.2.3.4:16125', inbound: false, pingtime: 0.12, subver: '/Satoshi:0.21.0/' }],
      });
    }

    if (url.startsWith('/apps/globalappsspecifications')) {
      return json(res, 200, {
        status: 'success',
        data: [{ name: 'myapp', owner: 'zelid', height: 100, expire: 10, instances: 3 }],
      });
    }

    if (url === '/apps/temporarymessages') {
      return json(res, 200, { status: 'success', data: [] });
    }

    if (url.startsWith('/apps/permanentmessages')) {
      return json(res, 200, { status: 'success', data: [] });
    }

    if (url === '/apps/registrationinformation') {
      return json(res, 200, { status: 'success', data: { blocksLasting: 100, daemonPONFork: 1 } });
    }

    if (url.startsWith('/apps/location/myapp')) {
      return json(res, 200, { status: 'success', data: [{ ip: '1.2.3.4' }] });
    }

    if (url === '/apps/listrunningapps') {
      return json(res, 200, { status: 'success', data: [{ name: 'myapp', app: 'myapp' }] });
    }

    await readBody(req);
    return json(res, 404, { status: 'error', data: 'not found' });
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

  it('flux_auth_flow returns an ordered plan', async () => {
    const r = await callTool('flux_auth_flow', {});
    expect(r.isError).not.toBe(true);

    const payload = JSON.parse(r.content[0]?.text ?? '{}') as Record<string, unknown>;
    const steps = payload.steps;
    expect(Array.isArray(steps)).toBe(true);
  });

  it('flux_auth_flow includes gateway resolution when gatewayBaseUrl is provided', async () => {
    const r = await callTool('flux_auth_flow', { gatewayBaseUrl: 'https://api.runonflux.io' });
    expect(r.isError).not.toBe(true);

    const payload = JSON.parse(r.content[0]?.text ?? '{}') as Record<string, unknown>;
    const steps = payload.steps as Array<{ tool?: string }>;
    expect(Array.isArray(steps)).toBe(true);
    expect(steps.some((s) => s.tool === 'flux_resolve_gateway_node')).toBe(true);
  });

  it('flux_auth_diagnose detects loginphrase failure and suggests emergencyphrase', async () => {
    const r = await callTool('flux_auth_diagnose', {});
    expect(r.isError).not.toBe(true);

    const payload = JSON.parse(r.content[0]?.text ?? '{}') as Record<string, unknown>;
    expect(Array.isArray(payload.checks)).toBe(true);
    expect(Array.isArray(payload.nextSteps)).toBe(true);
  });

  it('flux_logs_tail calls applogpolling and returns resource_link + structuredContent', async () => {
    const r = await callTool('flux_logs_tail', { appname: 'myapp', lines: 2 });
    expect(r.isError).not.toBe(true);

    const payload = JSON.parse(r.content[0]?.text ?? '{}') as Record<string, unknown>;
    expect(payload.ok).toBe(true);

    const resourceLink = r.content.find((c) => c.type === 'resource_link');
    expect(resourceLink?.type).toBe('resource_link');

    const structured = r.structuredContent as Record<string, unknown> | undefined;
    expect(structured?.resourceUri).toBeTypeOf('string');

    const next = structured?.next as Record<string, unknown> | undefined;
    expect(next?.since).toBe('123');

    expect(seen.some((x) => x.url.startsWith('/apps/applogpolling/'))).toBe(true);
  });

  it('flux_apps_get_spec returns resource_link summary', async () => {
    const r = await callTool('flux_apps_get_spec', { appname: 'myapp' });
    expect(r.isError).toBe(true);

    const resourceLink = r.content.find((c) => c.type === 'resource_link');
    expect(resourceLink).toBeTruthy();

    const structured = r.structuredContent as Record<string, unknown> | undefined;
    expect(structured?.resourceUri).toBeTypeOf('string');
  });

  it('flux_apps_logs returns resource_link summary', async () => {
    const r = await callTool('flux_apps_logs', { appname: 'myapp', lines: '10' });
    expect(r.isError).toBe(true);

    const resourceLink = r.content.find((c) => c.type === 'resource_link');
    expect(resourceLink).toBeTruthy();

    const structured = r.structuredContent as Record<string, unknown> | undefined;
    expect(structured?.resourceUri).toBeTypeOf('string');
  });

  it('flux_search_endpoints returns table + resource_link', async () => {
    const r = await callTool('flux_search_endpoints', { query: 'applog', limit: 3 });
    expect(r.isError).not.toBe(true);

    expect(r.content[0]?.type).toBe('text');

    const resourceLink = r.content.find((c) => c.type === 'resource_link');
    expect(resourceLink).toBeTruthy();
  });

  it('flux_explorer_height_info returns summary', async () => {
    const r = await callTool('flux_explorer_height_info', {});
    expect(typeof r.isError).toBe('boolean');

    const payload = JSON.parse(r.content[0]?.text ?? '{}') as Record<string, unknown>;
    expect(payload.secondsPerBlock).toBeTypeOf('number');
  });

  it('flux_explorer_status returns table + resource_link', async () => {
    const r = await callTool('flux_explorer_status', {});
    expect(typeof r.isError).toBe('boolean');

    expect(r.content[0]?.type).toBe('text');

    const resourceLink = r.content.find((c) => c.type === 'resource_link');
    expect(resourceLink).toBeTruthy();

    const structured = r.structuredContent as Record<string, unknown> | undefined;
    expect(structured?.resourceUri).toBeTypeOf('string');
  });

  it('flux_explorer_balance_summary returns table + resource_link', async () => {
    const r = await callTool('flux_explorer_balance_summary', { address: 't1test' });
    expect(typeof r.isError).toBe('boolean');

    expect(r.content[0]?.type).toBe('text');

    const resourceLink = r.content.find((c) => c.type === 'resource_link');
    expect(resourceLink).toBeTruthy();

    const structured = r.structuredContent as Record<string, unknown> | undefined;
    expect(structured?.resourceUri).toBeTypeOf('string');
  });

  it('flux_apps_global_status returns table + resource_link', async () => {
    const r = await callTool('flux_apps_global_status', { zelid: 'zelid' });
    expect(typeof r.isError).toBe('boolean');

    expect(r.content[0]?.type).toBe('text');

    const resourceLink = r.content.find((c) => c.type === 'resource_link');
    expect(resourceLink).toBeTruthy();
  });

  it('flux_apps_global_status includes location + local running when appname is provided', async () => {
    const r = await callTool('flux_apps_global_status', { zelid: 'zelid', appname: 'myapp' });
    expect(typeof r.isError).toBe('boolean');

    const structured = r.structuredContent as Record<string, unknown> | undefined;
    expect(structured?.locationsCount).toBeTypeOf('number');
    expect(structured?.localRunningCount).toBeTypeOf('number');

    const tableText = r.content[0]?.type === 'text' ? (r.content[0].text ?? '') : '';
    expect(tableText.includes('Instances')).toBe(true);

    expect(seen.some((x) => x.url.startsWith('/apps/location/myapp'))).toBe(true);
    expect(seen.some((x) => x.url === '/apps/listrunningapps')).toBe(true);
  });

  it('flux_maintenance_checklist returns a checklist', async () => {
    const r = await callTool('flux_maintenance_checklist', {});
    expect(r.isError).not.toBe(true);

    const payload = JSON.parse(r.content[0]?.text ?? '{}') as Record<string, unknown>;
    expect(Array.isArray(payload.checklist)).toBe(true);
  });

  it('flux_build_message_to_sign returns messageToSign', async () => {
    const r = await callTool('flux_build_message_to_sign', {
      type: 'fluxappupdate',
      version: 1,
      spec: { name: 'x' },
      timestamp: 1,
    });
    expect(r.isError).not.toBe(true);

    const payload = JSON.parse(r.content[0]?.text ?? '{}') as Record<string, unknown>;
    expect(typeof payload.messageToSign).toBe('string');
  });

  it('flux_daemon_call denies non-allowlisted methods', async () => {
    const r = await callTool('flux_daemon_call', { method: 'sendtoaddress', params: [] });
    expect(r.isError).toBe(true);
  });

  it('flux_daemon_call rejects allowMutation even with confirm', async () => {
    const r = await callTool('flux_daemon_call', { method: 'getinfo', allowMutation: true, confirm: true });
    expect(r.isError).toBe(true);
  });

  it('flux_daemon_call returns resource_link for allowlisted method', async () => {
    const r = await callTool('flux_daemon_call', { method: 'getinfo', params: [] });
    expect(typeof r.isError).toBe('boolean');

    const resourceLink = r.content.find((c) => c.type === 'resource_link');
    expect(resourceLink).toBeTruthy();
  });

  it('flux_daemon_call renders peer table for getpeerinfo', async () => {
    const r = await callTool('flux_daemon_call', { method: 'getpeerinfo' });
    expect(r.isError).not.toBe(true);

    const text = r.content[0]?.type === 'text' ? (r.content[0].text ?? '') : '';
    expect(text.includes('addr')).toBe(true);
    expect(text.includes('1.2.3.4:16125')).toBe(true);
  });

  it('flux_daemon_get_info proxies getinfo', async () => {
    const r = await callTool('flux_daemon_get_info', {});
    expect(typeof r.isError).toBe('boolean');

    const resourceLink = r.content.find((c) => c.type === 'resource_link');
    expect(resourceLink).toBeTruthy();
  });

  it('flux_explorer_restart requires confirm', async () => {
    const r = await callTool('flux_explorer_restart', {});
    expect(r.isError).toBe(true);
  });

  it('flux_explorer_stop requires confirm', async () => {
    const r = await callTool('flux_explorer_stop', {});
    expect(r.isError).toBe(true);
  });

  it('flux_explorer_reindex requires confirm', async () => {
    const r = await callTool('flux_explorer_reindex', {});
    expect(r.isError).toBe(true);
  });

  it('flux_explorer_rescan requires confirm', async () => {
    const r = await callTool('flux_explorer_rescan', {});
    expect(r.isError).toBe(true);
  });

  it('flux_backup_remove_file requires confirm', async () => {
    const r = await callTool('flux_backup_remove_file', { filepath: 'x' });
    expect(r.isError).toBe(true);
  });

  it('flux_backup_download_local_file requires confirm', async () => {
    const r = await callTool('flux_backup_download_local_file', { filepath: 'x' });
    expect(r.isError).toBe(true);
  });

  it('flux_apps_append_backup_task requires confirm', async () => {
    const r = await callTool('flux_apps_append_backup_task', { appname: 'myapp', backup: [] });
    expect(r.isError).toBe(true);
  });

  it('flux_apps_append_restore_task requires confirm', async () => {
    const r = await callTool('flux_apps_append_restore_task', { appname: 'myapp', restore: [], type: 'local' });
    expect(r.isError).toBe(true);
  });

  it('flux_syncthing_metrics returns resource_link summary', async () => {
    const r = await callTool('flux_syncthing_metrics', {});
    expect(r.isError).toBe(true);

    const resourceLink = r.content.find((c) => c.type === 'resource_link');
    expect(resourceLink).toBeTruthy();

    const structured = r.structuredContent as Record<string, unknown> | undefined;
    expect(structured?.resourceUri).toBeTypeOf('string');
  });

  it('flux_apps_troubleshoot returns summary + suspects + nextActions', async () => {
    const r = await callTool('flux_apps_troubleshoot', { appname: 'myapp' });
    expect(typeof r.isError).toBe('boolean');

    const resourceLink = r.content.find((c) => c.type === 'resource_link');
    expect(resourceLink).toBeTruthy();

    const structured = r.structuredContent as Record<string, unknown> | undefined;
    expect(structured?.resourceUri).toBeTypeOf('string');
    expect(Array.isArray(structured?.suspects)).toBe(true);
    expect(Array.isArray(structured?.nextActions)).toBe(true);
  });
});
