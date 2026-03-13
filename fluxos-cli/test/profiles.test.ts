import { mkdtemp, rm } from 'node:fs/promises';
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
        return { present: true, zelid };
      }
    }
  } catch {
    // Ignore non-JSON zelidauth values.
  }

  return { present: true };
}

function readOptionalEnvString(name: 'FLUX_API_BASE_URL' | 'FLUX_ZELIDAUTH' | 'FLUX_ENTERPRISE_KEY' | 'FLUXDRIVE_MWS_BASE_URL') {
  const raw = process.env[name]?.trim();
  return raw ? raw : null;
}

function readEnvHttpDefaults() {
  const timeoutMs = Number(process.env.FLUX_HTTP_TIMEOUT_MS ?? DEFAULT_HTTP_DEFAULTS.timeoutMs);
  const retryCount = Number(process.env.FLUX_HTTP_RETRY_COUNT ?? DEFAULT_HTTP_DEFAULTS.retryCount);
  const retryBackoffMs = Number(process.env.FLUX_HTTP_RETRY_BACKOFF_MS ?? DEFAULT_HTTP_DEFAULTS.retryBackoffMs);

  return {
    timeoutMs: Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : DEFAULT_HTTP_DEFAULTS.timeoutMs,
    retryCount: Number.isFinite(retryCount) && retryCount >= 0 && Number.isInteger(retryCount)
      ? retryCount
      : DEFAULT_HTTP_DEFAULTS.retryCount,
    retryBackoffMs: Number.isFinite(retryBackoffMs) && retryBackoffMs >= 0
      ? retryBackoffMs
      : DEFAULT_HTTP_DEFAULTS.retryBackoffMs,
  };
}

function createFakeStateToolRuntime() {
  let baseUrl: string | null = normalizeBaseUrl(readOptionalEnvString('FLUX_API_BASE_URL') ?? 'https://api.runonflux.io');
  let zelidauth: string | null = readOptionalEnvString('FLUX_ZELIDAUTH');
  let enterpriseKey: string | null = readOptionalEnvString('FLUX_ENTERPRISE_KEY');
  let httpDefaults = readEnvHttpDefaults();
  let fluxDriveMwsBaseUrl = normalizeBaseUrl(readOptionalEnvString('FLUXDRIVE_MWS_BASE_URL') ?? DEFAULT_FLUXDRIVE_BASE_URL);

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
        case 'flux_get_state':
          return jsonResult({
            baseUrl,
            zelidauth: summarizeZelidauth(zelidauth),
            enterpriseKey: { present: Boolean(enterpriseKey) },
            httpDefaults,
            fluxDriveMwsBaseUrl,
          });

        case 'flux_set_base_url': {
          baseUrl = normalizeBaseUrl(String(args.baseUrl));
          return jsonResult({ ok: true, baseUrl });
        }

        case 'flux_set_http_defaults': {
          httpDefaults = {
            timeoutMs: typeof args.timeoutMs === 'number' ? args.timeoutMs : httpDefaults.timeoutMs,
            retryCount: typeof args.retryCount === 'number' ? args.retryCount : httpDefaults.retryCount,
            retryBackoffMs: typeof args.retryBackoffMs === 'number' ? args.retryBackoffMs : httpDefaults.retryBackoffMs,
          };

          return jsonResult({ ok: true, httpDefaults });
        }

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

        case 'flux_clear_zelidauth':
          zelidauth = null;
          return jsonResult({ ok: true, zelidauth: summarizeZelidauth(zelidauth) });

        case 'flux_set_enterprise_key': {
          const value = typeof args.enterpriseKey === 'string' ? args.enterpriseKey.trim() : '';
          if (!value) {
            return jsonResult({ ok: false, error: 'enterpriseKey must be a non-empty string' }, true);
          }

          enterpriseKey = value;
          return jsonResult({ ok: true, enterpriseKey: { present: true } });
        }

        case 'flux_clear_enterprise_key':
          enterpriseKey = null;
          return jsonResult({ ok: true, enterpriseKey: { present: false } });

        case 'flux_fluxdrive_set_base_url': {
          fluxDriveMwsBaseUrl = normalizeBaseUrl(String(args.baseUrl));
          return jsonResult({ ok: true, fluxDriveMwsBaseUrl });
        }

        default:
          return jsonResult({ ok: false, error: `Unknown tool: ${name}` }, true);
      }
    },
  };
}

