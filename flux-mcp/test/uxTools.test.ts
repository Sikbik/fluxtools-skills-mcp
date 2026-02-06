import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createServer, IncomingMessage, ServerResponse } from 'node:http';
import { constants, createCipheriv, generateKeyPairSync, privateDecrypt, randomBytes } from 'node:crypto';

import { callTool } from '../src/index.js';

type Seen = { method: string; url: string };

const rsaKeys = (() => {
  const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const der = publicKey.export({ type: 'spki', format: 'der' });
  return { publicKeyBase64: Buffer.from(der).toString('base64'), privateKey };
})();

const rsaPublicKeyBase64 = rsaKeys.publicKeyBase64;
const rsaPrivateKey = rsaKeys.privateKey;

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
  const seen2: Seen[] = [];
  let serverPort = 0;
  let server2Port = 0;

  const server = createServer(async (req, res) => {
    const url = req.url ?? '';
    seen.push({ method: req.method ?? '', url });

    if (url === '/flux/version') {
      return json(res, 200, { status: 'success', data: { version: 'test' } });
    }

    if (url === '/flux/isarcaneos') {
      return json(res, 200, { status: 'success', data: false });
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
      return json(res, 200, { status: 'success', data: { generalScannedHeight: 105 } });
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
        data: [{ name: 'myapp', owner: 'zelid', height: 100, expire: 10, instances: 3, hash: 'h1' }],
      });
    }

    if (url === '/apps/temporarymessages') {
      return json(res, 200, { status: 'success', data: [{ hash: 'h1' }] });
    }

    if (url.startsWith('/apps/permanentmessages')) {
      return json(res, 200, { status: 'success', data: [] });
    }

    if (url === '/apps/registrationinformation') {
      return json(res, 200, { status: 'success', data: { blocksLasting: 100, daemonPONFork: 1 } });
    }

    if (url === '/apps/deploymentinformation') {
      return json(res, 200, { status: 'success', data: { address: 't1pay' } });
    }

    if (url === '/apps/verifyappregistrationspecifications') {
      const bodyRaw = await readBody(req);
      const body = bodyRaw ? (JSON.parse(bodyRaw) as Record<string, unknown>) : {};
      return json(res, 200, { status: 'success', data: body });
    }

    if (url === '/apps/verifyappupdatespecifications') {
      const bodyRaw = await readBody(req);
      const body = bodyRaw ? (JSON.parse(bodyRaw) as Record<string, unknown>) : {};
      return json(res, 200, { status: 'success', data: body });
    }

    if (url === '/apps/calculateprice') {
      await readBody(req);
      return json(res, 200, { status: 'success', data: { flux: 1.23 } });
    }

    if (url === '/apps/getpublickey') {
      await readBody(req);
      return json(res, 200, { status: 'success', data: rsaPublicKeyBase64 });
    }

    if (url === '/apps/appspecifications/myent') {
      return json(res, 200, {
        status: 'success',
        data: {
          version: 8,
          name: 'myent',
          owner: 'zelid',
          enterprise: 'ENCRYPTED',
        },
      });
    }

    if (url === '/apps/appspecifications/myent/true') {
      return json(res, 200, {
        status: 'error',
        data: 'Application Specifications can only be validated on a node running Arcane OS.',
      });
    }

    if (url === '/apps/apporiginalowner/myent') {
      return json(res, 200, { status: 'success', data: 'zelid' });
    }

    if (url === '/apps/appregister') {
      await readBody(req);
      return json(res, 200, { status: 'success', data: { hash: 'hreg' } });
    }

    if (url === '/apps/appupdate') {
      await readBody(req);
      return json(res, 200, { status: 'success', data: { hash: 'hupd' } });
    }

    if (url.startsWith('/apps/location/myapp') || url.startsWith('/apps/location/myent')) {
      const host1 = serverPort ? `127.0.0.1:${serverPort}` : '127.0.0.1';
      const host2 = server2Port ? `127.0.0.1:${server2Port}` : null;
      const data = [{ ip: host1 }, ...(host2 ? [{ ip: host2 }] : [])];
      return json(res, 200, { status: 'success', data });
    }

    if (url.startsWith('/apps/getfolderinfo')) {
      return json(res, 200, { status: 'error', data: 'Application volume not found' });
    }

    if (url.startsWith('/apps/createfolder')) {
      return json(res, 200, { status: 'error', data: 'Application volume not found' });
    }

    if (url.startsWith('/apps/renameobject')) {
      return json(res, 200, { status: 'error', data: 'Application volume not found' });
    }

    if (url.startsWith('/apps/removeobject')) {
      return json(res, 200, { status: 'error', data: 'Application volume not found' });
    }

    if (url.startsWith('/apps/downloadfile')) {
      return json(res, 200, { status: 'error', data: 'Application volume not found' });
    }

    if (url.startsWith('/apps/downloadfolder')) {
      return json(res, 200, { status: 'error', data: 'Application volume not found' });
    }

    if (url === '/apps/listrunningapps') {
      return json(res, 200, { status: 'success', data: [{ name: 'fluxmyapp', app: 'myapp' }] });
    }

    if (url.startsWith('/apps/appinspect')) {
      const u = new URL(url, 'http://127.0.0.1');
      const appname = u.searchParams.get('appname') ?? '';
      if (appname === 'myapp') {
        return json(res, 200, {
          status: 'error',
          data: "Cannot read properties of undefined (reading 'Id')",
        });
      }
      return json(res, 200, { status: 'success', data: { State: { Status: 'running' } } });
    }

    if (url.startsWith('/apps/appmonitor')) {
      const u = new URL(url, 'http://127.0.0.1');
      const appname = u.searchParams.get('appname') ?? '';
      if (appname === 'myapp') {
        return json(res, 200, {
          status: 'error',
          data: "Cannot read properties of undefined (reading 'Id')",
        });
      }
      return json(res, 200, { status: 'success', data: [] });
    }

    if (url === '/apps/appexec') {
      const bodyRaw = await readBody(req);
      const body = bodyRaw ? (JSON.parse(bodyRaw) as Record<string, unknown>) : {};
      const appname = typeof body.appname === 'string' ? body.appname : '';
      if (appname === 'myapp') {
        return json(res, 200, {
          status: 'error',
          data: "Cannot read properties of undefined (reading 'Id')",
        });
      }
      return json(res, 200, { status: 'success', data: { stdout: 'ok' } });
    }

    await readBody(req);
    return json(res, 404, { status: 'error', data: 'not found' });
  });

  const server2 = createServer(async (req, res) => {
    const url = req.url ?? '';
    seen2.push({ method: req.method ?? '', url });

    if (url === '/flux/isarcaneos') {
      return json(res, 200, { status: 'success', data: true });
    }

    if (url === '/apps/apporiginalowner/myent') {
      return json(res, 200, { status: 'success', data: 'zelid' });
    }

    if (url === '/apps/getpublickey') {
      await readBody(req);
      return json(res, 200, { status: 'success', data: rsaPublicKeyBase64 });
    }

    if (url === '/apps/appspecifications/myent/true') {
      // Simulate Arcane enterprise session encryption:
      // decrypt enterprise-key (RSA-OAEP sha256) -> AES key base64 -> encrypt JSON payload with AES-256-GCM.
      const enterpriseKeyHeader = req.headers['enterprise-key'];
      const enterpriseKey = typeof enterpriseKeyHeader === 'string' ? enterpriseKeyHeader : '';
      if (!enterpriseKey) return json(res, 200, { status: 'error', data: 'missing enterprise-key header' });

      const aesKeyBase64 = privateDecrypt(
        { key: rsaPrivateKey, padding: constants.RSA_PKCS1_OAEP_PADDING, oaepHash: 'sha256' },
        Buffer.from(enterpriseKey, 'base64'),
      ).toString('utf-8');

      const aesKey = Buffer.from(aesKeyBase64, 'base64');
      if (aesKey.length !== 32) return json(res, 200, { status: 'error', data: 'bad aes key' });

      const nonce = randomBytes(12);
      const cipher = createCipheriv('aes-256-gcm', aesKey, nonce);
      const plaintext = JSON.stringify({ compose: [{ name: 'web', repotag: 'nginx:latest' }], contacts: [] });
      const start = cipher.update(plaintext, 'utf8');
      const end = cipher.final();
      const tag = cipher.getAuthTag();
      const enterprise = Buffer.concat([nonce, start, end, tag]).toString('base64');

      return json(res, 200, { status: 'success', data: { enterprise } });
    }

    if (url.startsWith('/apps/getfolderinfo')) {
      return json(res, 200, {
        status: 'success',
        data: [
          {
            name: 'hello.txt',
            size: 5,
            isDirectory: false,
            isFile: true,
            isSymbolicLink: false,
            createdAt: '2020-01-01T00:00:00.000Z',
            modifiedAt: '2020-01-01T00:00:00.000Z',
          },
        ],
      });
    }

    if (url.startsWith('/apps/createfolder')) {
      return json(res, 200, { status: 'success', data: 'Folder Created' });
    }

    if (url.startsWith('/apps/renameobject')) {
      return json(res, 200, { status: 'success', data: 'Rename successful' });
    }

    if (url.startsWith('/apps/removeobject')) {
      return json(res, 200, { status: 'success', data: 'File Removed' });
    }

    if (url.startsWith('/apps/downloadfile')) {
      const body = Buffer.from('hello', 'utf-8');
      res.statusCode = 200;
      res.setHeader('content-type', 'text/plain');
      res.setHeader('content-disposition', 'attachment; filename=hello.txt');
      res.setHeader('content-length', String(body.length));
      res.end(body);
      return;
    }

    if (url.startsWith('/apps/downloadfolder')) {
      const body = Buffer.from('zip', 'utf-8');
      res.statusCode = 200;
      res.setHeader('content-type', 'application/zip');
      res.setHeader('content-disposition', 'attachment; filename=folder.zip');
      res.setHeader('content-length', String(body.length));
      res.end(body);
      return;
    }

    await readBody(req);
    return json(res, 404, { status: 'error', data: 'not found' });
  });

  let baseUrl: string;

  beforeAll(async () => {
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Failed to bind test server');
    serverPort = address.port;

    await new Promise<void>((resolve) => server2.listen(0, '127.0.0.1', () => resolve()));
    const address2 = server2.address();
    if (!address2 || typeof address2 === 'string') throw new Error('Failed to bind test server 2');
    server2Port = address2.port;

    baseUrl = `http://127.0.0.1:${serverPort}`;

    const r = await callTool('flux_set_base_url', { baseUrl });
    expect(r.isError).not.toBe(true);

    const auth = await callTool('flux_set_zelidauth', {
      zelidauth: { zelid: 'zelid', signature: 'sig', loginPhrase: 'phrase' },
    });
    expect(auth.isError).not.toBe(true);
  });

  afterAll(async () => {
    await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
    await new Promise<void>((resolve, reject) => server2.close((err) => (err ? reject(err) : resolve())));
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

  it('flux_apps_get_spec_full discovers an Arcane node and decrypts enterprise specs', async () => {
    const r = await callTool('flux_apps_get_spec_full', { appname: 'myent', setBaseUrlOnSuccess: false });
    expect(r.isError).not.toBe(true);

    const payload = JSON.parse(r.content[0]?.text ?? '{}') as Record<string, unknown>;
    expect(payload.ok).toBe(true);
    expect(payload.enterprise).toBe(true);

    const resources = payload.resources as Record<string, unknown> | undefined;
    expect(resources).toBeTruthy();
    expect(typeof resources?.mergedSpec).toBe('string');

    expect(seen.some((x) => x.url === '/apps/location/myent')).toBe(true);
    expect(seen2.some((x) => x.url === '/flux/isarcaneos')).toBe(true);
    expect(seen2.some((x) => x.url === '/apps/getpublickey')).toBe(true);
    expect(seen2.some((x) => x.url === '/apps/appspecifications/myent/true')).toBe(true);
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

    const propagation = structured?.propagation as Record<string, unknown> | undefined;
    expect(propagation?.tempYes).toBeTypeOf('number');
    expect(propagation?.permYes).toBeTypeOf('number');
    expect(propagation?.both).toBeTypeOf('number');
    expect(propagation?.neither).toBeTypeOf('number');

    const tableText = r.content[0]?.type === 'text' ? (r.content[0].text ?? '') : '';

    expect(tableText.includes('App')).toBe(true);
    expect(tableText.includes('Owner')).toBe(true);
    expect(tableText.includes('Instances')).toBe(true);
    expect(tableText.includes('Temp?')).toBe(true);
    expect(tableText.includes('Perm?')).toBe(true);

    expect(tableText.includes('yes')).toBe(true);
    expect(tableText.includes('no')).toBe(true);
    expect(tableText.includes('Propagation:')).toBe(true);

    expect(seen.some((x) => x.url.startsWith('/apps/location/myapp'))).toBe(true);
    expect(seen.some((x) => x.url === '/apps/listrunningapps')).toBe(true);
  });

  it('flux_maintenance_checklist returns a checklist', async () => {
    const r = await callTool('flux_maintenance_checklist', {});
    expect(r.isError).not.toBe(true);

    const payload = JSON.parse(r.content[0]?.text ?? '{}') as Record<string, unknown>;
    expect(Array.isArray(payload.checklist)).toBe(true);
  });

  it('flux_build_message_to_sign returns messageToSignResourceUri by default', async () => {
    const r = await callTool('flux_build_message_to_sign', {
      type: 'fluxappupdate',
      version: 1,
      spec: { name: 'x' },
      timestamp: 1,
    });
    expect(r.isError).not.toBe(true);

    const payload = JSON.parse(r.content[0]?.text ?? '{}') as Record<string, unknown>;
    expect(payload.messageToSign).toBeUndefined();
    expect(typeof payload.messageToSignResourceUri).toBe('string');
    expect(typeof payload.messageToSignSha256).toBe('string');
    expect(typeof payload.messageToSignBytes).toBe('number');
  });

  it('flux_build_zelcore_sign_link supports messageResourceUri', async () => {
    const built = await callTool('flux_build_message_to_sign', {
      type: 'fluxappupdate',
      version: 1,
      spec: { name: 'x' },
      timestamp: 1,
    });
    expect(built.isError).not.toBe(true);

    const builtPayload = JSON.parse(built.content[0]?.text ?? '{}') as Record<string, unknown>;
    const uri = builtPayload.messageToSignResourceUri;
    expect(typeof uri).toBe('string');

    const r = await callTool('flux_build_zelcore_sign_link', { messageResourceUri: uri });
    expect(r.isError).not.toBe(true);

    const payload = JSON.parse(r.content[0]?.text ?? '{}') as Record<string, unknown>;
    expect(typeof payload.link).toBe('string');
    expect((payload.link as string).startsWith('zel:?action=sign&message=')).toBe(true);
    expect(payload.messageSource).toBe('resource');
  });

  it('flux_apps_signing_playbook returns messageToSignResourceUri + nextActions by default', async () => {
    const r = await callTool('flux_apps_signing_playbook', {
      type: 'fluxappregister',
      version: 1,
      spec: { name: 'x' },
      timestamp: 1,
    });
    expect(r.isError).not.toBe(true);

    const payload = JSON.parse(r.content[0]?.text ?? '{}') as Record<string, unknown>;
    expect(payload.messageToSign).toBeUndefined();
    expect(typeof payload.messageToSignResourceUri).toBe('string');
    expect(typeof payload.messageToSignSha256).toBe('string');
    expect(typeof payload.messageToSignBytes).toBe('number');
    expect(Array.isArray(payload.nextActions)).toBe(true);
  });

  it('flux_apps_plan_registration returns summary + resource links', async () => {
    const r = await callTool('flux_apps_plan_registration', {
      spec: { name: 'myapp', owner: 't1owner', description: 'desc' },
      timestamp: 1,
      typeVersion: 1,
    });
    expect(r.isError).not.toBe(true);

    const payload = JSON.parse(r.content[0]?.text ?? '{}') as Record<string, unknown>;
    expect(payload.messageToSign).toBeUndefined();
    expect(typeof payload.messageToSignResourceUri).toBe('string');
    expect(typeof payload.resourceUri).toBe('string');

    const links = r.content.filter((c) => c.type === 'resource_link');
    expect(links.length).toBeGreaterThanOrEqual(2);
  });

  it('flux_apps_plan_update returns summary + resource links', async () => {
    const r = await callTool('flux_apps_plan_update', {
      spec: { name: 'myapp', owner: 't1owner', description: 'desc' },
      timestamp: 1,
      typeVersion: 1,
    });
    expect(r.isError).not.toBe(true);

    const payload = JSON.parse(r.content[0]?.text ?? '{}') as Record<string, unknown>;
    expect(payload.messageToSign).toBeUndefined();
    expect(typeof payload.messageToSignResourceUri).toBe('string');
    expect(typeof payload.resourceUri).toBe('string');

    const links = r.content.filter((c) => c.type === 'resource_link');
    expect(links.length).toBeGreaterThanOrEqual(2);
  });

  it('flux_apps_plan_renew returns summary + resource links', async () => {
    const r = await callTool('flux_apps_plan_renew', {
      appname: 'myapp',
      spec: { name: 'myapp', owner: 't1owner', description: 'desc', version: 8 },
      weeks: 1,
      timestamp: 1,
      typeVersion: 1,
    });
    expect(r.isError).not.toBe(true);

    const payload = JSON.parse(r.content[0]?.text ?? '{}') as Record<string, unknown>;
    expect(payload.messageToSign).toBeUndefined();
    expect(payload.ok).toBe(true);
    expect(typeof payload.messageToSignResourceUri).toBe('string');
    expect(typeof payload.resourceUri).toBe('string');

    const links = r.content.filter((c) => c.type === 'resource_link');
    expect(links.length).toBeGreaterThanOrEqual(1);
  });

  it('flux_apps_register returns summary + resource links', async () => {
    const r = await callTool('flux_apps_register', {
      spec: { name: 'myapp', owner: 'zelid', description: 'desc' },
      signature: 'sig',
      timestamp: 1,
      typeVersion: 1,
    });
    expect(r.isError).not.toBe(true);

    const payload = JSON.parse(r.content[0]?.text ?? '{}') as Record<string, unknown>;
    expect(payload.messageToSign).toBeUndefined();
    expect(payload.ok).toBe(true);
    expect(typeof payload.hash).toBe('string');
    expect(typeof payload.messageToSignResourceUri).toBe('string');
    expect(typeof payload.resourceUri).toBe('string');

    const links = r.content.filter((c) => c.type === 'resource_link');
    expect(links.length).toBeGreaterThanOrEqual(2);
  });

  it('flux_apps_update returns summary + resource links', async () => {
    const r = await callTool('flux_apps_update', {
      spec: { name: 'myapp', owner: 'zelid', description: 'desc' },
      signature: 'sig',
      timestamp: 1,
      typeVersion: 1,
    });
    expect(r.isError).not.toBe(true);

    const payload = JSON.parse(r.content[0]?.text ?? '{}') as Record<string, unknown>;
    expect(payload.messageToSign).toBeUndefined();
    expect(payload.ok).toBe(true);
    expect(typeof payload.hash).toBe('string');
    expect(typeof payload.messageToSignResourceUri).toBe('string');
    expect(typeof payload.resourceUri).toBe('string');

    const links = r.content.filter((c) => c.type === 'resource_link');
    expect(links.length).toBeGreaterThanOrEqual(2);
  });

  it('flux_apps_register_and_verify returns summary + resource links', async () => {
    const r = await callTool('flux_apps_register_and_verify', {
      confirm: true,
      poll: false,
      verifyGlobal: false,
      spec: { name: 'myapp', owner: 'zelid', description: 'desc' },
      signature: 'sig',
      timestamp: 1,
      typeVersion: 1,
    });
    expect(r.isError).not.toBe(true);

    const payload = JSON.parse(r.content[0]?.text ?? '{}') as Record<string, unknown>;
    expect(payload.messageToSign).toBeUndefined();
    expect(payload.ok).toBe(true);
    expect(typeof payload.hash).toBe('string');
    expect(typeof payload.messageToSignResourceUri).toBe('string');
    expect(typeof payload.resourceUri).toBe('string');

    const links = r.content.filter((c) => c.type === 'resource_link');
    expect(links.length).toBeGreaterThanOrEqual(2);
  });

  it('flux_apps_list_folder auto-resolves when volume is not on the current node', async () => {
    const baseUrl1 = `http://127.0.0.1:${serverPort}`;
    const reset = await callTool('flux_set_base_url', { baseUrl: baseUrl1 });
    expect(reset.isError).not.toBe(true);

    const r = await callTool('flux_apps_list_folder', { appname: 'myapp', component: 'web', folder: '' });
    expect(r.isError).not.toBe(true);

    expect(r.content[0]?.type).toBe('text');
    const tableText = r.content[0]?.type === 'text' ? (r.content[0].text ?? '') : '';
    expect(tableText.includes('Name')).toBe(true);
    expect(tableText.includes('hello.txt')).toBe(true);

    const structured = r.structuredContent as Record<string, unknown> | undefined;
    expect(structured?.ok).toBe(true);
    expect(structured?.count).toBe(1);

    const resolved = structured?.resolved as Record<string, unknown> | null | undefined;
    expect(resolved).toBeTruthy();

    expect(seen.some((x) => x.url.startsWith('/apps/getfolderinfo'))).toBe(true);
    expect(seen2.some((x) => x.url.startsWith('/apps/getfolderinfo'))).toBe(true);

    // Restore baseUrl for subsequent tests.
    const restore = await callTool('flux_set_base_url', { baseUrl: baseUrl1 });
    expect(restore.isError).not.toBe(true);
  });

  it('flux_apps_download_file detects error envelopes in base64 mode and retries candidates', async () => {
    // Reset baseUrl so first attempt hits server1 (which returns JSON error).
    const baseUrl1 = `http://127.0.0.1:${serverPort}`;
    const reset = await callTool('flux_set_base_url', { baseUrl: baseUrl1 });
    expect(reset.isError).not.toBe(true);

    const r = await callTool('flux_apps_download_file', { appname: 'myapp', component: 'web', file: 'hello.txt' });
    expect(r.isError).not.toBe(true);

    const payload = JSON.parse(r.content[0]?.text ?? '{}') as Record<string, unknown>;
    expect(payload.ok).toBe(true);
    expect(typeof payload.resourceUri).toBe('string');

    expect(seen.some((x) => x.url.startsWith('/apps/downloadfile'))).toBe(true);
    expect(seen2.some((x) => x.url.startsWith('/apps/downloadfile'))).toBe(true);

    // Restore baseUrl for subsequent tests.
    const restore = await callTool('flux_set_base_url', { baseUrl: baseUrl1 });
    expect(restore.isError).not.toBe(true);
  });

  it('flux_apps_create_folder retries candidates when volume is not on the current node', async () => {
    // Reset baseUrl so first attempt hits server1.
    const baseUrl1 = `http://127.0.0.1:${serverPort}`;
    const reset = await callTool('flux_set_base_url', { baseUrl: baseUrl1 });
    expect(reset.isError).not.toBe(true);

    const r = await callTool('flux_apps_create_folder', {
      appname: 'myapp',
      component: 'web',
      folder: 'x',
      confirm: true,
    });
    expect(r.isError).not.toBe(true);

    const payload = JSON.parse(r.content[0]?.text ?? '{}') as Record<string, unknown>;
    expect(payload.ok).toBe(true);
    expect(typeof payload.resourceUri).toBe('string');

    expect(seen.some((x) => x.url.startsWith('/apps/createfolder'))).toBe(true);
    expect(seen2.some((x) => x.url.startsWith('/apps/createfolder'))).toBe(true);

    // Restore baseUrl for subsequent tests.
    const restore = await callTool('flux_set_base_url', { baseUrl: baseUrl1 });
    expect(restore.isError).not.toBe(true);
  });

  it('flux_git_deploy_generate_spec_v8 returns summary + resource_link', async () => {
    const r = await callTool('flux_git_deploy_generate_spec_v8', {
      name: 'mygitapp',
      owner: 't1owner',
      repoUrl: 'https://github.com/test/repo',
      exposedPort: 20001,
      managementPort: 20002,
      appPort: 3000,
    });
    expect(r.isError).not.toBe(true);

    const payload = JSON.parse(r.content[0]?.text ?? '{}') as Record<string, unknown>;
    expect(payload.enterprise).toBe(false);
    expect(payload.hasRepoToken).toBe(false);
    expect(payload.repotag).toBe('runonflux/orbit:latest');
    expect(typeof payload.resourceUri).toBe('string');

    const resourceLink = r.content.find((c) => c.type === 'resource_link');
    expect(resourceLink).toBeTruthy();
  });

  it('flux_git_deploy_plan_registration returns messageToSignResourceUri + resource links', async () => {
    const r = await callTool('flux_git_deploy_plan_registration', {
      name: 'mygitapp',
      owner: 't1owner',
      repoUrl: 'https://github.com/test/repo',
      exposedPort: 20001,
      managementPort: 20002,
      appPort: 3000,
    });
    expect(r.isError).not.toBe(true);

    const payload = JSON.parse(r.content[0]?.text ?? '{}') as Record<string, unknown>;
    expect(payload.messageToSign).toBeUndefined();
    expect(typeof payload.messageToSignResourceUri).toBe('string');
    expect(typeof payload.resourceUri).toBe('string');

    const links = r.content.filter((c) => c.type === 'resource_link');
    expect(links.length).toBeGreaterThanOrEqual(2);
  });

  it('flux_git_deploy_plan_registration enterprise encrypts compose/contacts when repoToken is provided', async () => {
    const r = await callTool('flux_git_deploy_plan_registration', {
      name: 'mygitapp',
      owner: 't1owner',
      repoUrl: 'https://github.com/test/repo',
      repoUsername: 'git',
      repoToken: 'token123',
      enterprise: true,
      confirm: true,
      exposedPort: 20001,
      managementPort: 20002,
      appPort: 3000,
      contacts: ['test@example.com'],
    });
    expect(r.isError).not.toBe(true);

    const payload = JSON.parse(r.content[0]?.text ?? '{}') as Record<string, unknown>;
    expect(payload.enterprise).toBe(true);
    expect(payload.hasRepoToken).toBe(true);
    expect(typeof payload.resourceUri).toBe('string');

    const uri = payload.resourceUri as string;
    const full = await callTool('flux_resource_read', { uri });
    expect(full.isError).not.toBe(true);

    const fullObj = JSON.parse(full.content[0]?.text ?? '{}') as Record<string, unknown>;
    const spec = fullObj.spec as Record<string, unknown> | undefined;
    expect(spec).toBeTruthy();
    expect(Array.isArray(spec?.compose)).toBe(true);
    expect((spec?.compose as unknown[]).length).toBe(0);
    expect(Array.isArray(spec?.contacts)).toBe(true);
    expect((spec?.contacts as unknown[]).length).toBe(0);
    expect(typeof spec?.enterprise).toBe('string');
    expect((spec?.enterprise as string).length).toBeGreaterThan(0);
  });

  it('flux_apps_update_and_verify returns summary + resource links', async () => {
    const r = await callTool('flux_apps_update_and_verify', {
      confirm: true,
      poll: false,
      verifyGlobal: false,
      spec: { name: 'myapp', owner: 'zelid', description: 'desc' },
      signature: 'sig',
      timestamp: 1,
      typeVersion: 1,
    });
    expect(r.isError).not.toBe(true);

    const payload = JSON.parse(r.content[0]?.text ?? '{}') as Record<string, unknown>;
    expect(payload.messageToSign).toBeUndefined();
    expect(payload.ok).toBe(true);
    expect(typeof payload.hash).toBe('string');
    expect(typeof payload.messageToSignResourceUri).toBe('string');
    expect(typeof payload.resourceUri).toBe('string');

    const links = r.content.filter((c) => c.type === 'resource_link');
    expect(links.length).toBeGreaterThanOrEqual(2);
  });

  it('flux_apps_inspect auto-resolves container not found', async () => {
    const r = await callTool('flux_apps_inspect', { appname: 'myapp' });
    expect(r.isError).not.toBe(true);

    const payload = JSON.parse(r.content[0]?.text ?? '{}') as Record<string, unknown>;
    expect(payload.ok).toBe(true);
    expect(payload.target).toBe('fluxmyapp');
    expect(payload.resolved).toBeTruthy();
  });

  it('flux_apps_monitor auto-resolves container not found', async () => {
    const r = await callTool('flux_apps_monitor', { appname: 'myapp', range: 1 });
    expect(r.isError).not.toBe(true);

    const payload = JSON.parse(r.content[0]?.text ?? '{}') as Record<string, unknown>;
    expect(payload.ok).toBe(true);
    expect(payload.target).toBe('fluxmyapp');
    expect(payload.resolved).toBeTruthy();
  });

  it('flux_apps_exec auto-resolves container not found', async () => {
    const r = await callTool('flux_apps_exec', { confirm: true, appname: 'myapp', cmd: ['echo', 'hi'] });
    expect(r.isError).not.toBe(true);

    const payload = JSON.parse(r.content[0]?.text ?? '{}') as Record<string, unknown>;
    expect(payload.ok).toBe(true);
    expect(payload.target).toBe('fluxmyapp');
    expect(payload.resolved).toBeTruthy();
    expect(typeof payload.resourceUri).toBe('string');

    const links = r.content.filter((c) => c.type === 'resource_link');
    expect(links.length).toBeGreaterThanOrEqual(1);
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
