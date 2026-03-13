import { constants, createCipheriv, generateKeyPairSync, privateDecrypt, randomBytes } from 'node:crypto';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { runCli, type ToolRuntime } from '../src/cli.js';

const MANAGED_ENV_KEYS = [
  'FLUXOS_CLI_STATE_DIR',
  'XDG_STATE_HOME',
  'FLUX_API_BASE_URL',
  'FLUX_ZELIDAUTH',
  'FLUX_ENTERPRISE_KEY',
  'FLUXDRIVE_MWS_BASE_URL',
  'FLUX_HTTP_TIMEOUT_MS',
  'FLUX_HTTP_RETRY_COUNT',
  'FLUX_HTTP_RETRY_BACKOFF_MS',
] as const;

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

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function parseZelid(raw: string | null): string | null {
  if (!raw) return null;

  try {
    const parsed = JSON.parse(raw) as unknown;
    const zelid = asRecord(parsed).zelid;
    return typeof zelid === 'string' && zelid.trim() ? zelid.trim() : null;
  } catch {
    return null;
  }
}

function createFluxRequestResult(data: unknown, status = 200) {
  return {
    ok: true,
    status,
    data: {
      status: 'success',
      data,
    },
  };
}

function createFakeAppsToolRuntime(): ToolRuntime {
  let baseUrl = 'https://api.runonflux.io';
  let zelidauth: string | null = null;
  let enterpriseKey: string | null = null;
  const resources = new Map<string, { text: string; mimeType: string }>();

  const setJsonResource = (uri: string, value: unknown) => {
    resources.set(uri, { text: JSON.stringify(value, null, 2), mimeType: 'application/json' });
  };

  const jsonResult = (payload: Record<string, unknown>, isError = false, text?: string) => ({
    isError,
    structuredContent: payload,
    content: [{ type: 'text', text: text ?? JSON.stringify(payload, null, 2) }],
  });

  const jsonResultWithResource = (
    payload: Record<string, unknown>,
    resourceUri: string,
    isError = false,
    text?: string
  ) => ({
    isError,
    structuredContent: payload,
    content: [
      { type: 'text', text: text ?? JSON.stringify(payload, null, 2) },
      { type: 'resource_link', uri: resourceUri, name: resourceUri, mimeType: 'application/json' },
    ],
  });

  return {
    async listTools() {
      return [];
    },

    async callTool(name, rawArgs) {
      const args = asRecord(rawArgs);

      switch (name) {
        case 'flux_clear_zelidauth':
          zelidauth = null;
          return jsonResult({ ok: true });
        case 'flux_clear_enterprise_key':
          enterpriseKey = null;
          return jsonResult({ ok: true });
        case 'flux_set_base_url':
          baseUrl = String(args.baseUrl);
          return jsonResult({ ok: true, baseUrl });
        case 'flux_set_http_defaults':
          return jsonResult({ ok: true });
        case 'flux_fluxdrive_set_base_url':
          return jsonResult({ ok: true });
        case 'flux_set_zelidauth': {
          const value = args.zelidauth;
          zelidauth = typeof value === 'string' ? value : JSON.stringify(value);
          return jsonResult({ ok: true });
        }
        case 'flux_set_enterprise_key':
          enterpriseKey = typeof args.enterpriseKey === 'string' ? args.enterpriseKey : null;
          return jsonResult({ ok: true });
        case 'flux_apps_list_running': {
          const resourceUri = 'flux://resource/apps/list-running';
          const items = [
            { app: 'alpha', component: 'web', status: 'running', ip: '10.0.0.2', port: 3000 },
            { app: 'beta', component: 'api', status: 'stopped', ip: '10.0.0.3', port: 3001 },
          ];
          setJsonResource(resourceUri, createFluxRequestResult(items));
          return jsonResultWithResource(
            { ok: true, status: 'ok', count: items.length, shown: items.length, resourceUri },
            resourceUri,
            false,
            '| App | Component | Status |\n| --- | --- | --- |\n| alpha | web | running |\n| beta | api | stopped |'
          );
        }
        case 'flux_apps_list_all': {
          const resourceUri = 'flux://resource/apps/list-all';
          const names = ['alpha', 'beta', 'gamma'];
          setJsonResource(resourceUri, createFluxRequestResult(names));
          return jsonResultWithResource(
            { ok: true, status: 'ok', count: names.length, shown: names.length, resourceUri },
            resourceUri,
            false,
            '| App |\n| --- |\n| alpha |\n| beta |\n| gamma |'
          );
        }
        case 'flux_apps_list_global_specs': {
          const resourceUri = 'flux://resource/apps/list-global';
          const all = [
            { name: 'alpha', owner: 'owner-a', height: 100, expire: 20, instances: 3, hash: 'hash-a' },
            { name: 'beta', owner: 'owner-b', height: 110, expire: 30, instances: 1, hash: 'hash-b' },
          ];
          const filtered = all.filter((item) => {
            if (typeof args.owner === 'string' && item.owner !== args.owner) return false;
            if (typeof args.appname === 'string' && item.name !== args.appname) return false;
            if (typeof args.hash === 'string' && item.hash !== args.hash) return false;
            return true;
          });

          setJsonResource(resourceUri, createFluxRequestResult(filtered));

          return jsonResultWithResource(
            {
              ok: true,
              status: 'ok',
              count: filtered.length,
              shown: filtered.length,
              owner: typeof args.owner === 'string' ? args.owner : null,
              appname: typeof args.appname === 'string' ? args.appname : null,
              hash: typeof args.hash === 'string' ? args.hash : null,
              resourceUri,
            },
            resourceUri,
            false,
            '| App | Owner | Hash |\n| --- | --- | --- |\n| alpha | owner-a | hash-a |'
          );
        }
        case 'flux_apps_list_by_zelid_with_expiry': {
          const resourceUri = 'flux://resource/apps/by-zelid';
          const zelidValue = typeof args.zelid === 'string' ? args.zelid : parseZelid(zelidauth);
          if (!zelidValue) {
            return jsonResult({ ok: false, error: 'zelid is required (or set FLUX_ZELIDAUTH / flux_set_zelidauth first).' }, true);
          }

          const computed = [
            {
              name: 'alpha',
              owner: zelidValue,
              height: 100,
              expire: 20,
              expireIn: 20,
              originalExpirationHeight: 120,
              expirationHeight: 120,
              currentHeight: 105,
              blocksRemaining: 15,
              expired: false,
            },
          ];

          setJsonResource(resourceUri, {
            zelid: zelidValue,
            options: { includeExpired: args.includeExpired === true, limit: 50 },
            currentHeight: 105,
            blocksLasting: 100,
            daemonPONFork: 1,
            apps: computed,
            filtered: computed,
            raw: {},
          });

          return jsonResultWithResource(
            {
              ok: true,
              status: 'ok',
              zelid: zelidValue,
              options: {
                includeExpired: args.includeExpired === true,
                estimateTimeRemaining: args.estimateTimeRemaining === true,
                secondsPerBlock: typeof args.secondsPerBlock === 'number' ? args.secondsPerBlock : 30,
                limit: 50,
              },
              count: computed.length,
              total: computed.length,
              currentHeight: 105,
              blocksLasting: 100,
              daemonPONFork: 1,
              resourceUri,
            },
            resourceUri,
            false,
            '| App | Blocks Left |\n| --- | --- |\n| alpha | 15 |'
          );
        }
        case 'flux_apps_global_status': {
          const resourceUri = 'flux://resource/apps/global-status';
          const computed = [
            {
              name: 'alpha',
              owner: 'owner-a',
              hash: 'hash-a',
              instances: 3,
              height: 100,
              expirationHeight: 120,
              blocksRemaining: 15,
              expired: false,
              hasTemporary: true,
              hasPermanent: false,
            },
          ];

          setJsonResource(resourceUri, {
            zelid: typeof args.zelid === 'string' ? args.zelid : null,
            appname: typeof args.appname === 'string' ? args.appname : null,
            includeExpired: args.includeExpired === true,
            currentHeight: 105,
            apps: computed,
            computed,
            location: { appname: 'alpha', count: 2 },
            localRuntime: { appname: 'alpha', runningCount: 1 },
            raw: {},
          });

          return jsonResultWithResource(
            {
              ok: true,
              appname: typeof args.appname === 'string' ? args.appname : null,
              zelid: typeof args.zelid === 'string' ? args.zelid : null,
              count: computed.length,
              shown: computed.length,
              temporaryCount: 1,
              permanentCount: 0,
              locationsCount: 2,
              localRunningCount: 1,
              propagation: { tempYes: 1, permYes: 0, both: 0, neither: 0 },
              resourceUri,
            },
            resourceUri,
            false,
            '| App | Temp? | Perm? |\n| --- | --- | --- |\n| alpha | yes | no |'
          );
        }
        case 'flux_apps_get_spec': {
          const appname = String(args.appname);
          const resourceUri = `flux://resource/apps/spec/${appname}`;
          const spec =
            appname === 'myent'
              ? { version: 8, name: 'myent', owner: 'owner-a', compose: [], contacts: [], enterprise: 'ENCRYPTED' }
              : { version: 8, name: 'myapp', owner: 'owner-a', compose: [{ name: 'web', repotag: 'nginx:latest' }], contacts: [], enterprise: '' };

          setJsonResource(resourceUri, createFluxRequestResult(spec));

          return jsonResultWithResource({
            ok: true,
            status: 200,
            appname,
            decrypt: args.decrypt === true,
            enterpriseDetected: appname === 'myent',
            note: appname === 'myent'
              ? 'Enterprise v8 apps hide compose/contacts in the base spec. Use flux_apps_get_spec_full to retrieve decrypted compose/contacts for inspection.'
              : null,
            resourceUri,
            nextActions: appname === 'myent' ? [{ tool: 'flux_apps_get_spec_full', arguments: { appname } }] : [],
          }, resourceUri);
        }
        case 'flux_apps_get_spec_full': {
          const appname = String(args.appname);
          if (appname !== 'myapp') {
            return jsonResult({ ok: false, error: `Unknown fake app: ${appname}` }, true);
          }

          const resourceUri = 'flux://resource/apps/spec-full/myapp';
          const spec = {
            version: 8,
            name: 'myapp',
            owner: 'owner-a',
            compose: [{ name: 'web', repotag: 'nginx:latest' }],
            contacts: [],
            enterprise: '',
          };

          setJsonResource(resourceUri, createFluxRequestResult(spec));

          return jsonResultWithResource({
            ok: true,
            appname,
            enterprise: false,
            baseUrlUsed: baseUrl,
            resourceUri,
          }, resourceUri);
        }
        case 'flux_apps_get_owner':
          return jsonResult(createFluxRequestResult('owner-a'));
        case 'flux_apps_get_public_key':
          if (!zelidauth || !enterpriseKey) {
            return jsonResult({ ok: false, error: 'Unable to fetch enterprise public key (Arcane node + zelidauth required).' }, true);
          }

          return jsonResult(createFluxRequestResult('PUBLIC_KEY_VALUE'));
        case 'flux_apps_registration_information': {
          const resourceUri = 'flux://resource/apps/registration-information';
          setJsonResource(resourceUri, createFluxRequestResult({ blocksLasting: 100, daemonPONFork: 1 }));
          return jsonResultWithResource({ ok: true, status: 200, resourceUri }, resourceUri);
        }
        case 'flux_apps_deployment_information': {
          const resourceUri = 'flux://resource/apps/deployment-information';
          setJsonResource(resourceUri, createFluxRequestResult({ address: 't1payment' }));
          return jsonResultWithResource({ ok: true, status: 200, resourceUri }, resourceUri);
        }
        default:
          return jsonResult({ ok: false, error: `Unknown tool: ${name}` }, true);
      }
    },

    async readResource(uri) {
      const resource = resources.get(uri);
      if (!resource) return null;
      return { uri, mimeType: resource.mimeType, text: resource.text };
    },
  };
}

