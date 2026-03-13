import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { runCli } from '../src/cli.js';

const DEFAULT_HTTP_DEFAULTS = {
  timeoutMs: 30000,
  retryCount: 2,
  retryBackoffMs: 500,
};

const DEFAULT_FLUXDRIVE_BASE_URL = 'https://mws.fluxdrive.runonflux.io';

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

function normalizeBaseUrl(value: string): string {
  const parsed = new URL(value);
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('Base URL must start with http:// or https://');
  }

  return value.replace(/\/+$/, '');
}

function summarizeZelidauth(raw: string | null): { present: boolean; zelid?: string } {
  if (!raw) return { present: false };

  try {
    const parsed = JSON.parse(raw) as unknown;
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      const zelid = asRecord(parsed).zelid;
      if (typeof zelid === 'string' && zelid.trim()) {
        return { present: true, zelid: zelid.trim() };
      }
    }
  } catch {
    // Non-JSON auth values still count as present.
  }

  return { present: true };
}

function createFakeNodeToolRuntime() {
  let baseUrl = 'https://api.runonflux.io';
  let zelidauth: string | null = null;
  let enterpriseKey: string | null = null;
  let httpDefaults = { ...DEFAULT_HTTP_DEFAULTS };
  let fluxDriveMwsBaseUrl = DEFAULT_FLUXDRIVE_BASE_URL;
  const zelidauthByBaseUrl = new Map<string, string>();
  const enterpriseKeyByBaseUrl = new Map<string, string>();

  const adoptCachedCredentials = () => {
    if (zelidauthByBaseUrl.has(baseUrl)) {
      zelidauth = zelidauthByBaseUrl.get(baseUrl) ?? null;
    }

    if (enterpriseKeyByBaseUrl.has(baseUrl)) {
      enterpriseKey = enterpriseKeyByBaseUrl.get(baseUrl) ?? null;
    }
  };

  const cacheCurrentCredentials = () => {
    if (zelidauth) {
      zelidauthByBaseUrl.set(baseUrl, zelidauth);
    }

    if (enterpriseKey) {
      enterpriseKeyByBaseUrl.set(baseUrl, enterpriseKey);
    }
  };

  const jsonResult = (payload: Record<string, unknown>, isError = false) => ({
    isError,
    structuredContent: payload,
    content: [{ type: 'text', text: JSON.stringify(payload) }],
  });

  return {
    async listTools() {
      return [];
    },

    async callTool(name: string, rawArgs: unknown) {
      const args = asRecord(rawArgs);

      switch (name) {
        case 'flux_clear_zelidauth':
          zelidauthByBaseUrl.delete(baseUrl);
          zelidauth = null;
          return jsonResult({ ok: true, zelidauth: summarizeZelidauth(zelidauth) });

        case 'flux_clear_enterprise_key':
          enterpriseKeyByBaseUrl.delete(baseUrl);
          enterpriseKey = null;
          return jsonResult({ ok: true, enterpriseKey: { present: false } });

        case 'flux_set_base_url':
          baseUrl = normalizeBaseUrl(String(args.baseUrl));
          adoptCachedCredentials();
          return jsonResult({ ok: true, baseUrl });

        case 'flux_set_http_defaults':
          httpDefaults = {
            timeoutMs: typeof args.timeoutMs === 'number' ? args.timeoutMs : httpDefaults.timeoutMs,
            retryCount: typeof args.retryCount === 'number' ? args.retryCount : httpDefaults.retryCount,
            retryBackoffMs: typeof args.retryBackoffMs === 'number' ? args.retryBackoffMs : httpDefaults.retryBackoffMs,
          };
          return jsonResult({ ok: true, httpDefaults });

        case 'flux_fluxdrive_set_base_url':
          fluxDriveMwsBaseUrl = normalizeBaseUrl(String(args.baseUrl));
          return jsonResult({ ok: true, fluxDriveMwsBaseUrl });

        case 'flux_set_zelidauth': {
          const value = args.zelidauth;
          if (typeof value === 'string' && value.trim()) {
            zelidauth = value;
          } else if (value && typeof value === 'object' && !Array.isArray(value)) {
            zelidauth = JSON.stringify(value);
          } else {
            return jsonResult({ ok: false, error: 'zelidauth must be a non-empty string or object' }, true);
          }

          cacheCurrentCredentials();
          return jsonResult({ ok: true, zelidauth: summarizeZelidauth(zelidauth) });
        }

        case 'flux_set_enterprise_key': {
          const value = typeof args.enterpriseKey === 'string' ? args.enterpriseKey.trim() : '';
          if (!value) {
            return jsonResult({ ok: false, error: 'enterpriseKey must be a non-empty string' }, true);
          }

          enterpriseKey = value;
          cacheCurrentCredentials();
          return jsonResult({ ok: true, enterpriseKey: { present: true } });
        }

        case 'flux_get_state': {
          const authSummary = summarizeZelidauth(zelidauth);
          return jsonResult({
            baseUrl,
            zelidauth: authSummary,
            enterpriseKey: { present: Boolean(enterpriseKey) },
            httpDefaults,
            fluxDriveMwsBaseUrl,
          });
        }

        case 'flux_auth_login': {
          const zelid = typeof args.zelid === 'string' ? args.zelid.trim() : '';
          const signature = typeof args.signature === 'string' ? args.signature.trim() : '';
          const loginPhrase = typeof args.loginPhrase === 'string' ? args.loginPhrase : '';
          const gatewayBaseUrl =
            typeof args.gatewayBaseUrl === 'string' && args.gatewayBaseUrl.trim() ? normalizeBaseUrl(args.gatewayBaseUrl.trim()) : null;
          const pinnedBaseUrl = gatewayBaseUrl ? 'http://10.0.0.2:16127' : null;

          if (!signature || !loginPhrase) {
            return jsonResult({ ok: true, zelid, gatewayBaseUrl, pinnedBaseUrl, needSignature: true, loginPhrase: 'sign-me-please' });
          }

          if (pinnedBaseUrl) {
            baseUrl = pinnedBaseUrl;
            adoptCachedCredentials();
          }

          zelidauth = JSON.stringify({ zelid, signature, loginPhrase });
          cacheCurrentCredentials();
          return jsonResult({ ok: true, baseUrl, zelid, gatewayBaseUrl, pinnedBaseUrl, zelidauthSet: true });
        }

        case 'flux_resolve_gateway_node': {
          const gatewayBaseUrl = typeof args.gatewayBaseUrl === 'string' ? normalizeBaseUrl(String(args.gatewayBaseUrl)) : null;
          if (gatewayBaseUrl === 'https://broken.gateway.example') {
            return jsonResult({ ok: false, error: 'Could not resolve node IP from /flux/info response' }, true);
          }

          return jsonResult({
            ok: true,
            gatewayBaseUrl,
            fluxnode: '10.0.0.2',
            ip: '10.0.0.2',
            recommendedBaseUrl: 'http://10.0.0.2:16127',
          });
        }

        case 'flux_set_base_url_from_gateway': {
          const gatewayBaseUrl = typeof args.gatewayBaseUrl === 'string' ? normalizeBaseUrl(String(args.gatewayBaseUrl)) : null;
          if (gatewayBaseUrl === 'https://broken.gateway.example') {
            return jsonResult({ ok: false, error: 'Could not resolve node IP from /flux/info response' }, true);
          }

          baseUrl = 'http://10.0.0.2:16127';
          adoptCachedCredentials();

          return jsonResult({
            ok: true,
            gatewayBaseUrl,
            fluxnode: '10.0.0.2',
            ip: '10.0.0.2',
            recommendedBaseUrl: 'http://10.0.0.2:16127',
            baseUrl,
          });
        }

        default:
          return jsonResult({ ok: false, error: `Unknown tool: ${name}` }, true);
      }
    },
  };
}

