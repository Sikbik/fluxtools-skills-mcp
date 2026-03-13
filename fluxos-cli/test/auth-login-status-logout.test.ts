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

function createFakeAuthToolRuntime() {
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
          if (baseUrl) {
            zelidauthByBaseUrl.delete(baseUrl);
          }
          zelidauth = null;
          return jsonResult({ ok: true, zelidauth: summarizeZelidauth(zelidauth) });

        case 'flux_clear_enterprise_key':
          if (baseUrl) {
            enterpriseKeyByBaseUrl.delete(baseUrl);
          }
          enterpriseKey = null;
          return jsonResult({ ok: true, enterpriseKey: { present: false } });

        case 'flux_set_base_url':
          baseUrl = normalizeBaseUrl(String(args.baseUrl));
          adoptCachedCredentials();
          return jsonResult({ ok: true, baseUrl });

        case 'flux_set_base_url_from_gateway': {
          const gatewayBaseUrl = typeof args.gatewayBaseUrl === 'string' ? normalizeBaseUrl(String(args.gatewayBaseUrl)) : null;
          if (gatewayBaseUrl === 'https://broken.gateway.example') {
            return jsonResult({ ok: false, error: 'Could not resolve node IP from /flux/info response' }, true);
          }

          const recommendedBaseUrl = gatewayBaseUrl === 'https://api.runonflux.io'
            ? 'http://10.0.0.2:16127'
            : 'http://10.0.0.3:16127';

          baseUrl = recommendedBaseUrl;
          adoptCachedCredentials();

          return jsonResult({
            ok: true,
            gatewayBaseUrl,
            fluxnode: recommendedBaseUrl.replace('http://', '').replace(':16127', ''),
            ip: recommendedBaseUrl.replace('http://', '').replace(':16127', ''),
            recommendedBaseUrl,
            baseUrl,
          });
        }

        case 'flux_resolve_gateway_node': {
          const gatewayBaseUrl = typeof args.gatewayBaseUrl === 'string' ? normalizeBaseUrl(String(args.gatewayBaseUrl)) : null;
          if (gatewayBaseUrl === 'https://broken.gateway.example') {
            return jsonResult({ ok: false, error: 'Could not resolve node IP from /flux/info response' }, true);
          }

          const recommendedBaseUrl = gatewayBaseUrl === 'https://api.runonflux.io'
            ? 'http://10.0.0.2:16127'
            : 'http://10.0.0.3:16127';

          return jsonResult({
            ok: true,
            gatewayBaseUrl,
            fluxnode: recommendedBaseUrl.replace('http://', '').replace(':16127', ''),
            ip: recommendedBaseUrl.replace('http://', '').replace(':16127', ''),
            recommendedBaseUrl,
          });
        }

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
            zelidauthCache: {
              count: authSummary.present ? 1 : 0,
              entries: authSummary.present ? [{ baseUrl, ...(authSummary.zelid ? { zelid: authSummary.zelid } : {}) }] : [],
            },
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
            const payload = {
              ok: true,
              zelid,
              gatewayBaseUrl,
              pinnedBaseUrl,
              needSignature: true,
              loginPhrase: 'sign-me-please',
              nextActions: [
                {
                  tool: 'flux_auth_login',
                  arguments: { zelid, loginPhrase: 'sign-me-please', signature: '<SIGNATURE>' },
                },
              ],
            };

            return {
              isError: false,
              structuredContent: payload,
              content: [
                { type: 'text', text: JSON.stringify(payload) },
                { type: 'resource_link', uri: 'flux://resource/auth-login-phrase', name: 'Login phrase', mimeType: 'text/plain' },
              ],
            };
          }

          if (signature === 'bad-signature') {
            return jsonResult({ ok: false, error: 'verifylogin failed' }, true);
          }

          if (pinnedBaseUrl) {
            baseUrl = pinnedBaseUrl;
            adoptCachedCredentials();
          }

          zelidauth = JSON.stringify({ zelid, signature, loginPhrase });
          cacheCurrentCredentials();
          return jsonResult({
            ok: true,
            baseUrl,
            zelid,
            gatewayBaseUrl,
            pinnedBaseUrl,
            zelidauthSet: true,
            verifyCalled: true,
            privilegeCalled: true,
            privilege: 'admin',
          });
        }

        default:
          return jsonResult({ ok: false, error: `Unknown tool: ${name}` }, true);
      }
    },
  };
}

