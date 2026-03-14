import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { runCli } from '../src/cli.js';

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

function createFakeStateToolRuntime() {
  let baseUrl: string | null = 'https://api.runonflux.io';
  let zelidauth: string | null = null;
  let enterpriseKey: string | null = null;
  let httpDefaults = {
    timeoutMs: 30000,
    retryCount: 2,
    retryBackoffMs: 500,
  };
  let fluxDriveMwsBaseUrl = 'https://mws.fluxdrive.runonflux.io';

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
            zelidauth: { present: Boolean(zelidauth) },
            enterpriseKey: { present: Boolean(enterpriseKey) },
            httpDefaults,
            fluxDriveMwsBaseUrl,
          });

        case 'flux_set_base_url': {
          baseUrl = normalizeBaseUrl(String(args.baseUrl));
          return jsonResult({
            ok: true,
            baseUrl,
            zelidauth: { present: Boolean(zelidauth) },
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

        case 'flux_clear_zelidauth':
          zelidauth = null;
          return jsonResult({ ok: true, zelidauth: { present: false } });

        case 'flux_set_zelidauth':
          zelidauth = typeof args.zelidauth === 'string' ? args.zelidauth : JSON.stringify(args.zelidauth);
          return jsonResult({ ok: true, zelidauth: { present: true } });

        case 'flux_clear_enterprise_key':
          enterpriseKey = null;
          return jsonResult({ ok: true, enterpriseKey: { present: false } });

        case 'flux_set_enterprise_key':
          enterpriseKey = typeof args.enterpriseKey === 'string' ? args.enterpriseKey : 'set';
          return jsonResult({ ok: true, enterpriseKey: { present: true } });

        case 'flux_fluxdrive_set_base_url':
          fluxDriveMwsBaseUrl = normalizeBaseUrl(String(args.baseUrl));
          return jsonResult({ ok: true, fluxDriveMwsBaseUrl });

        default:
          return jsonResult({ ok: false, error: `Unknown tool: ${name}` }, true);
      }
    },
  };
}

async function withTempStateDir<T>(run: (stateDir: string) => Promise<T>) {
  const stateDir = await mkdtemp(join(tmpdir(), 'fluxos-cli-global-options-'));
  const previousStateDir = process.env.FLUXOS_CLI_STATE_DIR;

  process.env.FLUXOS_CLI_STATE_DIR = stateDir;

  try {
    return await run(stateDir);
  } finally {
    if (previousStateDir === undefined) delete process.env.FLUXOS_CLI_STATE_DIR;
    else process.env.FLUXOS_CLI_STATE_DIR = previousStateDir;

    await rm(stateDir, { recursive: true, force: true });
  }
}

async function invokeCli(
  argv: string[],
  opts?: {
    persistedStateMode?: 'auto' | 'off' | 'on';
  }
) {
  const capture = createCapture();
  const exitCode = await runCli(argv, {
    io: capture.io,
    toolRuntime: createFakeStateToolRuntime(),
    ...(opts?.persistedStateMode ? { persistedStateMode: opts.persistedStateMode } : {}),
  });

  return {
    exitCode,
    stdout: capture.getStdout(),
    stderr: capture.getStderr(),
  };
}