async function withTempStateDir<T>(run: (stateDir: string) => Promise<T>) {
  const stateDir = await mkdtemp(join(tmpdir(), 'fluxos-cli-node-helpers-'));
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
    toolRuntime?: ReturnType<typeof createFakeNodeToolRuntime>;
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

async function readStateFileIfPresent(stateDir: string) {
  const stateFile = join(stateDir, 'state.json');

  try {
    return JSON.parse(await readFile(stateFile, 'utf8')) as {
      activeProfile: string;
      profiles: Record<string, Record<string, unknown>>;
    };
  } catch (error) {
    const code = error instanceof Error && 'code' in error ? String((error as NodeJS.ErrnoException).code) : null;
    if (code === 'ENOENT') return null;
    throw error;
  }
}

async function seedScopedState(stateDir: string) {
  const stateFile = join(stateDir, 'state.json');
  await writeFile(
    stateFile,
    JSON.stringify(
      {
        version: 1,
        activeProfile: 'ops',
        profiles: {
          ops: {
            baseUrl: 'https://ops.example/',
            zelidauth: JSON.stringify({ zelid: 'ops-user', signature: 'ops-signature', loginPhrase: 'ops-phrase' }),
            enterpriseKey: 'ops-enterprise-key',
            fluxDriveMwsBaseUrl: 'https://mws.ops.example/',
            httpDefaults: {
              timeoutMs: 12000,
              retryCount: 4,
              retryBackoffMs: 900,
            },
          },
        },
      },
      null,
      2
    ),
    'utf8'
  );

  return stateFile;
}

describe.sequential('node-helpers', () => {
  it('resolve-gateway is read-only and reports the recommended direct node', async () => {
    await withTempStateDir(async (stateDir) => {
      const stateFile = await seedScopedState(stateDir);
      const before = await readFile(stateFile, 'utf8');

      const result = await invokeCli(['node', 'resolve-gateway', 'https://api.runonflux.io', '--json'], {
        toolRuntime: createFakeNodeToolRuntime(),
        persistedStateMode: 'on',
      });

      expect(result.exitCode).toBe(0);
      expect(result.stderr).toBe('');

      const payload = JSON.parse(result.stdout) as Record<string, unknown>;
      expect(payload).toMatchObject({
        ok: true,
        activeProfile: 'ops',
        gatewayBaseUrl: 'https://api.runonflux.io',
        recommendedBaseUrl: 'http://10.0.0.2:16127',
      });

      expect(await readFile(stateFile, 'utf8')).toBe(before);
    });
  });

  it('use-gateway preserves the previous baseUrl on failure', async () => {
    await withTempStateDir(async (stateDir) => {
      const stateFile = await seedScopedState(stateDir);
      const before = await readFile(stateFile, 'utf8');

      const result = await invokeCli(['node', 'use-gateway', 'https://broken.gateway.example', '--json'], {
        toolRuntime: createFakeNodeToolRuntime(),
        persistedStateMode: 'on',
      });

      expect(result.exitCode).toBe(6);
      expect(result.stderr).toBe('');
      expect(JSON.parse(result.stdout)).toMatchObject({
        ok: false,
        status: 'flux_error',
        error: 'Could not resolve node IP from /flux/info response',
      });
      expect(await readFile(stateFile, 'utf8')).toBe(before);
    });
  });

  it('use-gateway persists the direct-node target and adopts cached credentials', async () => {
    await withTempStateDir(async (stateDir) => {
      await seedScopedState(stateDir);

      const login = await invokeCli(
        [
          'auth',
          'login',
          '--zelid',
          'direct-user',
          '--signature',
          'direct-signature',
          '--login-phrase',
          'direct-phrase',
          '--gateway-base-url',
          'https://api.runonflux.io',
          '--json',
        ],
        {
          toolRuntime: createFakeNodeToolRuntime(),
          persistedStateMode: 'on',
        }
      );

      expect(login.exitCode).toBe(0);

      const result = await invokeCli(['node', 'use-gateway', 'https://api.runonflux.io', '--json'], {
        toolRuntime: createFakeNodeToolRuntime(),
        persistedStateMode: 'on',
      });

      expect(result.exitCode).toBe(0);
      expect(result.stderr).toBe('');

      const payload = JSON.parse(result.stdout) as Record<string, unknown>;
      expect(payload).toMatchObject({
        ok: true,
        activeProfile: 'ops',
        baseUrl: 'http://10.0.0.2:16127',
        recommendedBaseUrl: 'http://10.0.0.2:16127',
        auth: { present: true, zelid: 'direct-user' },
      });

      const persisted = await readStateFileIfPresent(stateDir);
      expect(persisted?.profiles.ops).toMatchObject({
        baseUrl: 'http://10.0.0.2:16127',
        zelidauth: JSON.stringify({ zelid: 'direct-user', signature: 'direct-signature', loginPhrase: 'direct-phrase' }),
      });
    });
  });

  it('use-gateway clears stale auth and enterprise key when the resolved node is uncached', async () => {
    await withTempStateDir(async (stateDir) => {
      await seedScopedState(stateDir);

      const result = await invokeCli(['node', 'use-gateway', 'https://api.runonflux.io', '--json'], {
        toolRuntime: createFakeNodeToolRuntime(),
        persistedStateMode: 'on',
      });

      expect(result.exitCode).toBe(0);
      expect(result.stderr).toBe('');
      expect(JSON.parse(result.stdout)).toMatchObject({
        ok: true,
        activeProfile: 'ops',
        baseUrl: 'http://10.0.0.2:16127',
        recommendedBaseUrl: 'http://10.0.0.2:16127',
        auth: { present: false },
        enterpriseKey: { present: false },
      });

      const persisted = await readStateFileIfPresent(stateDir);
      expect(persisted?.profiles.ops).toMatchObject({
        baseUrl: 'http://10.0.0.2:16127',
        zelidauth: null,
        enterpriseKey: null,
        zelidauthByBaseUrl: {
          'https://ops.example': JSON.stringify({ zelid: 'ops-user', signature: 'ops-signature', loginPhrase: 'ops-phrase' }),
        },
        enterpriseKeyByBaseUrl: {
          'https://ops.example': 'ops-enterprise-key',
        },
      });

      const status = await invokeCli(['auth', 'status', '--json'], {
        toolRuntime: createFakeNodeToolRuntime(),
        persistedStateMode: 'on',
      });

      expect(status.exitCode).toBe(0);
      expect(JSON.parse(status.stdout)).toMatchObject({
        ok: true,
        baseUrl: 'http://10.0.0.2:16127',
        auth: { present: false },
        enterpriseKey: { present: false },
      });
    });
  });

  it('use-base-url normalizes explicit URLs and adopts matching cached credentials', async () => {
    await withTempStateDir(async (stateDir) => {
      await writeFile(
        join(stateDir, 'state.json'),
        JSON.stringify(
          {
            version: 1,
            activeProfile: 'ops',
            profiles: {
              ops: {
                baseUrl: 'https://ops.example/',
                zelidauth: JSON.stringify({ zelid: 'ops-user', signature: 'ops-signature', loginPhrase: 'ops-phrase' }),
                enterpriseKey: 'ops-enterprise-key',
                fluxDriveMwsBaseUrl: 'https://mws.ops.example/',
                httpDefaults: {
                  timeoutMs: 12000,
                  retryCount: 4,
                  retryBackoffMs: 900,
                },
                zelidauthByBaseUrl: {
                  'https://ops.example': JSON.stringify({ zelid: 'ops-user', signature: 'ops-signature', loginPhrase: 'ops-phrase' }),
                  'http://10.0.0.2:16127': JSON.stringify({ zelid: 'direct-user', signature: 'direct-signature', loginPhrase: 'direct-phrase' }),
                },
                enterpriseKeyByBaseUrl: {
                  'https://ops.example': 'ops-enterprise-key',
                  'http://10.0.0.2:16127': 'direct-enterprise-key',
                },
              },
            },
          },
          null,
          2
        ),
        'utf8'
      );

      const result = await invokeCli(['node', 'use-base-url', 'http://10.0.0.2:16127///', '--json'], {
        persistedStateMode: 'on',
      });

      expect(result.exitCode).toBe(0);
      expect(result.stderr).toBe('');
      expect(JSON.parse(result.stdout)).toMatchObject({
        ok: true,
        activeProfile: 'ops',
        requestedBaseUrl: 'http://10.0.0.2:16127///',
        baseUrl: 'http://10.0.0.2:16127',
        auth: { present: true, zelid: 'direct-user' },
        enterpriseKey: { present: true },
      });

      const status = await invokeCli(['auth', 'status', '--json'], {
        toolRuntime: createFakeNodeToolRuntime(),
        persistedStateMode: 'on',
      });

      expect(status.exitCode).toBe(0);
      expect(JSON.parse(status.stdout)).toMatchObject({
        ok: true,
        baseUrl: 'http://10.0.0.2:16127',
        auth: { present: true, zelid: 'direct-user' },
      });
    });
  });

  it('use-base-url clears stale auth and enterprise key when the target base URL is uncached', async () => {
    await withTempStateDir(async (stateDir) => {
      await seedScopedState(stateDir);

      const result = await invokeCli(['node', 'use-base-url', 'http://10.0.0.9:16127///', '--json'], {
        persistedStateMode: 'on',
      });

      expect(result.exitCode).toBe(0);
      expect(result.stderr).toBe('');
      expect(JSON.parse(result.stdout)).toMatchObject({
        ok: true,
        activeProfile: 'ops',
        requestedBaseUrl: 'http://10.0.0.9:16127///',
        baseUrl: 'http://10.0.0.9:16127',
        auth: { present: false },
        enterpriseKey: { present: false },
      });

      const persisted = await readStateFileIfPresent(stateDir);
      expect(persisted?.profiles.ops).toMatchObject({
        baseUrl: 'http://10.0.0.9:16127',
        zelidauth: null,
        enterpriseKey: null,
        zelidauthByBaseUrl: {
          'https://ops.example': JSON.stringify({ zelid: 'ops-user', signature: 'ops-signature', loginPhrase: 'ops-phrase' }),
        },
        enterpriseKeyByBaseUrl: {
          'https://ops.example': 'ops-enterprise-key',
        },
      });

      const status = await invokeCli(['auth', 'status', '--json'], {
        toolRuntime: createFakeNodeToolRuntime(),
        persistedStateMode: 'on',
      });

      expect(status.exitCode).toBe(0);
      expect(JSON.parse(status.stdout)).toMatchObject({
        ok: true,
        baseUrl: 'http://10.0.0.9:16127',
        auth: { present: false },
        enterpriseKey: { present: false },
      });
    });
  });
});