async function withTempStateDir<T>(run: (stateDir: string) => Promise<T>) {
  const stateDir = await mkdtemp(join(tmpdir(), 'fluxos-cli-apps-'));
  const previousEnv = new Map<string, string | undefined>(MANAGED_ENV_KEYS.map((key) => [key, process.env[key]]));

  process.env.FLUXOS_CLI_STATE_DIR = stateDir;
  delete process.env.XDG_STATE_HOME;
  delete process.env.FLUX_API_BASE_URL;
  delete process.env.FLUX_ZELIDAUTH;
  delete process.env.FLUX_ENTERPRISE_KEY;
  delete process.env.FLUXDRIVE_MWS_BASE_URL;
  delete process.env.FLUX_HTTP_TIMEOUT_MS;
  delete process.env.FLUX_HTTP_RETRY_COUNT;
  delete process.env.FLUX_HTTP_RETRY_BACKOFF_MS;

  try {
    return await run(stateDir);
  } finally {
    for (const [key, value] of previousEnv.entries()) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }

    await rm(stateDir, { recursive: true, force: true });
  }
}

async function invokeCli(
  argv: string[],
  opts?: {
    toolRuntime?: ToolRuntime;
    persistedStateMode?: 'auto' | 'on' | 'off';
  }
) {
  const capture = createCapture();
  const exitCode = await runCli(argv, {
    io: capture.io,
    ...(opts?.toolRuntime ? { toolRuntime: opts.toolRuntime } : {}),
    ...(opts?.persistedStateMode ? { persistedStateMode: opts.persistedStateMode } : {}),
  });

  return {
    exitCode,
    stdout: capture.getStdout(),
    stderr: capture.getStderr(),
  };
}