describe.sequential('global CLI workflow options', () => {
  it('scopes persisted state to the selected profile without switching the saved default profile', async () => {
    await withTempStateDir(async () => {
      const defaultSet = await invokeCli(
        ['tool', 'call', 'flux_set_base_url', '--json', '--arg', 'baseUrl=https://default.example'],
        { persistedStateMode: 'on' }
      );
      expect(defaultSet.exitCode).toBe(0);

      const stagingSet = await invokeCli(
        ['--profile', 'staging', 'tool', 'call', 'flux_set_base_url', '--json', '--arg', 'baseUrl=https://staging.example'],
        { persistedStateMode: 'on' }
      );
      expect(stagingSet.exitCode).toBe(0);

      const defaultState = await invokeCli(['state', 'show', '--json']);
      const defaultPayload = JSON.parse(defaultState.stdout) as Record<string, unknown>;
      expect(defaultState.exitCode).toBe(0);
      expect((defaultPayload.state as Record<string, unknown>).activeProfile).toBe('default');
      expect((defaultPayload.state as Record<string, unknown>).baseUrl).toBe('https://default.example');

      const stagingState = await invokeCli(['--profile', 'staging', 'state', 'show', '--json']);
      const stagingPayload = JSON.parse(stagingState.stdout) as Record<string, unknown>;
      expect(stagingState.exitCode).toBe(0);
      expect((stagingPayload.state as Record<string, unknown>).activeProfile).toBe('staging');
      expect((stagingPayload.state as Record<string, unknown>).baseUrl).toBe('https://staging.example');
    });
  });

  it('applies base-url overrides ephemerally without mutating persisted defaults', async () => {
    await withTempStateDir(async () => {
      await invokeCli(
        ['tool', 'call', 'flux_set_base_url', '--json', '--arg', 'baseUrl=https://persisted.example'],
        { persistedStateMode: 'on' }
      );

      const overridden = await invokeCli(
        ['--base-url', 'http://override.example:16127/', 'tool', 'call', 'flux_get_state', '--json'],
        { persistedStateMode: 'on' }
      );

      expect(overridden.exitCode).toBe(0);
      const overridePayload = JSON.parse(overridden.stdout) as Record<string, unknown>;
      expect((overridePayload.result as Record<string, unknown>).baseUrl).toBe('http://override.example:16127');

      const persisted = await invokeCli(['state', 'show', '--json']);
      const persistedPayload = JSON.parse(persisted.stdout) as Record<string, unknown>;
      expect((persistedPayload.state as Record<string, unknown>).baseUrl).toBe('https://persisted.example');

      const overriddenState = await invokeCli(['--base-url', 'http://override.example:16127/', 'state', 'show', '--json']);
      const overriddenStatePayload = JSON.parse(overriddenState.stdout) as Record<string, unknown>;
      expect((overriddenStatePayload.state as Record<string, unknown>).baseUrl).toBe('http://override.example:16127');
    });
  });

  it('supports stateless execution when --no-state is set', async () => {
    await withTempStateDir(async () => {
      await invokeCli(
        ['tool', 'call', 'flux_set_base_url', '--json', '--arg', 'baseUrl=https://persisted.example'],
        { persistedStateMode: 'on' }
      );

      const stateless = await invokeCli(['--no-state', 'tool', 'call', 'flux_get_state', '--json'], {
        persistedStateMode: 'on',
      });
      const statelessPayload = JSON.parse(stateless.stdout) as Record<string, unknown>;
      expect(stateless.exitCode).toBe(0);
      expect((statelessPayload.result as Record<string, unknown>).baseUrl).toBe('https://api.runonflux.io');

      const persisted = await invokeCli(['tool', 'call', 'flux_get_state', '--json'], { persistedStateMode: 'on' });
      const persistedPayload = JSON.parse(persisted.stdout) as Record<string, unknown>;
      expect((persistedPayload.result as Record<string, unknown>).baseUrl).toBe('https://persisted.example');
    });
  });

  it('mirrors stdout into --output-file without changing the stdout contract', async () => {
    await withTempStateDir(async (stateDir) => {
      const outputFile = join(stateDir, 'artifacts', 'state.json');

      const result = await invokeCli(
        ['--output-file', outputFile, 'tool', 'call', 'flux_get_state', '--json'],
        { persistedStateMode: 'on' }
      );

      expect(result.exitCode).toBe(0);
      expect(result.stderr).toBe('');
      expect(JSON.parse(result.stdout)).toMatchObject({ ok: true, tool: 'flux_get_state' });
      expect(await readFile(outputFile, 'utf8')).toBe(result.stdout);
    });
  });
});