async function withTempStateDir<T>(
  run: (stateDir: string) => Promise<T>,
  envOverrides: Partial<Record<(typeof MANAGED_ENV_KEYS)[number], string | undefined>> = {}
) {
  const stateDir = await mkdtemp(join(tmpdir(), 'fluxos-cli-profiles-'));

  const previousEnv = new Map<string, string | undefined>(
    MANAGED_ENV_KEYS.map((key) => [key, process.env[key]])
  );

  process.env.FLUXOS_CLI_STATE_DIR = stateDir;
  delete process.env.XDG_STATE_HOME;
  delete process.env.FLUX_API_BASE_URL;
  delete process.env.FLUX_ZELIDAUTH;
  delete process.env.FLUX_ENTERPRISE_KEY;
  delete process.env.FLUXDRIVE_MWS_BASE_URL;
  delete process.env.FLUX_HTTP_TIMEOUT_MS;
  delete process.env.FLUX_HTTP_RETRY_COUNT;
  delete process.env.FLUX_HTTP_RETRY_BACKOFF_MS;

  for (const [key, value] of Object.entries(envOverrides)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }

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
    toolRuntime?: ReturnType<typeof createFakeStateToolRuntime>;
    persistedStateMode?: 'auto' | 'off' | 'on';
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

type ProfileListPayload = {
  ok: boolean;
  status: string;
  count: number;
  activeProfile: string;
  profiles: Array<{
    name: string;
    active: boolean;
    baseUrl: string | null;
    auth: { present: boolean; zelid?: string };
    enterpriseKey: { present: boolean };
    fluxDriveMwsBaseUrl: string;
    httpDefaults: { timeoutMs: number; retryCount: number; retryBackoffMs: number };
  }>;
};

function parseJson<T>(text: string): T {
  return JSON.parse(text) as T;
}

describe.sequential('profiles', () => {
  it('supports create, list, use, and delete with persistent active-profile visibility', async () => {
    await withTempStateDir(async () => {
      const initialList = await invokeCli(['profile', 'list', '--json']);
      expect(initialList.exitCode).toBe(0);

      const initialPayload = parseJson<ProfileListPayload>(initialList.stdout);
      expect(initialPayload.activeProfile).toBe('default');
      expect(initialPayload.count).toBe(1);
      expect(initialPayload.profiles.map((profile) => profile.name)).toEqual(['default']);
      expect(initialPayload.profiles[0]).toMatchObject({
        name: 'default',
        active: true,
        baseUrl: 'https://api.runonflux.io',
        auth: { present: false },
        enterpriseKey: { present: false },
        fluxDriveMwsBaseUrl: DEFAULT_FLUXDRIVE_BASE_URL,
        httpDefaults: DEFAULT_HTTP_DEFAULTS,
      });

      const createAlpha = await invokeCli(['profile', 'create', 'alpha', '--json']);
      expect(createAlpha.exitCode).toBe(0);

      const createBeta = await invokeCli(['profile', 'create', 'beta', '--json']);
      expect(createBeta.exitCode).toBe(0);

      const afterCreate = parseJson<ProfileListPayload>((await invokeCli(['profile', 'list', '--json'])).stdout);
      expect(afterCreate.activeProfile).toBe('default');
      expect(afterCreate.profiles.map((profile) => profile.name)).toEqual(['alpha', 'beta', 'default']);
      expect(afterCreate.profiles.find((profile) => profile.name === 'default')).toMatchObject({ active: true });
      expect(afterCreate.profiles.find((profile) => profile.name === 'alpha')).toMatchObject({
        active: false,
        baseUrl: 'https://api.runonflux.io',
      });
      expect(afterCreate.profiles.find((profile) => profile.name === 'beta')).toMatchObject({
        active: false,
        baseUrl: 'https://api.runonflux.io',
      });

      const useBeta = await invokeCli(['profile', 'use', 'beta', '--json']);
      expect(useBeta.exitCode).toBe(0);

      const afterUse = parseJson<ProfileListPayload>((await invokeCli(['profile', 'list', '--json'])).stdout);
      expect(afterUse.activeProfile).toBe('beta');
      expect(afterUse.profiles.find((profile) => profile.name === 'beta')).toMatchObject({ active: true });
      expect(afterUse.profiles.find((profile) => profile.name === 'default')).toMatchObject({ active: false });

      const deleteAlpha = await invokeCli(['profile', 'delete', 'alpha', '--json']);
      expect(deleteAlpha.exitCode).toBe(0);

      const afterDeleteAlpha = parseJson<ProfileListPayload>((await invokeCli(['profile', 'list', '--json'])).stdout);
      expect(afterDeleteAlpha.activeProfile).toBe('beta');
      expect(afterDeleteAlpha.profiles.map((profile) => profile.name)).toEqual(['beta', 'default']);

      const deleteBeta = await invokeCli(['profile', 'delete', 'beta', '--json']);
      expect(deleteBeta.exitCode).toBe(0);

      const finalList = parseJson<ProfileListPayload>((await invokeCli(['profile', 'list', '--json'])).stdout);
      expect(finalList.activeProfile).toBe('default');
      expect(finalList.count).toBe(1);
      expect(finalList.profiles).toEqual([
        {
          name: 'default',
          active: true,
          baseUrl: 'https://api.runonflux.io',
          auth: { present: false },
          enterpriseKey: { present: false },
          fluxDriveMwsBaseUrl: DEFAULT_FLUXDRIVE_BASE_URL,
          httpDefaults: DEFAULT_HTTP_DEFAULTS,
        },
      ]);
    });
  });

  it('keeps base URL, auth, enterprise key, FluxDrive URL, and HTTP defaults isolated per profile across switches and deletes', async () => {
    await withTempStateDir(async () => {
      expect((await invokeCli(['profile', 'create', 'alpha', '--json'])).exitCode).toBe(0);
      expect((await invokeCli(['profile', 'create', 'beta', '--json'])).exitCode).toBe(0);
      expect((await invokeCli(['profile', 'use', 'alpha', '--json'])).exitCode).toBe(0);

      const alphaRuntime = createFakeStateToolRuntime();
      expect(
        (
          await invokeCli(['tool', 'call', 'flux_set_base_url', '--json', '--arg', 'baseUrl=https://alpha.example'], {
            toolRuntime: alphaRuntime,
            persistedStateMode: 'on',
          })
        ).exitCode
      ).toBe(0);
      expect(
        (
          await invokeCli(
            [
              'tool',
              'call',
              'flux_set_zelidauth',
              '--json',
              '--args-json',
              JSON.stringify({ zelidauth: { zelid: 'alpha-user', signature: 'alpha-signature', loginPhrase: 'alpha-phrase' } }),
            ],
            {
              toolRuntime: alphaRuntime,
              persistedStateMode: 'on',
            }
          )
        ).exitCode
      ).toBe(0);
      expect(
        (
          await invokeCli(['tool', 'call', 'flux_set_enterprise_key', '--json', '--arg', 'enterpriseKey=alpha-enterprise'], {
            toolRuntime: alphaRuntime,
            persistedStateMode: 'on',
          })
        ).exitCode
      ).toBe(0);
      expect(
        (
          await invokeCli(
            [
              'tool',
              'call',
              'flux_set_http_defaults',
              '--json',
              '--arg',
              'timeoutMs=11111',
              '--arg',
              'retryCount=5',
              '--arg',
              'retryBackoffMs=777',
            ],
            {
              toolRuntime: alphaRuntime,
              persistedStateMode: 'on',
            }
          )
        ).exitCode
      ).toBe(0);
      expect(
        (
          await invokeCli(['tool', 'call', 'flux_fluxdrive_set_base_url', '--json', '--arg', 'baseUrl=https://alpha.mws.example'], {
            toolRuntime: alphaRuntime,
            persistedStateMode: 'on',
          })
        ).exitCode
      ).toBe(0);

      expect((await invokeCli(['profile', 'use', 'beta', '--json'])).exitCode).toBe(0);

      const betaRuntime = createFakeStateToolRuntime();
      expect(
        (
          await invokeCli(['tool', 'call', 'flux_set_base_url', '--json', '--arg', 'baseUrl=https://beta.example'], {
            toolRuntime: betaRuntime,
            persistedStateMode: 'on',
          })
        ).exitCode
      ).toBe(0);
      expect(
        (
          await invokeCli(
            [
              'tool',
              'call',
              'flux_set_zelidauth',
              '--json',
              '--args-json',
              JSON.stringify({ zelidauth: { zelid: 'beta-user', signature: 'beta-signature', loginPhrase: 'beta-phrase' } }),
            ],
            {
              toolRuntime: betaRuntime,
              persistedStateMode: 'on',
            }
          )
        ).exitCode
      ).toBe(0);
      expect(
        (
          await invokeCli(['tool', 'call', 'flux_set_enterprise_key', '--json', '--arg', 'enterpriseKey=beta-enterprise'], {
            toolRuntime: betaRuntime,
            persistedStateMode: 'on',
          })
        ).exitCode
      ).toBe(0);
      expect(
        (
          await invokeCli(
            [
              'tool',
              'call',
              'flux_set_http_defaults',
              '--json',
              '--arg',
              'timeoutMs=22222',
              '--arg',
              'retryCount=1',
              '--arg',
              'retryBackoffMs=333',
            ],
            {
              toolRuntime: betaRuntime,
              persistedStateMode: 'on',
            }
          )
        ).exitCode
      ).toBe(0);
      expect(
        (
          await invokeCli(['tool', 'call', 'flux_fluxdrive_set_base_url', '--json', '--arg', 'baseUrl=https://beta.mws.example'], {
            toolRuntime: betaRuntime,
            persistedStateMode: 'on',
          })
        ).exitCode
      ).toBe(0);

      expect((await invokeCli(['profile', 'use', 'alpha', '--json'])).exitCode).toBe(0);

      const alphaStateShow = parseJson<{
        state: {
          activeProfile: string;
          baseUrl: string | null;
          auth: { present: boolean; zelid?: string };
          enterpriseKey: { present: boolean };
          fluxDriveMwsBaseUrl: string;
          httpDefaults: { timeoutMs: number; retryCount: number; retryBackoffMs: number };
          paths: { stateDir: string; stateFile: string; resourceStoreFile: string };
        };
      }>((await invokeCli(['state', 'show', '--json'])).stdout);
      expect(alphaStateShow.state).toMatchObject({
        activeProfile: 'alpha',
        baseUrl: 'https://alpha.example',
        auth: { present: true, zelid: 'alpha-user' },
        enterpriseKey: { present: true },
        fluxDriveMwsBaseUrl: 'https://alpha.mws.example',
        httpDefaults: { timeoutMs: 11111, retryCount: 5, retryBackoffMs: 777 },
      });

      const alphaGetState = parseJson<{
        result: {
          baseUrl: string | null;
          zelidauth: { present: boolean; zelid?: string };
          enterpriseKey: { present: boolean };
          fluxDriveMwsBaseUrl: string;
          httpDefaults: { timeoutMs: number; retryCount: number; retryBackoffMs: number };
        };
      }>(
        (
          await invokeCli(['tool', 'call', 'flux_get_state', '--json'], {
            toolRuntime: createFakeStateToolRuntime(),
            persistedStateMode: 'on',
          })
        ).stdout
      );
      expect(alphaGetState.result).toEqual({
        baseUrl: 'https://alpha.example',
        zelidauth: { present: true, zelid: 'alpha-user' },
        enterpriseKey: { present: true },
        fluxDriveMwsBaseUrl: 'https://alpha.mws.example',
        httpDefaults: { timeoutMs: 11111, retryCount: 5, retryBackoffMs: 777 },
      });

      expect((await invokeCli(['profile', 'use', 'beta', '--json'])).exitCode).toBe(0);

      const betaStateShow = parseJson<{
        state: {
          activeProfile: string;
          baseUrl: string | null;
          auth: { present: boolean; zelid?: string };
          enterpriseKey: { present: boolean };
          fluxDriveMwsBaseUrl: string;
          httpDefaults: { timeoutMs: number; retryCount: number; retryBackoffMs: number };
          paths: { stateDir: string; stateFile: string; resourceStoreFile: string };
        };
      }>((await invokeCli(['state', 'show', '--json'])).stdout);
      expect(betaStateShow.state).toMatchObject({
        activeProfile: 'beta',
        baseUrl: 'https://beta.example',
        auth: { present: true, zelid: 'beta-user' },
        enterpriseKey: { present: true },
        fluxDriveMwsBaseUrl: 'https://beta.mws.example',
        httpDefaults: { timeoutMs: 22222, retryCount: 1, retryBackoffMs: 333 },
      });

      const deleteAlpha = await invokeCli(['profile', 'delete', 'alpha', '--json']);
      expect(deleteAlpha.exitCode).toBe(0);

      const afterDelete = parseJson<ProfileListPayload>((await invokeCli(['profile', 'list', '--json'])).stdout);
      expect(afterDelete.activeProfile).toBe('beta');
      expect(afterDelete.profiles.map((profile) => profile.name)).toEqual(['beta', 'default']);

      const betaStateAfterDelete = parseJson<{
        state: {
          activeProfile: string;
          baseUrl: string | null;
          auth: { present: boolean; zelid?: string };
          enterpriseKey: { present: boolean };
          fluxDriveMwsBaseUrl: string;
          httpDefaults: { timeoutMs: number; retryCount: number; retryBackoffMs: number };
          paths: { stateDir: string; stateFile: string; resourceStoreFile: string };
        };
      }>((await invokeCli(['state', 'show', '--json'])).stdout);
      expect(betaStateAfterDelete.state).toMatchObject({
        activeProfile: 'beta',
        baseUrl: 'https://beta.example',
        auth: { present: true, zelid: 'beta-user' },
        enterpriseKey: { present: true },
        fluxDriveMwsBaseUrl: 'https://beta.mws.example',
        httpDefaults: { timeoutMs: 22222, retryCount: 1, retryBackoffMs: 333 },
      });
    });
  });

  it('switches profiles with env-backed auth, enterprise key, FluxDrive URL, and HTTP defaults fully isolated', async () => {
    const envZelidauth = JSON.stringify({ zelid: 'env-user', signature: 'env-signature', loginPhrase: 'env-phrase' });

    await withTempStateDir(
      async () => {
        expect((await invokeCli(['profile', 'create', 'alpha', '--json'])).exitCode).toBe(0);
        expect((await invokeCli(['profile', 'create', 'beta', '--json'])).exitCode).toBe(0);

        const initialDefaultState = parseJson<{
          state: {
            activeProfile: string;
            baseUrl: string | null;
            auth: { present: boolean; zelid?: string };
            enterpriseKey: { present: boolean };
            fluxDriveMwsBaseUrl: string;
            httpDefaults: { timeoutMs: number; retryCount: number; retryBackoffMs: number };
          };
        }>((await invokeCli(['state', 'show', '--json'])).stdout);

        expect(initialDefaultState.state).toMatchObject({
          activeProfile: 'default',
          baseUrl: 'https://env.api.example',
          auth: { present: true, zelid: 'env-user' },
          enterpriseKey: { present: true },
          fluxDriveMwsBaseUrl: 'https://env.mws.example',
          httpDefaults: { timeoutMs: 65000, retryCount: 7, retryBackoffMs: 1234 },
        });

        expect((await invokeCli(['profile', 'use', 'alpha', '--json'])).exitCode).toBe(0);

        const alphaVisibleBeforeOverrides = parseJson<{
          state: {
            activeProfile: string;
            baseUrl: string | null;
            auth: { present: boolean; zelid?: string };
            enterpriseKey: { present: boolean };
            fluxDriveMwsBaseUrl: string;
            httpDefaults: { timeoutMs: number; retryCount: number; retryBackoffMs: number };
          };
        }>((await invokeCli(['state', 'show', '--json'])).stdout);

        expect(alphaVisibleBeforeOverrides.state).toMatchObject({
          activeProfile: 'alpha',
          baseUrl: 'https://env.api.example',
          auth: { present: false },
          enterpriseKey: { present: false },
          fluxDriveMwsBaseUrl: DEFAULT_FLUXDRIVE_BASE_URL,
          httpDefaults: DEFAULT_HTTP_DEFAULTS,
        });

        const alphaEffectiveBeforeOverrides = parseJson<{
          result: {
            baseUrl: string | null;
            zelidauth: { present: boolean; zelid?: string };
            enterpriseKey: { present: boolean };
            fluxDriveMwsBaseUrl: string;
            httpDefaults: { timeoutMs: number; retryCount: number; retryBackoffMs: number };
          };
        }>(
          (
            await invokeCli(['tool', 'call', 'flux_get_state', '--json'], {
              toolRuntime: createFakeStateToolRuntime(),
              persistedStateMode: 'on',
            })
          ).stdout
        );

        expect(alphaEffectiveBeforeOverrides.result).toEqual({
          baseUrl: 'https://env.api.example',
          zelidauth: { present: false },
          enterpriseKey: { present: false },
          fluxDriveMwsBaseUrl: DEFAULT_FLUXDRIVE_BASE_URL,
          httpDefaults: DEFAULT_HTTP_DEFAULTS,
        });

        const alphaRuntime = createFakeStateToolRuntime();
        expect(
          (
            await invokeCli(['tool', 'call', 'flux_set_base_url', '--json', '--arg', 'baseUrl=https://alpha.example'], {
              toolRuntime: alphaRuntime,
              persistedStateMode: 'on',
            })
          ).exitCode
        ).toBe(0);
        expect(
          (
            await invokeCli(
              [
                'tool',
                'call',
                'flux_set_zelidauth',
                '--json',
                '--args-json',
                JSON.stringify({ zelidauth: { zelid: 'alpha-user', signature: 'alpha-signature', loginPhrase: 'alpha-phrase' } }),
              ],
              {
                toolRuntime: alphaRuntime,
                persistedStateMode: 'on',
              }
            )
          ).exitCode
        ).toBe(0);
        expect(
          (
            await invokeCli(['tool', 'call', 'flux_set_enterprise_key', '--json', '--arg', 'enterpriseKey=alpha-enterprise'], {
              toolRuntime: alphaRuntime,
              persistedStateMode: 'on',
            })
          ).exitCode
        ).toBe(0);
        expect(
          (
            await invokeCli(
              [
                'tool',
                'call',
                'flux_set_http_defaults',
                '--json',
                '--arg',
                'timeoutMs=11111',
                '--arg',
                'retryCount=5',
                '--arg',
                'retryBackoffMs=777',
              ],
              {
                toolRuntime: alphaRuntime,
                persistedStateMode: 'on',
              }
            )
          ).exitCode
        ).toBe(0);
        expect(
          (
            await invokeCli(['tool', 'call', 'flux_fluxdrive_set_base_url', '--json', '--arg', 'baseUrl=https://alpha.mws.example'], {
              toolRuntime: alphaRuntime,
              persistedStateMode: 'on',
            })
          ).exitCode
        ).toBe(0);

        expect((await invokeCli(['profile', 'use', 'beta', '--json'])).exitCode).toBe(0);

        const betaVisibleBeforeOverrides = parseJson<{
          state: {
            activeProfile: string;
            baseUrl: string | null;
            auth: { present: boolean; zelid?: string };
            enterpriseKey: { present: boolean };
            fluxDriveMwsBaseUrl: string;
            httpDefaults: { timeoutMs: number; retryCount: number; retryBackoffMs: number };
          };
        }>((await invokeCli(['state', 'show', '--json'])).stdout);

        expect(betaVisibleBeforeOverrides.state).toMatchObject({
          activeProfile: 'beta',
          baseUrl: 'https://env.api.example',
          auth: { present: false },
          enterpriseKey: { present: false },
          fluxDriveMwsBaseUrl: DEFAULT_FLUXDRIVE_BASE_URL,
          httpDefaults: DEFAULT_HTTP_DEFAULTS,
        });

        const betaEffectiveBeforeOverrides = parseJson<{
          result: {
            baseUrl: string | null;
            zelidauth: { present: boolean; zelid?: string };
            enterpriseKey: { present: boolean };
            fluxDriveMwsBaseUrl: string;
            httpDefaults: { timeoutMs: number; retryCount: number; retryBackoffMs: number };
          };
        }>(
          (
            await invokeCli(['tool', 'call', 'flux_get_state', '--json'], {
              toolRuntime: createFakeStateToolRuntime(),
              persistedStateMode: 'on',
            })
          ).stdout
        );

        expect(betaEffectiveBeforeOverrides.result).toEqual({
          baseUrl: 'https://env.api.example',
          zelidauth: { present: false },
          enterpriseKey: { present: false },
          fluxDriveMwsBaseUrl: DEFAULT_FLUXDRIVE_BASE_URL,
          httpDefaults: DEFAULT_HTTP_DEFAULTS,
        });

        const betaRuntime = createFakeStateToolRuntime();
        expect(
          (
            await invokeCli(['tool', 'call', 'flux_set_base_url', '--json', '--arg', 'baseUrl=https://beta.example'], {
              toolRuntime: betaRuntime,
              persistedStateMode: 'on',
            })
          ).exitCode
        ).toBe(0);
        expect(
          (
            await invokeCli(
              [
                'tool',
                'call',
                'flux_set_zelidauth',
                '--json',
                '--args-json',
                JSON.stringify({ zelidauth: { zelid: 'beta-user', signature: 'beta-signature', loginPhrase: 'beta-phrase' } }),
              ],
              {
                toolRuntime: betaRuntime,
                persistedStateMode: 'on',
              }
            )
          ).exitCode
        ).toBe(0);
        expect(
          (
            await invokeCli(['tool', 'call', 'flux_set_enterprise_key', '--json', '--arg', 'enterpriseKey=beta-enterprise'], {
              toolRuntime: betaRuntime,
              persistedStateMode: 'on',
            })
          ).exitCode
        ).toBe(0);
        expect(
          (
            await invokeCli(
              [
                'tool',
                'call',
                'flux_set_http_defaults',
                '--json',
                '--arg',
                'timeoutMs=22222',
                '--arg',
                'retryCount=1',
                '--arg',
                'retryBackoffMs=333',
              ],
              {
                toolRuntime: betaRuntime,
                persistedStateMode: 'on',
              }
            )
          ).exitCode
        ).toBe(0);
        expect(
          (
            await invokeCli(['tool', 'call', 'flux_fluxdrive_set_base_url', '--json', '--arg', 'baseUrl=https://beta.mws.example'], {
              toolRuntime: betaRuntime,
              persistedStateMode: 'on',
            })
          ).exitCode
        ).toBe(0);

        expect((await invokeCli(['profile', 'use', 'alpha', '--json'])).exitCode).toBe(0);

        const alphaVisible = parseJson<{
          state: {
            activeProfile: string;
            baseUrl: string | null;
            auth: { present: boolean; zelid?: string };
            enterpriseKey: { present: boolean };
            fluxDriveMwsBaseUrl: string;
            httpDefaults: { timeoutMs: number; retryCount: number; retryBackoffMs: number };
          };
        }>((await invokeCli(['state', 'show', '--json'])).stdout);
        expect(alphaVisible.state).toMatchObject({
          activeProfile: 'alpha',
          baseUrl: 'https://alpha.example',
          auth: { present: true, zelid: 'alpha-user' },
          enterpriseKey: { present: true },
          fluxDriveMwsBaseUrl: 'https://alpha.mws.example',
          httpDefaults: { timeoutMs: 11111, retryCount: 5, retryBackoffMs: 777 },
        });

        const alphaEffective = parseJson<{
          result: {
            baseUrl: string | null;
            zelidauth: { present: boolean; zelid?: string };
            enterpriseKey: { present: boolean };
            fluxDriveMwsBaseUrl: string;
            httpDefaults: { timeoutMs: number; retryCount: number; retryBackoffMs: number };
          };
        }>(
          (
            await invokeCli(['tool', 'call', 'flux_get_state', '--json'], {
              toolRuntime: createFakeStateToolRuntime(),
              persistedStateMode: 'on',
            })
          ).stdout
        );
        expect(alphaEffective.result).toEqual({
          baseUrl: 'https://alpha.example',
          zelidauth: { present: true, zelid: 'alpha-user' },
          enterpriseKey: { present: true },
          fluxDriveMwsBaseUrl: 'https://alpha.mws.example',
          httpDefaults: { timeoutMs: 11111, retryCount: 5, retryBackoffMs: 777 },
        });

        expect((await invokeCli(['profile', 'use', 'beta', '--json'])).exitCode).toBe(0);

        const betaVisible = parseJson<{
          state: {
            activeProfile: string;
            baseUrl: string | null;
            auth: { present: boolean; zelid?: string };
            enterpriseKey: { present: boolean };
            fluxDriveMwsBaseUrl: string;
            httpDefaults: { timeoutMs: number; retryCount: number; retryBackoffMs: number };
          };
        }>((await invokeCli(['state', 'show', '--json'])).stdout);
        expect(betaVisible.state).toMatchObject({
          activeProfile: 'beta',
          baseUrl: 'https://beta.example',
          auth: { present: true, zelid: 'beta-user' },
          enterpriseKey: { present: true },
          fluxDriveMwsBaseUrl: 'https://beta.mws.example',
          httpDefaults: { timeoutMs: 22222, retryCount: 1, retryBackoffMs: 333 },
        });

        const betaEffective = parseJson<{
          result: {
            baseUrl: string | null;
            zelidauth: { present: boolean; zelid?: string };
            enterpriseKey: { present: boolean };
            fluxDriveMwsBaseUrl: string;
            httpDefaults: { timeoutMs: number; retryCount: number; retryBackoffMs: number };
          };
        }>(
          (
            await invokeCli(['tool', 'call', 'flux_get_state', '--json'], {
              toolRuntime: createFakeStateToolRuntime(),
              persistedStateMode: 'on',
            })
          ).stdout
        );
        expect(betaEffective.result).toEqual({
          baseUrl: 'https://beta.example',
          zelidauth: { present: true, zelid: 'beta-user' },
          enterpriseKey: { present: true },
          fluxDriveMwsBaseUrl: 'https://beta.mws.example',
          httpDefaults: { timeoutMs: 22222, retryCount: 1, retryBackoffMs: 333 },
        });
      },
      {
        FLUX_API_BASE_URL: 'https://env.api.example/',
        FLUX_ZELIDAUTH: envZelidauth,
        FLUX_ENTERPRISE_KEY: 'env-enterprise-key',
        FLUXDRIVE_MWS_BASE_URL: 'https://env.mws.example/',
        FLUX_HTTP_TIMEOUT_MS: '65000',
        FLUX_HTTP_RETRY_COUNT: '7',
        FLUX_HTTP_RETRY_BACKOFF_MS: '1234',
      }
    );
  });
});
