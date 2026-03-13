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

type FakeRuntimeOptions = {
  loginPhraseFails?: boolean;
};

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

function createFakeAuthToolRuntime(options: FakeRuntimeOptions = {}) {
  let baseUrl = 'https://api.runonflux.io';
  let zelidauth: string | null = null;
  let enterpriseKey: string | null = null;
  let httpDefaults = { ...DEFAULT_HTTP_DEFAULTS };
  let fluxDriveMwsBaseUrl = DEFAULT_FLUXDRIVE_BASE_URL;

  const jsonResult = (payload: Record<string, unknown>, isError = false) => ({
    isError,
    structuredContent: payload,
    content: [{ type: 'text', text: JSON.stringify(payload) }],
  });

  const requestSuccess = (value: unknown) => ({
    ok: true,
    status: 200,
    data: {
      status: 'success',
      data: value,
    },
  });

  const requestFailure = (message: string) => ({
    ok: false,
    status: 503,
    data: {
      status: 'error',
      data: message,
    },
  });

  return {
    async listTools() {
      return [];
    },

    async callTool(name: string, rawArgs: unknown) {
      const args = asRecord(rawArgs);

      switch (name) {
        case 'flux_clear_zelidauth':
          zelidauth = null;
          return jsonResult({ ok: true, zelidauth: summarizeZelidauth(zelidauth) });

        case 'flux_clear_enterprise_key':
          enterpriseKey = null;
          return jsonResult({ ok: true, enterpriseKey: { present: false } });

        case 'flux_set_base_url':
          baseUrl = normalizeBaseUrl(String(args.baseUrl));
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

          return jsonResult({ ok: true, zelidauth: summarizeZelidauth(zelidauth) });
        }

        case 'flux_set_enterprise_key': {
          const value = typeof args.enterpriseKey === 'string' ? args.enterpriseKey.trim() : '';
          if (!value) {
            return jsonResult({ ok: false, error: 'enterpriseKey must be a non-empty string' }, true);
          }

          enterpriseKey = value;
          return jsonResult({ ok: true, enterpriseKey: { present: true } });
        }

        case 'flux_auth_login': {
          const zelid = typeof args.zelid === 'string' ? args.zelid.trim() : '';
          const force = args.force === true;
          const signature = typeof args.signature === 'string' ? args.signature.trim() : '';
          const loginPhrase = typeof args.loginPhrase === 'string' ? args.loginPhrase : '';
          const gatewayBaseUrl =
            typeof args.gatewayBaseUrl === 'string' && args.gatewayBaseUrl.trim() ? normalizeBaseUrl(args.gatewayBaseUrl.trim()) : null;
          const pinnedBaseUrl = gatewayBaseUrl ? 'http://10.0.0.2:16127' : null;
          const currentAuth = summarizeZelidauth(zelidauth);

          if (!force && !signature && !loginPhrase && currentAuth.present && currentAuth.zelid === zelid) {
            return jsonResult({
              ok: true,
              zelid,
              baseUrl,
              alreadyAuthenticated: true,
              zelidauthSet: true,
            });
          }

          if (!signature || !loginPhrase) {
            const phrase = args.useEmergencyPhrase === true ? 'emergency-sign-me' : 'sign-me-please';
            const payload = {
              ok: true,
              zelid,
              gatewayBaseUrl,
              pinnedBaseUrl,
              needSignature: true,
              loginPhrase: phrase,
              signLauncherHttpUrl: 'http://127.0.0.1:9911/sign',
              zelcoreLauncherHttpUrl: 'http://127.0.0.1:9911/zelcore',
              zelcoreSignLink: `zelcore:sign?message=${encodeURIComponent(phrase)}`,
              zelcoreWarning: null,
              nextActions: [
                {
                  tool: 'flux_auth_login',
                  arguments: { zelid, loginPhrase: phrase, signature: '<SIGNATURE>' },
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

          if (pinnedBaseUrl) {
            baseUrl = pinnedBaseUrl;
          }

          zelidauth = JSON.stringify({ zelid, signature, loginPhrase });
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

        case 'flux_get_login_phrase':
          return jsonResult(options.loginPhraseFails ? requestFailure('Login phrase endpoint unavailable') : requestSuccess('sign-me-please'));

        case 'flux_get_emergency_phrase':
          return jsonResult(requestSuccess('emergency-sign-me'));

        case 'flux_build_zelcore_sign_link': {
          const message = typeof args.message === 'string' ? args.message : '';
          return jsonResult({
            ok: true,
            link: `zelcore:sign?message=${encodeURIComponent(message)}`,
            clickableLink: `zelcore:sign?message=${encodeURIComponent(message)}`,
            bracketedLink: `[zelcore:sign?message=${encodeURIComponent(message)}]`,
            osc8OpenLink: null,
            messageLength: message.length,
            usedFluxStorage: false,
            storageUrl: null,
            warning: null,
            messageSource: 'argument',
            messageResourceUri: null,
          });
        }

        case 'flux_auth_diagnose': {
          const checks: Array<{ name: string; ok: boolean; detail?: unknown }> = [
            { name: 'baseUrl', ok: true, detail: baseUrl },
            { name: 'flux/version', ok: true, detail: requestSuccess({ version: '1.0.0-test' }) },
          ];
          const nextSteps: string[] = [];

          if (options.loginPhraseFails) {
            checks.push({ name: 'id/loginphrase', ok: false, detail: requestFailure('Login phrase endpoint unavailable') });
            checks.push({ name: 'id/emergencyphrase', ok: true, detail: requestSuccess('emergency-sign-me') });
            nextSteps.push('If loginphrase fails, use flux_get_emergency_phrase and investigate node health (syncthing/docker/DOS state).');
          } else {
            checks.push({ name: 'id/loginphrase', ok: true, detail: requestSuccess('sign-me-please') });
          }

          const authSummary = summarizeZelidauth(zelidauth);
          checks.push({ name: 'zelidauth', ok: authSummary.present, detail: authSummary });

          if (!authSummary.present) {
            nextSteps.push('Run flux_auth_flow to get the exact login steps.');
            const payload = { ok: false, checks, nextSteps };
            return jsonResult(payload);
          }

          checks.push({
            name: 'id/checkprivilege',
            ok: true,
            detail: requestSuccess('admin'),
          });

          return jsonResult({ ok: true, checks, nextSteps });
        }

        default:
          return jsonResult({ ok: false, error: `Unknown tool: ${name}` }, true);
      }
    },
  };
}

async function withTempStateDir<T>(run: (stateDir: string) => Promise<T>) {
  const stateDir = await mkdtemp(join(tmpdir(), 'fluxos-cli-auth-phrase-'));
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
    return await readFile(stateFile, 'utf8');
  } catch (error) {
    const code = error instanceof Error && 'code' in error ? String((error as NodeJS.ErrnoException).code) : null;
    if (code === 'ENOENT') return null;
    throw error;
  }
}

async function seedScopedState(stateDir: string, opts?: { withAuth?: boolean; baseUrl?: string }) {
  const stateFile = join(stateDir, 'state.json');
  const baseUrl = opts?.baseUrl ?? 'https://ops.example/';
  const withAuth = opts?.withAuth ?? true;

  await writeFile(
    stateFile,
    JSON.stringify(
      {
        version: 1,
        activeProfile: 'ops',
        profiles: {
          ops: {
            baseUrl,
            zelidauth: withAuth ? JSON.stringify({ zelid: 'ops-user', signature: 'ops-signature', loginPhrase: 'ops-phrase' }) : null,
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

describe.sequential('auth phrase and diagnose', () => {
  it('returns the normal phrase flow in json mode without mutating state', async () => {
    await withTempStateDir(async (stateDir) => {
      const stateFile = await seedScopedState(stateDir, { withAuth: false });
      const before = await readFile(stateFile, 'utf8');

      const result = await invokeCli(['auth', 'phrase', '--json'], {
        toolRuntime: createFakeAuthToolRuntime(),
        persistedStateMode: 'on',
      });

      expect(result.exitCode).toBe(0);
      expect(result.stderr).toBe('');

      const payload = JSON.parse(result.stdout) as Record<string, unknown>;
      expect(payload.ok).toBe(true);
      expect(payload.status).toBe('ok');
      expect(payload.activeProfile).toBe('ops');
      expect(payload.baseUrl).toBe('https://ops.example');
      expect(payload.phrasePath).toBe('normal');
      expect(payload.needSignature).toBe(true);
      expect(payload.loginPhrase).toBe('sign-me-please');
      expect(payload).not.toHaveProperty('signLauncherHttpUrl');
      expect(payload).not.toHaveProperty('zelcoreLauncherHttpUrl');

      const nextActions = payload.nextActions as Array<Record<string, unknown>>;
      expect(Array.isArray(nextActions)).toBe(true);
      expect(nextActions[0]).toEqual({
        command: 'flux auth login',
        arguments: {
          zelid: '<ZELID>',
          loginPhrase: 'sign-me-please',
          signature: '<SIGNATURE>',
        },
      });

      const after = await readFile(stateFile, 'utf8');
      expect(after).toBe(before);
      expect(result.stdout).not.toContain('SSP Wallet');
    });
  });

  it('supports the emergency phrase path in json mode', async () => {
    await withTempStateDir(async (stateDir) => {
      const before = await readStateFileIfPresent(stateDir);

      const result = await invokeCli(['auth', 'phrase', '--use-emergency-phrase', '--json'], {
        toolRuntime: createFakeAuthToolRuntime(),
        persistedStateMode: 'on',
      });

      expect(result.exitCode).toBe(0);
      expect(result.stderr).toBe('');

      const payload = JSON.parse(result.stdout) as Record<string, unknown>;
      expect(payload.ok).toBe(true);
      expect(payload.phrasePath).toBe('emergency');
      expect(payload.loginPhrase).toBe('emergency-sign-me');

      const after = await readStateFileIfPresent(stateDir);
      expect(after).toBe(before);
    });
  });

  it('forces a fresh signable phrase when zelid is provided even if auth is already present', async () => {
    await withTempStateDir(async (stateDir) => {
      await seedScopedState(stateDir, { withAuth: true });

      const result = await invokeCli(['auth', 'phrase', '--zelid', 'ops-user', '--json'], {
        toolRuntime: createFakeAuthToolRuntime(),
        persistedStateMode: 'on',
      });

      expect(result.exitCode).toBe(0);

      const payload = JSON.parse(result.stdout) as Record<string, unknown>;
      expect(payload.ok).toBe(true);
      expect(payload.needSignature).toBe(true);
      expect(payload.alreadyAuthenticated).not.toBe(true);
      expect(payload.loginPhrase).toBe('sign-me-please');
    });
  });

  it('shows launcher and wallet helpers in pretty mode when zelid is provided', async () => {
    await withTempStateDir(async () => {
      const result = await invokeCli(['auth', 'phrase', '--zelid', 'zelid123', '--pretty'], {
        toolRuntime: createFakeAuthToolRuntime(),
        persistedStateMode: 'on',
      });

      expect(result.exitCode).toBe(0);
      expect(result.stderr).toBe('');
      expect(result.stdout).toContain('Login phrase ready for zelid123.');
      expect(result.stdout).toContain('Sign launcher (SSP Wallet or Zelcore): http://127.0.0.1:9911/sign');
      expect(result.stdout).toContain('Zelcore launcher: http://127.0.0.1:9911/zelcore');
      expect(result.stdout).toContain('Zelcore sign link: zelcore:sign?message=sign-me-please');
    });
  });

  it('reports diagnose checks and emergency fallback guidance without mutating state', async () => {
    await withTempStateDir(async (stateDir) => {
      const stateFile = await seedScopedState(stateDir, { withAuth: true });
      const before = await readFile(stateFile, 'utf8');

      const result = await invokeCli(['auth', 'diagnose', '--json'], {
        toolRuntime: createFakeAuthToolRuntime({ loginPhraseFails: true }),
        persistedStateMode: 'on',
      });

      expect(result.exitCode).toBe(0);
      expect(result.stderr).toBe('');

      const payload = JSON.parse(result.stdout) as Record<string, unknown>;
      expect(payload.ok).toBe(true);
      expect(payload.status).toBe('ok');
      expect(payload.activeProfile).toBe('ops');
      expect(payload.baseUrl).toBe('https://ops.example');

      const checks = payload.checks as Array<Record<string, unknown>>;
      expect(Array.isArray(checks)).toBe(true);
      expect(checks.map((check) => check.name)).toEqual([
        'baseUrl',
        'flux/version',
        'id/loginphrase',
        'id/emergencyphrase',
        'zelidauth',
        'id/checkprivilege',
      ]);

      const nextSteps = payload.nextSteps as string[];
      expect(nextSteps).toContain(
        'If loginphrase fails, use flux_get_emergency_phrase and investigate node health (syncthing/docker/DOS state).'
      );

      const after = await readFile(stateFile, 'utf8');
      expect(after).toBe(before);
    });
  });

  it('preserves diagnose checks and next steps when auth is missing', async () => {
    await withTempStateDir(async (stateDir) => {
      const stateFile = await seedScopedState(stateDir, { withAuth: false });
      const before = await readFile(stateFile, 'utf8');

      const result = await invokeCli(['auth', 'diagnose', '--json'], {
        toolRuntime: createFakeAuthToolRuntime(),
        persistedStateMode: 'on',
      });

      expect(result.exitCode).toBe(3);
      expect(result.stderr).toBe('');

      const payload = JSON.parse(result.stdout) as Record<string, unknown>;
      expect(payload.ok).toBe(false);
      expect(payload.status).toBe('auth_required');

      const checks = payload.checks as Array<Record<string, unknown>>;
      expect(Array.isArray(checks)).toBe(true);
      expect(checks.map((check) => check.name)).toEqual(['baseUrl', 'flux/version', 'id/loginphrase', 'zelidauth']);

      const nextSteps = payload.nextSteps as string[];
      expect(nextSteps).toContain('Run flux_auth_flow to get the exact login steps.');

      const after = await readFile(stateFile, 'utf8');
      expect(after).toBe(before);
    });
  });
});