async function withTempStateDir<T>(run: (stateDir: string) => Promise<T>) {
  const stateDir = await mkdtemp(join(tmpdir(), 'fluxos-cli-auth-'));
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
    toolRuntime?: ReturnType<typeof createFakeAuthToolRuntime>;
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
          standby: {
            baseUrl: 'https://standby.example/',
            zelidauth: JSON.stringify({ zelid: 'standby-user', signature: 'standby-signature', loginPhrase: 'standby-phrase' }),
            enterpriseKey: 'standby-enterprise-key',
            fluxDriveMwsBaseUrl: 'https://mws.standby.example/',
            httpDefaults: {
              timeoutMs: 41000,
              retryCount: 1,
              retryBackoffMs: 250,
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

describe.sequential('auth-login status logout', () => {
  it('keeps phrase-first login state unchanged until verification succeeds', async () => {
    await withTempStateDir(async (stateDir) => {
      const loginResult = await invokeCli(['auth', 'login', '--zelid', 'zelid123', '--json'], {
        toolRuntime: createFakeAuthToolRuntime(),
        persistedStateMode: 'on',
      });

      expect(loginResult.exitCode).toBe(0);
      expect(loginResult.stderr).toBe('');

      const loginPayload = JSON.parse(loginResult.stdout) as Record<string, unknown>;
      expect(loginPayload.ok).toBe(true);
      expect(loginPayload.needSignature).toBe(true);
      expect(loginPayload.loginPhrase).toBe('sign-me-please');
      expect(loginPayload.activeProfile).toBe('default');
      expect(loginPayload.resourceUri).toBe('flux://resource/auth-login-phrase');
      expect(loginPayload.nextActions).toEqual([
        {
          tool: 'flux_auth_login',
          arguments: { zelid: 'zelid123', loginPhrase: 'sign-me-please', signature: '<SIGNATURE>' },
        },
      ]);

      expect(await readStateFileIfPresent(stateDir)).toBeNull();

      const statusResult = await invokeCli(['auth', 'status', '--json'], {
        toolRuntime: createFakeAuthToolRuntime(),
        persistedStateMode: 'on',
      });

      expect(statusResult.exitCode).toBe(0);
      const statusPayload = JSON.parse(statusResult.stdout) as Record<string, unknown>;
      expect(statusPayload.ok).toBe(true);
      expect(statusPayload.activeProfile).toBe('default');
      expect(statusPayload.baseUrl).toBe('https://api.runonflux.io');
      expect(statusPayload.auth).toEqual({ present: false });
    });
  });

  it('persists verified auth and exposes it through auth status', async () => {
    await withTempStateDir(async (stateDir) => {
      const loginResult = await invokeCli(
        [
          'auth',
          'login',
          '--zelid',
          'zelid123',
          '--signature',
          'good-signature',
          '--login-phrase',
          'sign-me-please',
          '--gateway-base-url',
          'https://api.runonflux.io',
          '--json',
        ],
        {
          toolRuntime: createFakeAuthToolRuntime(),
          persistedStateMode: 'on',
        }
      );

      expect(loginResult.exitCode).toBe(0);
      expect(loginResult.stderr).toBe('');

      const loginPayload = JSON.parse(loginResult.stdout) as Record<string, unknown>;
      expect(loginPayload.ok).toBe(true);
      expect(loginPayload.zelidauthSet).toBe(true);
      expect(loginPayload.baseUrl).toBe('http://10.0.0.2:16127');
      expect(loginPayload.activeProfile).toBe('default');
      expect(loginPayload.privilege).toBe('admin');

      const persisted = await readStateFileIfPresent(stateDir);
      expect(persisted?.activeProfile).toBe('default');
      expect(persisted?.profiles.default.baseUrl).toBe('http://10.0.0.2:16127');
      expect(persisted?.profiles.default.zelidauth).toBe(
        JSON.stringify({ zelid: 'zelid123', signature: 'good-signature', loginPhrase: 'sign-me-please' })
      );

      const statusResult = await invokeCli(['auth', 'status', '--json'], {
        toolRuntime: createFakeAuthToolRuntime(),
        persistedStateMode: 'on',
      });

      expect(statusResult.exitCode).toBe(0);
      expect(statusResult.stderr).toBe('');

      const statusPayload = JSON.parse(statusResult.stdout) as Record<string, unknown>;
      expect(statusPayload.ok).toBe(true);
      expect(statusPayload.activeProfile).toBe('default');
      expect(statusPayload.baseUrl).toBe('http://10.0.0.2:16127');
      expect(statusPayload.auth).toEqual({ present: true, zelid: 'zelid123' });
    });
  });

  it('does not persist auth when signature verification fails', async () => {
    await withTempStateDir(async (stateDir) => {
      const loginResult = await invokeCli(
        [
          'auth',
          'login',
          '--zelid',
          'zelid123',
          '--signature',
          'bad-signature',
          '--login-phrase',
          'sign-me-please',
          '--json',
        ],
        {
          toolRuntime: createFakeAuthToolRuntime(),
          persistedStateMode: 'on',
        }
      );

      expect(loginResult.exitCode).toBe(6);
      expect(loginResult.stderr).toBe('');

      const failurePayload = JSON.parse(loginResult.stdout) as Record<string, unknown>;
      expect(failurePayload.ok).toBe(false);
      expect(failurePayload.status).toBe('flux_error');
      expect(failurePayload.error).toBe('verifylogin failed');

      expect(await readStateFileIfPresent(stateDir)).toBeNull();
    });
  });

  it('reports auth status without mutating persisted state', async () => {
    await withTempStateDir(async (stateDir) => {
      const stateFile = await seedScopedState(stateDir);
      const before = await readFile(stateFile, 'utf8');

      const statusResult = await invokeCli(['auth', 'status', '--json'], {
        toolRuntime: createFakeAuthToolRuntime(),
        persistedStateMode: 'on',
      });

      expect(statusResult.exitCode).toBe(0);
      expect(statusResult.stderr).toBe('');

      const payload = JSON.parse(statusResult.stdout) as Record<string, unknown>;
      expect(payload.ok).toBe(true);
      expect(payload.activeProfile).toBe('ops');
      expect(payload.baseUrl).toBe('https://ops.example');
      expect(payload.auth).toEqual({ present: true, zelid: 'ops-user' });

      const after = await readFile(stateFile, 'utf8');
      expect(after).toBe(before);
    });
  });

  it('logout clears only active auth state', async () => {
    await withTempStateDir(async (stateDir) => {
      const stateFile = await seedScopedState(stateDir);

      const logoutResult = await invokeCli(['auth', 'logout', '--json'], {
        toolRuntime: createFakeAuthToolRuntime(),
        persistedStateMode: 'on',
      });

      expect(logoutResult.exitCode).toBe(0);
      expect(logoutResult.stderr).toBe('');

      const payload = JSON.parse(logoutResult.stdout) as {
        ok: boolean;
        status: string;
        action: string;
        target: string;
        state: {
          activeProfile: string;
          baseUrl: string | null;
          auth: { present: boolean; zelid?: string };
          enterpriseKey: { present: boolean };
          fluxDriveMwsBaseUrl: string;
          httpDefaults: { timeoutMs: number; retryCount: number; retryBackoffMs: number };
        };
      };

      expect(payload.ok).toBe(true);
      expect(payload.status).toBe('ok');
      expect(payload.action).toBe('logout');
      expect(payload.target).toBe('auth');
      expect(payload.state.activeProfile).toBe('ops');
      expect(payload.state.baseUrl).toBe('https://ops.example');
      expect(payload.state.auth).toEqual({ present: false });
      expect(payload.state.enterpriseKey).toEqual({ present: true });
      expect(payload.state.fluxDriveMwsBaseUrl).toBe('https://mws.ops.example');
      expect(payload.state.httpDefaults).toEqual({ timeoutMs: 12000, retryCount: 4, retryBackoffMs: 900 });

      const persisted = JSON.parse(await readFile(stateFile, 'utf8')) as {
        activeProfile: string;
        profiles: Record<string, {
          baseUrl: string | null;
          zelidauth: string | null;
          enterpriseKey: string | null;
          fluxDriveMwsBaseUrl: string;
          httpDefaults: { timeoutMs: number; retryCount: number; retryBackoffMs: number };
        }>;
      };

      expect(persisted.activeProfile).toBe('ops');
      expect(persisted.profiles.ops).toEqual({
        baseUrl: 'https://ops.example',
        zelidauth: null,
        enterpriseKey: 'ops-enterprise-key',
        fluxDriveMwsBaseUrl: 'https://mws.ops.example',
        httpDefaults: { timeoutMs: 12000, retryCount: 4, retryBackoffMs: 900 },
      });
      expect(persisted.profiles.standby.zelidauth).toBe(
        JSON.stringify({ zelid: 'standby-user', signature: 'standby-signature', loginPhrase: 'standby-phrase' })
      );
      expect(persisted.profiles.standby.enterpriseKey).toBe('standby-enterprise-key');
    });
  });
});
