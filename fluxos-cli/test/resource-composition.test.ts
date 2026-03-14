import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { runCli, type ToolRuntime } from '../src/cli.js';
import { persistCliResource } from '../src/state/resourceStore.js';

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

async function withTempStateDir<T>(run: () => Promise<T>) {
  const stateDir = await mkdtemp(join(tmpdir(), 'fluxos-cli-resource-composition-'));
  const previousStateDir = process.env.FLUXOS_CLI_STATE_DIR;

  process.env.FLUXOS_CLI_STATE_DIR = stateDir;

  try {
    return await run();
  } finally {
    if (previousStateDir === undefined) delete process.env.FLUXOS_CLI_STATE_DIR;
    else process.env.FLUXOS_CLI_STATE_DIR = previousStateDir;

    await rm(stateDir, { recursive: true, force: true });
  }
}

async function persistJsonResource(uri: string, name: string, value: unknown) {
  const text = JSON.stringify(value, null, 2);

  await persistCliResource({
    descriptor: {
      uri,
      name,
      mimeType: 'application/json',
    },
    contents: {
      uri,
      mimeType: 'application/json',
      text,
    },
  });
}

function createCompositionRuntime(): ToolRuntime {
  const jsonResult = (payload: Record<string, unknown>, isError = false) => ({
    isError,
    structuredContent: payload,
    content: [{ type: 'text', text: JSON.stringify(payload) }],
  });

  return {
    async listTools() {
      return [];
    },

    async callTool(name, rawArgs) {
      const args = asRecord(rawArgs);

      switch (name) {
        case 'flux_echo_args':
          return jsonResult({ ok: true, args });

        case 'flux_apps_verify_registration_spec':
          return jsonResult({ spec: args.spec });

        case 'flux_apps_register':
          return jsonResult({
            status: 'submitted',
            appname: asRecord(args.spec).name,
            hash: 'abc123',
          });

        default:
          return jsonResult({ ok: false, error: `Unknown tool: ${name}` }, true);
      }
    },
  };
}

async function invokeCli(argv: string[], toolRuntime: ToolRuntime) {
  const capture = createCapture();
  const exitCode = await runCli(argv, {
    io: capture.io,
    toolRuntime,
    persistedStateMode: 'off',
  });

  return {
    exitCode,
    stdout: capture.getStdout(),
    stderr: capture.getStderr(),
  };
}

describe.sequential('resource composition aliases', () => {
  it('hydrates generic tool args from --from-resource-uri', async () => {
    await withTempStateDir(async () => {
      const uri = 'flux://resource/test/tool-args';
      await persistJsonResource(uri, 'tool args', { foo: 'bar', count: 2 });

      const result = await invokeCli(['tool', 'call', 'flux_echo_args', '--from-resource-uri', uri, '--json'], createCompositionRuntime());

      expect(result.exitCode).toBe(0);
      const payload = JSON.parse(result.stdout) as Record<string, unknown>;
      expect(payload.ok).toBe(true);
      expect(payload.tool).toBe('flux_echo_args');
      expect(payload.result).toEqual({ ok: true, args: { foo: 'bar', count: 2 } });
    });
  });

  it('routes spec artifacts into spec-based app commands', async () => {
    await withTempStateDir(async () => {
      const uri = 'flux://resource/test/spec-artifact';
      await persistJsonResource(uri, 'verified spec', {
        validation: 'registration',
        spec: {
          version: 8,
          name: 'alpha',
          owner: 'zelid1',
        },
      });

      const result = await invokeCli(
        ['apps', 'verify-registration', '--from-resource-uri', uri, '--json'],
        createCompositionRuntime()
      );

      expect(result.exitCode).toBe(0);
      const payload = JSON.parse(result.stdout) as Record<string, unknown>;
      expect(payload.ok).toBe(true);
      expect((payload.spec as Record<string, unknown>).name).toBe('alpha');
    });
  });

  it('routes planning artifacts into plan-based submission flow inputs', async () => {
    await withTempStateDir(async () => {
      const uri = 'flux://resource/test/plan-artifact';
      await persistJsonResource(uri, 'registration plan', {
        timestamp: 1710000000000,
        typeVersion: 8,
        verified: {
          spec: {
            version: 8,
            name: 'beta',
            owner: 'zelid2',
          },
        },
        messageToSignResourceUri: 'flux://resource/test/message',
      });

      const result = await invokeCli(
        ['apps', 'register', '--from-resource-uri', uri, '--signature', 'signed', '--json'],
        createCompositionRuntime()
      );

      expect(result.exitCode).toBe(0);
      const payload = JSON.parse(result.stdout) as Record<string, unknown>;
      expect(payload.ok).toBe(true);
      expect(payload.source).toBe('plan');
      expect(payload.planResourceUri).toBe(uri);
      expect(payload.timestamp).toBe(1710000000000);
      expect(payload.verifyFirst).toBe(false);
      expect(payload.appname).toBe('beta');
    });
  });

  it('keeps spec artifacts on the spec submission path when they are not planning records', async () => {
    await withTempStateDir(async () => {
      const uri = 'flux://resource/test/plain-spec';
      await persistJsonResource(uri, 'plain spec', {
        spec: {
          version: 8,
          name: 'gamma',
          owner: 'zelid3',
        },
      });

      const result = await invokeCli(
        [
          'apps',
          'register',
          '--from-resource-uri',
          uri,
          '--signature',
          'signed',
          '--timestamp',
          '1710000000999',
          '--type-version',
          '8',
          '--json',
        ],
        createCompositionRuntime()
      );

      expect(result.exitCode).toBe(0);
      const payload = JSON.parse(result.stdout) as Record<string, unknown>;
      expect(payload.ok).toBe(true);
      expect(payload.source).toBe('spec');
      expect(payload.planResourceUri).toBeNull();
      expect(payload.verifyFirst).toBe(true);
      expect(payload.appname).toBe('gamma');
    });
  });
});