async function seedState(stateDir: string, payload: Record<string, unknown>) {
  await writeFile(join(stateDir, 'state.json'), JSON.stringify(payload, null, 2), 'utf8');
}

function json(res: ServerResponse, statusCode: number, payload: unknown) {
  const text = JSON.stringify(payload);
  res.statusCode = statusCode;
  res.setHeader('content-type', 'application/json');
  res.setHeader('content-length', String(Buffer.byteLength(text)));
  res.end(text);
}

function readBody(req: IncomingMessage) {
  return new Promise<string>((resolve) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
  });
}

async function withEnterpriseServers<T>(
  run: (context: { baseUrl: string; seenPrimary: Array<{ method: string; url: string }>; seenArcane: Array<{ method: string; url: string }> }) => Promise<T>
) {
  const seenPrimary: Array<{ method: string; url: string }> = [];
  const seenArcane: Array<{ method: string; url: string }> = [];
  const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const publicKeyDer = publicKey.export({ type: 'spki', format: 'der' });
  const publicKeyBase64 = Buffer.from(publicKeyDer).toString('base64');

  let primaryPort = 0;
  let arcanePort = 0;

  const primaryServer = createServer(async (req, res) => {
    const url = req.url ?? '';
    seenPrimary.push({ method: req.method ?? '', url });

    if (url === '/flux/isarcaneos') {
      return json(res, 200, { status: 'success', data: false });
    }

    if (url === '/apps/appspecifications/myent') {
      return json(res, 200, {
        status: 'success',
        data: {
          version: 8,
          name: 'myent',
          owner: 'owner-a',
          compose: [],
          contacts: [],
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
      return json(res, 200, { status: 'success', data: 'owner-a' });
    }

    if (url === '/apps/location/myent') {
      return json(res, 200, {
        status: 'success',
        data: [{ ip: `127.0.0.1:${arcanePort}` }],
      });
    }

    await readBody(req);
    return json(res, 404, { status: 'error', data: 'not found' });
  });

  const arcaneServer = createServer(async (req, res) => {
    const url = req.url ?? '';
    seenArcane.push({ method: req.method ?? '', url });

    if (url === '/flux/isarcaneos') {
      return json(res, 200, { status: 'success', data: true });
    }

    if (url === '/apps/apporiginalowner/myent') {
      return json(res, 200, { status: 'success', data: 'owner-a' });
    }

    if (url === '/apps/getpublickey') {
      await readBody(req);
      return json(res, 200, { status: 'success', data: publicKeyBase64 });
    }

    if (url === '/apps/appspecifications/myent/true') {
      const enterpriseKeyHeader = req.headers['enterprise-key'];
      const encryptedAesKey = typeof enterpriseKeyHeader === 'string' ? enterpriseKeyHeader : '';
      const aesKeyBase64 = privateDecrypt(
        { key: privateKey, padding: constants.RSA_PKCS1_OAEP_PADDING, oaepHash: 'sha256' },
        Buffer.from(encryptedAesKey, 'base64')
      ).toString('utf8');

      const aesKey = Buffer.from(aesKeyBase64, 'base64');
      const nonce = randomBytes(12);
      const cipher = createCipheriv('aes-256-gcm', aesKey, nonce);
      const plaintext = JSON.stringify({
        compose: [{ name: 'web', repotag: 'nginx:latest', environmentParameters: ['API_TOKEN=secret-token'] }],
        contacts: ['ops@example.com'],
      });
      const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
      const tag = cipher.getAuthTag();
      const enterprise = Buffer.concat([nonce, encrypted, tag]).toString('base64');

      return json(res, 200, { status: 'success', data: { enterprise } });
    }

    await readBody(req);
    return json(res, 404, { status: 'error', data: 'not found' });
  });

  await new Promise<void>((resolve) => primaryServer.listen(0, '127.0.0.1', () => {
    primaryPort = (primaryServer.address() as { port: number }).port;
    resolve();
  }));

  await new Promise<void>((resolve) => arcaneServer.listen(0, '127.0.0.1', () => {
    arcanePort = (arcaneServer.address() as { port: number }).port;
    resolve();
  }));

  try {
    return await run({
      baseUrl: `http://127.0.0.1:${primaryPort}`,
      seenPrimary,
      seenArcane,
    });
  } finally {
    await new Promise<void>((resolve, reject) => primaryServer.close((error) => (error ? reject(error) : resolve())));
    await new Promise<void>((resolve, reject) => arcaneServer.close((error) => (error ? reject(error) : resolve())));
  }
}

describe.sequential('apps discovery and spec readers', () => {
  it('prints help that includes the apps command family', async () => {
    const capture = createCapture();
    const exitCode = await runCli(['--help'], { io: capture.io });

    expect(exitCode).toBe(0);
    expect(capture.getStdout()).toContain('apps list-global');
    expect(capture.getStdout()).toContain('apps get-spec-full');
  });

  it('returns structured inventory for list-running, list-all, list-global, and global-status', async () => {
    const toolRuntime = createFakeAppsToolRuntime();

    const listRunning = await invokeCli(['apps', 'list-running', '--json'], { toolRuntime, persistedStateMode: 'on' });
    expect(listRunning.exitCode).toBe(0);
    expect(JSON.parse(listRunning.stdout)).toMatchObject({
      ok: true,
      count: 2,
      items: [
        { app: 'alpha', component: 'web', status: 'running', ip: '10.0.0.2', port: 3000 },
        { app: 'beta', component: 'api', status: 'stopped', ip: '10.0.0.3', port: 3001 },
      ],
    });

    const listAll = await invokeCli(['apps', 'list-all', '--json'], { toolRuntime, persistedStateMode: 'on' });
    expect(listAll.exitCode).toBe(0);
    expect(JSON.parse(listAll.stdout)).toMatchObject({
      ok: true,
      count: 3,
      items: [{ name: 'alpha' }, { name: 'beta' }, { name: 'gamma' }],
    });

    const listGlobal = await invokeCli(['apps', 'list-global', '--owner', 'owner-a', '--json'], {
      toolRuntime,
      persistedStateMode: 'on',
    });
    expect(listGlobal.exitCode).toBe(0);
    expect(JSON.parse(listGlobal.stdout)).toMatchObject({
      ok: true,
      count: 1,
      filters: { owner: 'owner-a', appname: null, hash: null },
      items: [{ name: 'alpha', owner: 'owner-a', hash: 'hash-a' }],
    });

    const globalStatus = await invokeCli(['apps', 'global-status', '--appname', 'alpha', '--json'], {
      toolRuntime,
      persistedStateMode: 'on',
    });
    expect(globalStatus.exitCode).toBe(0);
    expect(JSON.parse(globalStatus.stdout)).toMatchObject({
      ok: true,
      count: 1,
      filters: { appname: 'alpha', zelid: null, includeExpired: false, limit: 50 },
      propagation: { tempYes: 1, permYes: 0, both: 0, neither: 0 },
      items: [{ name: 'alpha', hash: 'hash-a', hasTemporary: true, hasPermanent: false }],
    });
  });

  it('defaults by-zelid to persisted auth and normalizes supporting metadata surfaces', async () => {
    await withTempStateDir(async (stateDir) => {
      await seedState(stateDir, {
        version: 1,
        activeProfile: 'default',
        profiles: {
          default: {
            baseUrl: 'https://api.runonflux.io',
            zelidauth: JSON.stringify({ zelid: 'stored-zelid', signature: 'sig', loginPhrase: 'phrase' }),
            enterpriseKey: 'enterprise-key',
            fluxDriveMwsBaseUrl: 'https://mws.fluxdrive.runonflux.io',
            httpDefaults: { timeoutMs: 30000, retryCount: 2, retryBackoffMs: 500 },
          },
        },
      });

      const toolRuntime = createFakeAppsToolRuntime();

      const byZelid = await invokeCli(['apps', 'by-zelid', '--json'], {
        toolRuntime,
        persistedStateMode: 'on',
      });
      expect(byZelid.exitCode).toBe(0);
      expect(JSON.parse(byZelid.stdout)).toMatchObject({
        ok: true,
        zelid: 'stored-zelid',
        count: 1,
        items: [{ name: 'alpha', owner: 'stored-zelid', expired: false, blocksRemaining: 15 }],
      });

      const owner = await invokeCli(['apps', 'get-owner', 'alpha', '--json'], { toolRuntime, persistedStateMode: 'on' });
      expect(owner.exitCode).toBe(0);
      expect(JSON.parse(owner.stdout)).toMatchObject({ ok: true, appname: 'alpha', owner: 'owner-a' });

      const publicKey = await invokeCli(
        ['apps', 'get-public-key', '--owner', 'owner-a', '--name', 'alpha', '--json'],
        { toolRuntime, persistedStateMode: 'on' }
      );
      expect(publicKey.exitCode).toBe(0);
      expect(JSON.parse(publicKey.stdout)).toMatchObject({ ok: true, owner: 'owner-a', name: 'alpha', publicKey: 'PUBLIC_KEY_VALUE' });

      const registration = await invokeCli(['apps', 'registration-information', '--json'], {
        toolRuntime,
        persistedStateMode: 'on',
      });
      expect(registration.exitCode).toBe(0);
      expect(JSON.parse(registration.stdout)).toMatchObject({
        ok: true,
        registrationInformation: { blocksLasting: 100, daemonPONFork: 1 },
      });

      const deployment = await invokeCli(['apps', 'deployment-information', '--json'], {
        toolRuntime,
        persistedStateMode: 'on',
      });
      expect(deployment.exitCode).toBe(0);
      expect(JSON.parse(deployment.stdout)).toMatchObject({
        ok: true,
        deploymentInformation: { address: 't1payment' },
      });
    });
  });

  it('returns parsed spec data for get-spec and non-enterprise get-spec-full', async () => {
    const toolRuntime = createFakeAppsToolRuntime();

    const getSpec = await invokeCli(['apps', 'get-spec', 'myent', '--json'], { toolRuntime, persistedStateMode: 'on' });
    expect(getSpec.exitCode).toBe(0);
    expect(JSON.parse(getSpec.stdout)).toMatchObject({
      ok: true,
      appname: 'myent',
      enterpriseDetected: true,
      spec: { name: 'myent', version: 8, enterprise: 'ENCRYPTED' },
      nextActions: [{ tool: 'flux_apps_get_spec_full', arguments: { appname: 'myent' } }],
    });

    const getSpecFull = await invokeCli(['apps', 'get-spec-full', 'myapp', '--json'], {
      toolRuntime,
      persistedStateMode: 'on',
    });
    expect(getSpecFull.exitCode).toBe(0);
    expect(JSON.parse(getSpecFull.stdout)).toMatchObject({
      ok: true,
      appname: 'myapp',
      enterprise: false,
      spec: { name: 'myapp', compose: [{ name: 'web', repotag: 'nginx:latest' }] },
    });
  });

  it('enforces enterprise safeguards and decrypts enterprise specs through the real runtime', async () => {
    await withTempStateDir(async () => {
      await withEnterpriseServers(async ({ baseUrl, seenPrimary, seenArcane }) => {
        process.env.FLUX_API_BASE_URL = baseUrl;

        const noAuth = await invokeCli(['apps', 'get-spec-full', 'myent', '--json']);
        expect(noAuth.exitCode).toBe(3);
        expect(JSON.parse(noAuth.stdout)).toMatchObject({
          ok: false,
          status: 'auth_required',
          appname: 'myent',
          enterprise: true,
        });
        expect(JSON.parse(noAuth.stdout)).not.toHaveProperty('spec');

        process.env.FLUX_ZELIDAUTH = JSON.stringify({ zelid: 'owner-a', signature: 'sig', loginPhrase: 'phrase' });

        const missingConfirm = await invokeCli(['apps', 'get-spec-full', 'myent', '--include-secrets', '--json']);
        expect(missingConfirm.exitCode).toBe(4);
        expect(JSON.parse(missingConfirm.stdout)).toMatchObject({
          ok: false,
          status: 'confirm_required',
        });

        const success = await invokeCli(['apps', 'get-spec-full', 'myent', '--json']);
        expect(success.exitCode).toBe(0);

        const payload = JSON.parse(success.stdout) as Record<string, unknown>;
        expect(payload).toMatchObject({
          ok: true,
          appname: 'myent',
          enterprise: true,
        });

        expect(asRecord(payload.spec)).toMatchObject({
          name: 'myent',
          compose: [{ name: 'web', repotag: 'nginx:latest', environmentParameters: ['API_TOKEN=<redacted>'] }],
          contacts: ['ops@example.com'],
        });

        expect(asRecord(payload.enterprisePayload)).toMatchObject({
          compose: [{ name: 'web', repotag: 'nginx:latest', environmentParameters: ['API_TOKEN=<redacted>'] }],
          contacts: ['ops@example.com'],
        });

        const resources = asRecord(payload.resources);
        expect(typeof resources.mergedSpec).toBe('string');
        expect(typeof resources.enterpriseDecrypted).toBe('string');
        expect(seenPrimary.some((entry) => entry.url === '/apps/location/myent')).toBe(true);
        expect(seenArcane.some((entry) => entry.url === '/apps/getpublickey')).toBe(true);
        expect(seenArcane.some((entry) => entry.url === '/apps/appspecifications/myent/true')).toBe(true);
      });
    });
  });
});
