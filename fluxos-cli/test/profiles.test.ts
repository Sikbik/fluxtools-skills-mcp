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

function createFakeStateToolRuntime() {
  let baseUrl: string | null = null;
  let zelidauth: string | null = null;
  let enterpriseKey: string | null = null;
  let httpDefaults = { ...DEFAULT_HTTP_DEFAULTS };
  let fluxDriveMwsBaseUrl = DEFAULT_FLUXDRIVE_BASE_URL;

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

async function withTempStateDir<T>(run: (stateDir: string) => Promise<T>) {
  const stateDir = await mkdtemp(join(tmpdir(), 'fluxos-cli-profiles-'));

  const previousStateDir = process.env.FLUXOS_CLI_STATE_DIR;
  const previousXdgStateHome = process.env.XDG_STATE_HOME;
  const previousFluxDriveBaseUrl = process.env.FLUXDRIVE_MWS_BASE_URL;
  const previousTimeoutMs = process.env.FLUX_HTTP_TIMEOUT_MS;
  const previousRetryCount = process.env.FLUX_HTTP_RETRY_COUNT;
  const previousRetryBackoffMs = process.env.FLUX_HTTP_RETRY_BACKOFF_MS;

  process.env.FLUXOS_CLI_STATE_DIR = stateDir;
  delete process.env.XDG_STATE_HOME;
  delete process.env.FLUXDRIVE_MWS_BASE_URL;
  delete process.env.FLUX_HTTP_TIMEOUT_MS;
  delete process.env.FLUX_HTTP_RETRY_COUNT;
  delete process.env.FLUX_HTTP_RETRY_BACKOFF_MS;

  try {
    return await run(stateDir);
  } finally {
    if (previousStateDir === undefined) delete process.env.FLUXOS_CLI_STATE_DIR;
    else process.env.FLUXOS_CLI_STATE_DIR = previousStateDir;

    if (previousXdgStateHome === undefined) delete process.env.XDG_STATE_HOME;
    else process.env.XDG_STATE_HOME = previousXdgStateHome;

    if (previousFluxDriveBaseUrl === undefined) delete process.env.FLUXDRIVE_MWS_BASE_URL;
    else process.env.FLUXDRIVE_MWS_BASE_URL = previousFluxDriveBaseUrl;

    if (previousTimeoutMs === undefined) delete process.env.FLUX_HTTP_TIMEOUT_MS;
    else process.env.FLUX_HTTP_TIMEOUT_MS = previousTimeoutMs;

    if (previousRetryCount === undefined) delete process.env.FLUX_HTTP_RETRY_COUNT;
    else process.env.FLUX_HTTP_RETRY_COUNT = previousRetryCount;

    if (previousRetryBackoffMs === undefined) delete process.env.FLUX_HTTP_RETRY_BACKOFF_MS;
    else process.env.FLUX_HTTP_RETRY_BACKOFF_MS = previousRetryBackoffMs;

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
});
