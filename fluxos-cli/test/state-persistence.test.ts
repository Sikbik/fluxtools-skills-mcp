import { mkdir, mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { runCli } from '../src/cli.js';
import { resolveCliStateDir } from '../src/state/paths.js';

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
          return jsonResult({
            ok: true,
            baseUrl,
            zelidauth: summarizeZelidauth(zelidauth),
            enterpriseKey: { present: Boolean(enterpriseKey) },
          });
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

          return jsonResult({ ok: true, baseUrl, zelidauth: summarizeZelidauth(zelidauth) });
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
  const localTmpRoot = join(process.cwd(), 'tmp');
  await mkdir(localTmpRoot, { recursive: true });
  const stateDir = await mkdtemp(join(localTmpRoot, 'fluxos-cli-state-persistence-'));

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

describe.sequential('state persistence', () => {
  it('prefers FLUXOS_CLI_STATE_DIR, then XDG_STATE_HOME, then HOME for persisted state paths', async () => {
    const previousStateDir = process.env.FLUXOS_CLI_STATE_DIR;
    const previousXdgStateHome = process.env.XDG_STATE_HOME;
    const previousHome = process.env.HOME;

    process.env.FLUXOS_CLI_STATE_DIR = '/tmp/flux-custom-state';
    process.env.XDG_STATE_HOME = '/tmp/xdg-state-home';
    process.env.HOME = '/tmp/home-dir';
    expect(resolveCliStateDir()).toBe('/tmp/flux-custom-state');

    delete process.env.FLUXOS_CLI_STATE_DIR;
    expect(resolveCliStateDir()).toBe('/tmp/xdg-state-home/fluxos-cli');

    delete process.env.XDG_STATE_HOME;
    expect(resolveCliStateDir()).toBe('/tmp/home-dir/.local/state/fluxos-cli');

    if (previousStateDir === undefined) delete process.env.FLUXOS_CLI_STATE_DIR;
    else process.env.FLUXOS_CLI_STATE_DIR = previousStateDir;

    if (previousXdgStateHome === undefined) delete process.env.XDG_STATE_HOME;
    else process.env.XDG_STATE_HOME = previousXdgStateHome;

    if (previousHome === undefined) delete process.env.HOME;
    else process.env.HOME = previousHome;
  });

  it('persists redacted state summaries with permission-safe files across fresh invocations', async () => {
    await withTempStateDir(async (stateDir) => {
      const baseUrlResult = await invokeCli(['tool', 'call', 'flux_set_base_url', '--json', '--arg', 'baseUrl=https://api.example/'], {
        toolRuntime: createFakeStateToolRuntime(),
        persistedStateMode: 'on',
      });

      expect(baseUrlResult.exitCode).toBe(0);
      expect(baseUrlResult.stderr).toBe('');

      const authResult = await invokeCli(
        [
          'tool',
          'call',
          'flux_set_zelidauth',
          '--json',
          '--args-json',
          JSON.stringify({
            zelidauth: {
              zelid: 'zelid123',
              signature: 'super-secret-signature',
              loginPhrase: 'please-do-not-print-me',
            },
          }),
        ],
        {
          toolRuntime: createFakeStateToolRuntime(),
          persistedStateMode: 'on',
        }
      );

      expect(authResult.exitCode).toBe(0);
      expect(authResult.stderr).toBe('');

      const enterpriseResult = await invokeCli(
        ['tool', 'call', 'flux_set_enterprise_key', '--json', '--arg', 'enterpriseKey=top-secret-enterprise-key'],
        {
          toolRuntime: createFakeStateToolRuntime(),
          persistedStateMode: 'on',
        }
      );

      expect(enterpriseResult.exitCode).toBe(0);
      expect(enterpriseResult.stderr).toBe('');

      const httpDefaultsResult = await invokeCli(
        [
          'tool',
          'call',
          'flux_set_http_defaults',
          '--json',
          '--arg',
          'timeoutMs=12000',
          '--arg',
          'retryCount=4',
          '--arg',
          'retryBackoffMs=900',
        ],
        {
          toolRuntime: createFakeStateToolRuntime(),
          persistedStateMode: 'on',
        }
      );

      expect(httpDefaultsResult.exitCode).toBe(0);
      expect(httpDefaultsResult.stderr).toBe('');

      const fluxDriveResult = await invokeCli(
        ['tool', 'call', 'flux_fluxdrive_set_base_url', '--json', '--arg', 'baseUrl=https://mws.example/'],
        {
          toolRuntime: createFakeStateToolRuntime(),
          persistedStateMode: 'on',
        }
      );

      expect(fluxDriveResult.exitCode).toBe(0);
      expect(fluxDriveResult.stderr).toBe('');

      const showResult = await invokeCli(['state', 'show', '--json']);
      expect(showResult.exitCode).toBe(0);
      expect(showResult.stderr).toBe('');
      expect(showResult.stdout).not.toContain('super-secret-signature');
      expect(showResult.stdout).not.toContain('please-do-not-print-me');
      expect(showResult.stdout).not.toContain('top-secret-enterprise-key');

      const payload = JSON.parse(showResult.stdout) as {
        ok: boolean;
        status: string;
        state: {
          activeProfile: string;
          baseUrl: string | null;
          auth: { present: boolean; zelid?: string };
          enterpriseKey: { present: boolean };
          fluxDriveMwsBaseUrl: string;
          httpDefaults: { timeoutMs: number; retryCount: number; retryBackoffMs: number };
          paths: { stateDir: string; stateFile: string; resourceStoreFile: string };
        };
      };

      expect(payload.ok).toBe(true);
      expect(payload.status).toBe('ok');
      expect(payload.state.activeProfile).toBe('default');
      expect(payload.state.baseUrl).toBe('https://api.example');
      expect(payload.state.auth).toEqual({ present: true, zelid: 'zelid123' });
      expect(payload.state.enterpriseKey).toEqual({ present: true });
      expect(payload.state.fluxDriveMwsBaseUrl).toBe('https://mws.example');
      expect(payload.state.httpDefaults).toEqual({ timeoutMs: 12000, retryCount: 4, retryBackoffMs: 900 });
      expect(payload.state.paths.stateDir).toBe(stateDir);
      expect(payload.state.paths.stateFile).toBe(join(stateDir, 'state.json'));
      expect(payload.state.paths.resourceStoreFile).toBe(join(stateDir, 'resources.json'));

      const stateFileText = await readFile(join(stateDir, 'state.json'), 'utf8');
      expect(stateFileText).toContain('super-secret-signature');

      const stateFileStat = await stat(join(stateDir, 'state.json'));
      expect(stateFileStat.mode & 0o077).toBe(0);
    });
  });

  it('reuses persisted state for later generic commands across fresh invocations', async () => {
    await withTempStateDir(async () => {
      await invokeCli(['tool', 'call', 'flux_set_base_url', '--json', '--arg', 'baseUrl=http://node.example:16127'], {
        toolRuntime: createFakeStateToolRuntime(),
        persistedStateMode: 'on',
      });

      await invokeCli(
        [
          'tool',
          'call',
          'flux_set_zelidauth',
          '--json',
          '--args-json',
          JSON.stringify({ zelidauth: { zelid: 'zelid456', signature: 'sig', loginPhrase: 'phrase' } }),
        ],
        {
          toolRuntime: createFakeStateToolRuntime(),
          persistedStateMode: 'on',
        }
      );

      await invokeCli(
        ['tool', 'call', 'flux_set_enterprise_key', '--json', '--arg', 'enterpriseKey=enterprise-secret'],
        {
          toolRuntime: createFakeStateToolRuntime(),
          persistedStateMode: 'on',
        }
      );

      const getStateResult = await invokeCli(['tool', 'call', 'flux_get_state', '--json'], {
        toolRuntime: createFakeStateToolRuntime(),
        persistedStateMode: 'on',
      });

      expect(getStateResult.exitCode).toBe(0);
      expect(getStateResult.stderr).toBe('');

      const payload = JSON.parse(getStateResult.stdout) as {
        ok: boolean;
        status: string;
        tool: string;
        result: {
          baseUrl: string | null;
          zelidauth: { present: boolean; zelid?: string };
          enterpriseKey: { present: boolean };
          fluxDriveMwsBaseUrl: string;
          httpDefaults: { timeoutMs: number; retryCount: number; retryBackoffMs: number };
        };
      };

      expect(payload.ok).toBe(true);
      expect(payload.status).toBe('ok');
      expect(payload.tool).toBe('flux_get_state');
      expect(payload.result.baseUrl).toBe('http://node.example:16127');
      expect(payload.result.zelidauth).toEqual({ present: true, zelid: 'zelid456' });
      expect(payload.result.enterpriseKey).toEqual({ present: true });
      expect(payload.result.fluxDriveMwsBaseUrl).toBe(DEFAULT_FLUXDRIVE_BASE_URL);
      expect(payload.result.httpDefaults).toEqual(DEFAULT_HTTP_DEFAULTS);
    });
  });

  it('clears the active profile state and restores documented defaults', async () => {
    await withTempStateDir(async () => {
      await invokeCli(['tool', 'call', 'flux_set_base_url', '--json', '--arg', 'baseUrl=https://clear-me.example'], {
        toolRuntime: createFakeStateToolRuntime(),
        persistedStateMode: 'on',
      });

      await invokeCli(
        [
          'tool',
          'call',
          'flux_set_zelidauth',
          '--json',
          '--args-json',
          JSON.stringify({ zelidauth: { zelid: 'clearme', signature: 'sig', loginPhrase: 'phrase' } }),
        ],
        {
          toolRuntime: createFakeStateToolRuntime(),
          persistedStateMode: 'on',
        }
      );

      await invokeCli(
        ['tool', 'call', 'flux_set_enterprise_key', '--json', '--arg', 'enterpriseKey=clear-me-key'],
        {
          toolRuntime: createFakeStateToolRuntime(),
          persistedStateMode: 'on',
        }
      );

      await invokeCli(
        [
          'tool',
          'call',
          'flux_set_http_defaults',
          '--json',
          '--arg',
          'timeoutMs=45000',
          '--arg',
          'retryCount=7',
          '--arg',
          'retryBackoffMs=1100',
        ],
        {
          toolRuntime: createFakeStateToolRuntime(),
          persistedStateMode: 'on',
        }
      );

      await invokeCli(
        ['tool', 'call', 'flux_fluxdrive_set_base_url', '--json', '--arg', 'baseUrl=https://clear.mws.example'],
        {
          toolRuntime: createFakeStateToolRuntime(),
          persistedStateMode: 'on',
        }
      );

      const clearResult = await invokeCli(['state', 'clear', '--json']);
      expect(clearResult.exitCode).toBe(0);
      expect(clearResult.stderr).toBe('');

      const clearPayload = JSON.parse(clearResult.stdout) as {
        ok: boolean;
        status: string;
        action: string;
        state: {
          activeProfile: string;
          baseUrl: string | null;
          auth: { present: boolean };
          enterpriseKey: { present: boolean };
          fluxDriveMwsBaseUrl: string;
          httpDefaults: { timeoutMs: number; retryCount: number; retryBackoffMs: number };
        };
      };

      expect(clearPayload.ok).toBe(true);
      expect(clearPayload.status).toBe('ok');
      expect(clearPayload.action).toBe('clear');
      expect(clearPayload.state.activeProfile).toBe('default');
      expect(clearPayload.state.baseUrl).toBe('https://api.runonflux.io');
      expect(clearPayload.state.auth).toEqual({ present: false });
      expect(clearPayload.state.enterpriseKey).toEqual({ present: false });
      expect(clearPayload.state.fluxDriveMwsBaseUrl).toBe(DEFAULT_FLUXDRIVE_BASE_URL);
      expect(clearPayload.state.httpDefaults).toEqual(DEFAULT_HTTP_DEFAULTS);

      const getStateResult = await invokeCli(['tool', 'call', 'flux_get_state', '--json'], {
        toolRuntime: createFakeStateToolRuntime(),
        persistedStateMode: 'on',
      });

      expect(getStateResult.exitCode).toBe(0);

      const genericPayload = JSON.parse(getStateResult.stdout) as {
        result: {
          baseUrl: string | null;
          zelidauth: { present: boolean };
          enterpriseKey: { present: boolean };
          fluxDriveMwsBaseUrl: string;
          httpDefaults: { timeoutMs: number; retryCount: number; retryBackoffMs: number };
        };
      };

      expect(genericPayload.result.baseUrl).toBe('https://api.runonflux.io');
      expect(genericPayload.result.zelidauth).toEqual({ present: false });
      expect(genericPayload.result.enterpriseKey).toEqual({ present: false });
      expect(genericPayload.result.fluxDriveMwsBaseUrl).toBe(DEFAULT_FLUXDRIVE_BASE_URL);
      expect(genericPayload.result.httpDefaults).toEqual(DEFAULT_HTTP_DEFAULTS);
    });
  });

  it('shows env-backed effective state and state clear neutralizes env-backed runtime inputs', async () => {
    const envZelidauth = JSON.stringify({ zelid: 'env-user', signature: 'env-signature', loginPhrase: 'env-phrase' });

    await withTempStateDir(
      async () => {
        const showResult = await invokeCli(['state', 'show', '--json']);
        expect(showResult.exitCode).toBe(0);
        expect(showResult.stderr).toBe('');

        const showPayload = JSON.parse(showResult.stdout) as {
          state: {
            activeProfile: string;
            baseUrl: string | null;
            auth: { present: boolean; zelid?: string };
            enterpriseKey: { present: boolean };
            fluxDriveMwsBaseUrl: string;
            httpDefaults: { timeoutMs: number; retryCount: number; retryBackoffMs: number };
          };
        };

        expect(showPayload.state).toMatchObject({
          activeProfile: 'default',
          baseUrl: 'https://env.api.example',
          auth: { present: true, zelid: 'env-user' },
          enterpriseKey: { present: true },
          fluxDriveMwsBaseUrl: 'https://env.mws.example',
          httpDefaults: { timeoutMs: 91000, retryCount: 9, retryBackoffMs: 321 },
        });

        const beforeClear = await invokeCli(['tool', 'call', 'flux_get_state', '--json'], {
          toolRuntime: createFakeStateToolRuntime(),
          persistedStateMode: 'on',
        });

        expect(beforeClear.exitCode).toBe(0);

        const beforeClearPayload = JSON.parse(beforeClear.stdout) as {
          result: {
            baseUrl: string | null;
            zelidauth: { present: boolean; zelid?: string };
            enterpriseKey: { present: boolean };
            fluxDriveMwsBaseUrl: string;
            httpDefaults: { timeoutMs: number; retryCount: number; retryBackoffMs: number };
          };
        };

        expect(beforeClearPayload.result).toEqual({
          baseUrl: 'https://env.api.example',
          zelidauth: { present: true, zelid: 'env-user' },
          enterpriseKey: { present: true },
          fluxDriveMwsBaseUrl: 'https://env.mws.example',
          httpDefaults: { timeoutMs: 91000, retryCount: 9, retryBackoffMs: 321 },
        });

        const clearResult = await invokeCli(['state', 'clear', '--json']);
        expect(clearResult.exitCode).toBe(0);
        expect(clearResult.stderr).toBe('');

        const clearPayload = JSON.parse(clearResult.stdout) as {
          state: {
            activeProfile: string;
            baseUrl: string | null;
            auth: { present: boolean; zelid?: string };
            enterpriseKey: { present: boolean };
            fluxDriveMwsBaseUrl: string;
            httpDefaults: { timeoutMs: number; retryCount: number; retryBackoffMs: number };
          };
        };

        expect(clearPayload.state).toMatchObject({
          activeProfile: 'default',
          baseUrl: 'https://env.api.example',
          auth: { present: false },
          enterpriseKey: { present: false },
          fluxDriveMwsBaseUrl: DEFAULT_FLUXDRIVE_BASE_URL,
          httpDefaults: DEFAULT_HTTP_DEFAULTS,
        });

        const afterClear = await invokeCli(['tool', 'call', 'flux_get_state', '--json'], {
          toolRuntime: createFakeStateToolRuntime(),
          persistedStateMode: 'on',
        });

        expect(afterClear.exitCode).toBe(0);

        const afterClearPayload = JSON.parse(afterClear.stdout) as {
          result: {
            baseUrl: string | null;
            zelidauth: { present: boolean; zelid?: string };
            enterpriseKey: { present: boolean };
            fluxDriveMwsBaseUrl: string;
            httpDefaults: { timeoutMs: number; retryCount: number; retryBackoffMs: number };
          };
        };

        expect(afterClearPayload.result).toEqual({
          baseUrl: 'https://env.api.example',
          zelidauth: { present: false },
          enterpriseKey: { present: false },
          fluxDriveMwsBaseUrl: DEFAULT_FLUXDRIVE_BASE_URL,
          httpDefaults: DEFAULT_HTTP_DEFAULTS,
        });
      },
      {
        FLUX_API_BASE_URL: 'https://env.api.example/',
        FLUX_ZELIDAUTH: envZelidauth,
        FLUX_ENTERPRISE_KEY: 'env-enterprise-key',
        FLUXDRIVE_MWS_BASE_URL: 'https://env.mws.example/',
        FLUX_HTTP_TIMEOUT_MS: '91000',
        FLUX_HTTP_RETRY_COUNT: '9',
        FLUX_HTTP_RETRY_BACKOFF_MS: '321',
      }
    );
  });
});
