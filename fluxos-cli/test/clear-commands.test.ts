import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
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

async function withTempStateDir<T>(run: (stateDir: string) => Promise<T>) {
  const stateDir = await mkdtemp(join(tmpdir(), 'fluxos-cli-clear-commands-'));

  const previousStateDir = process.env.FLUXOS_CLI_STATE_DIR;
  const previousXdgStateHome = process.env.XDG_STATE_HOME;

  process.env.FLUXOS_CLI_STATE_DIR = stateDir;
  delete process.env.XDG_STATE_HOME;

  try {
    return await run(stateDir);
  } finally {
    if (previousStateDir === undefined) delete process.env.FLUXOS_CLI_STATE_DIR;
    else process.env.FLUXOS_CLI_STATE_DIR = previousStateDir;

    if (previousXdgStateHome === undefined) delete process.env.XDG_STATE_HOME;
    else process.env.XDG_STATE_HOME = previousXdgStateHome;

    await rm(stateDir, { recursive: true, force: true });
  }
}

async function invokeCli(argv: string[]) {
  const capture = createCapture();
  const exitCode = await runCli(argv, { io: capture.io });

  return {
    exitCode,
    stdout: capture.getStdout(),
    stderr: capture.getStderr(),
  };
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
            zelidauth: JSON.stringify({ zelid: 'standby-user', signature: 'standby-signature' }),
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

describe.sequential('clear-commands', () => {
  it('auth clear removes only auth material for the active profile', async () => {
    await withTempStateDir(async (stateDir) => {
      const stateFile = await seedScopedState(stateDir);

      const result = await invokeCli(['auth', 'clear', '--json']);

      expect(result.exitCode).toBe(0);
      expect(result.stderr).toBe('');

      const payload = JSON.parse(result.stdout) as {
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
      expect(payload.action).toBe('clear');
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
      expect(persisted.profiles.standby.zelidauth).toContain('standby-user');
      expect(persisted.profiles.standby.enterpriseKey).toBe('standby-enterprise-key');
    });
  });

  it('enterprise-key clear removes only the enterprise key for the active profile', async () => {
    await withTempStateDir(async (stateDir) => {
      const stateFile = await seedScopedState(stateDir);

      const result = await invokeCli(['enterprise-key', 'clear', '--json']);

      expect(result.exitCode).toBe(0);
      expect(result.stderr).toBe('');

      const payload = JSON.parse(result.stdout) as {
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
      expect(payload.action).toBe('clear');
      expect(payload.target).toBe('enterprise-key');
      expect(payload.state.activeProfile).toBe('ops');
      expect(payload.state.baseUrl).toBe('https://ops.example');
      expect(payload.state.auth).toEqual({ present: true, zelid: 'ops-user' });
      expect(payload.state.enterpriseKey).toEqual({ present: false });
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
        zelidauth: JSON.stringify({ zelid: 'ops-user', signature: 'ops-signature', loginPhrase: 'ops-phrase' }),
        enterpriseKey: null,
        fluxDriveMwsBaseUrl: 'https://mws.ops.example',
        httpDefaults: { timeoutMs: 12000, retryCount: 4, retryBackoffMs: 900 },
      });
      expect(persisted.profiles.standby.zelidauth).toContain('standby-user');
      expect(persisted.profiles.standby.enterpriseKey).toBe('standby-enterprise-key');
    });
  });
});
