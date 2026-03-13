import { mkdtemp, rm } from 'node:fs/promises';
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

async function withTempStateDir<T>(
  overrides: { ttlMs?: string; maxEntries?: string } | undefined,
  run: (stateDir: string) => Promise<T>
) {
  const stateDir = await mkdtemp(join(tmpdir(), 'fluxos-cli-resources-'));
  const previousStateDir = process.env.FLUXOS_CLI_STATE_DIR;
  const previousTtl = process.env.FLUXOS_CLI_RESOURCE_TTL_MS;
  const previousMaxEntries = process.env.FLUXOS_CLI_RESOURCE_MAX_ENTRIES;

  process.env.FLUXOS_CLI_STATE_DIR = stateDir;

  if (overrides?.ttlMs !== undefined) process.env.FLUXOS_CLI_RESOURCE_TTL_MS = overrides.ttlMs;
  else delete process.env.FLUXOS_CLI_RESOURCE_TTL_MS;

  if (overrides?.maxEntries !== undefined) process.env.FLUXOS_CLI_RESOURCE_MAX_ENTRIES = overrides.maxEntries;
  else delete process.env.FLUXOS_CLI_RESOURCE_MAX_ENTRIES;

  try {
    return await run(stateDir);
  } finally {
    if (previousStateDir === undefined) delete process.env.FLUXOS_CLI_STATE_DIR;
    else process.env.FLUXOS_CLI_STATE_DIR = previousStateDir;

    if (previousTtl === undefined) delete process.env.FLUXOS_CLI_RESOURCE_TTL_MS;
    else process.env.FLUXOS_CLI_RESOURCE_TTL_MS = previousTtl;

    if (previousMaxEntries === undefined) delete process.env.FLUXOS_CLI_RESOURCE_MAX_ENTRIES;
    else process.env.FLUXOS_CLI_RESOURCE_MAX_ENTRIES = previousMaxEntries;

    await rm(stateDir, { recursive: true, force: true });
  }
}

describe.sequential('resource commands', () => {
  it('persists resource outputs and can list/read them across fresh CLI invocations', async () => {
    await withTempStateDir(undefined, async () => {
      const createdUri = 'flux://resource/demo/persisted';
      const createCaptureOne = createCapture();

      const createExitCode = await runCli(['tool', 'call', 'flux_demo', '--json'], {
        io: createCaptureOne.io,
        toolRuntime: {
          listTools: async () => [],
          callTool: async () => ({
            isError: false,
            structuredContent: { ok: true, resourceUri: createdUri },
            content: [
              { type: 'text', text: '{"ok":true}' },
              {
                type: 'resource_link',
                uri: createdUri,
                name: 'Persisted demo resource',
                description: 'Stored across CLI invocations',
                mimeType: 'application/json',
              },
            ],
          }),
          readResource: async () => ({
            uri: createdUri,
            mimeType: 'application/json',
            text: JSON.stringify({ safe: 'value', count: 2 }),
          }),
        },
      });

      expect(createExitCode).toBe(0);

      const listCapture = createCapture();
      const listExitCode = await runCli(['resource', 'list', '--json'], { io: listCapture.io });
      expect(listExitCode).toBe(0);
      expect(listCapture.getStderr()).toBe('');

      const listed = JSON.parse(listCapture.getStdout()) as {
        ok: boolean;
        status: string;
        resources: Array<{ uri: string; name: string; mimeType: string; persistent: boolean }>;
      };

      expect(listed.ok).toBe(true);
      expect(listed.status).toBe('ok');
      expect(listed.resources.some((resource) => resource.uri === createdUri && resource.persistent === true)).toBe(true);

      const readCapture = createCapture();
      const readExitCode = await runCli(['resource', 'read', createdUri, '--json'], { io: readCapture.io });
      expect(readExitCode).toBe(0);
      expect(readCapture.getStderr()).toBe('');

      const readPayload = JSON.parse(readCapture.getStdout()) as {
        ok: boolean;
        status: string;
        resource: { uri: string; mimeType: string; name: string; persistent: boolean };
        contents: { value: { safe: string; count: number } };
      };

      expect(readPayload.ok).toBe(true);
      expect(readPayload.status).toBe('ok');
      expect(readPayload.resource.uri).toBe(createdUri);
      expect(readPayload.resource.name).toBe('Persisted demo resource');
      expect(readPayload.resource.mimeType).toBe('application/json');
      expect(readPayload.resource.persistent).toBe(true);
      expect(readPayload.contents.value).toEqual({ safe: 'value', count: 2 });
    });
  });

  it('prints raw resource contents without altering the stored text', async () => {
    await withTempStateDir(undefined, async () => {
      const createdUri = 'flux://resource/demo/raw';

      const createExitCode = await runCli(['tool', 'call', 'flux_demo', '--json'], {
        io: createCapture().io,
        toolRuntime: {
          listTools: async () => [],
          callTool: async () => ({
            isError: false,
            structuredContent: { ok: true, resourceUri: createdUri },
            content: [
              { type: 'text', text: '{"ok":true}' },
              {
                type: 'resource_link',
                uri: createdUri,
                name: 'Raw text resource',
                mimeType: 'text/plain',
              },
            ],
          }),
          readResource: async () => ({
            uri: createdUri,
            mimeType: 'text/plain',
            text: 'sign this exactly',
          }),
        },
      });

      expect(createExitCode).toBe(0);

      const readCapture = createCapture();
      const readExitCode = await runCli(['resource', 'read', createdUri, '--raw'], { io: readCapture.io });

      expect(readExitCode).toBe(0);
      expect(readCapture.getStderr()).toBe('');
      expect(readCapture.getStdout()).toBe('sign this exactly');
    });
  });

  it('redacts sensitive fields when persisting and re-reading structured resources', async () => {
    await withTempStateDir(undefined, async () => {
      const createdUri = 'flux://resource/demo/redacted';
      const createCaptureOne = createCapture();

      const createExitCode = await runCli(['tool', 'call', 'flux_demo', '--json'], {
        io: createCaptureOne.io,
        toolRuntime: {
          listTools: async () => [],
          callTool: async () => ({
            isError: false,
            structuredContent: { ok: true, resourceUri: createdUri },
            content: [
              { type: 'text', text: '{"ok":true}' },
              {
                type: 'resource_link',
                uri: createdUri,
                name: 'Sensitive JSON resource',
                mimeType: 'application/json',
              },
            ],
          }),
          readResource: async () => ({
            uri: createdUri,
            mimeType: 'application/json',
            text: JSON.stringify({
              safe: 'value',
              authorization: 'Bearer abc',
              cookie: 'session=123',
              signature: 'deadbeef',
              loginPhrase: 'please sign this',
              privateKey: 'super-secret',
              nested: {
                passphrase: 'nested-secret',
              },
            }),
          }),
        },
      });

      expect(createExitCode).toBe(0);

      const readCapture = createCapture();
      const readExitCode = await runCli(['resource', 'read', createdUri, '--json'], { io: readCapture.io });
      expect(readExitCode).toBe(0);

      const readPayload = JSON.parse(readCapture.getStdout()) as {
        contents: {
          value: {
            safe: string;
            authorization: string;
            cookie: string;
            signature: string;
            loginPhrase: string;
            privateKey: string;
            nested: { passphrase: string };
          };
        };
      };

      expect(readPayload.contents.value.safe).toBe('value');
      expect(readPayload.contents.value.authorization).toBe('<REDACTED>');
      expect(readPayload.contents.value.cookie).toBe('<REDACTED>');
      expect(readPayload.contents.value.signature).toBe('<REDACTED>');
      expect(readPayload.contents.value.loginPhrase).toBe('<REDACTED>');
      expect(readPayload.contents.value.privateKey).toBe('<REDACTED>');
      expect(readPayload.contents.value.nested.passphrase).toBe('<REDACTED>');
    });
  });

  it('hydrates persisted resource URIs back into the tool runtime for chainable calls', async () => {
    await withTempStateDir(undefined, async () => {
      const createdUri = 'flux://resource/demo/message';

      const firstCapture = createCapture();
      const firstExitCode = await runCli(['tool', 'call', 'flux_demo', '--json'], {
        io: firstCapture.io,
        toolRuntime: {
          listTools: async () => [],
          callTool: async () => ({
            isError: false,
            structuredContent: { ok: true, resourceUri: createdUri },
            content: [
              { type: 'text', text: '{"ok":true}' },
              {
                type: 'resource_link',
                uri: createdUri,
                name: 'Message to sign',
                mimeType: 'text/plain',
              },
            ],
          }),
          readResource: async () => ({
            uri: createdUri,
            mimeType: 'text/plain',
            text: 'sign me exactly',
          }),
        },
      });

      expect(firstExitCode).toBe(0);

      const hydrated: Array<{ uri: string; text: string; mimeType?: string }> = [];
      let observedArgs: unknown;
      const secondCapture = createCapture();

      const secondExitCode = await runCli(
        ['tool', 'call', 'flux_build_zelcore_sign_link', '--arg', `messageResourceUri=${createdUri}`, '--json'],
        {
          io: secondCapture.io,
          toolRuntime: {
            listTools: async () => [],
            callTool: async (_name: string, rawArgs: unknown) => {
              observedArgs = rawArgs;
              return {
                isError: false,
                structuredContent: { ok: true, source: 'resource' },
                content: [{ type: 'text', text: '{"ok":true,"source":"resource"}' }],
              };
            },
            hydrateResource: async (resource) => {
              hydrated.push({ uri: resource.uri, text: resource.text, mimeType: resource.mimeType });
            },
          },
        }
      );

      expect(secondExitCode).toBe(0);
      expect(observedArgs).toEqual({ messageResourceUri: createdUri });
      expect(hydrated).toEqual([{ uri: createdUri, text: 'sign me exactly', mimeType: 'text/plain' }]);
    });
  });

  it('keeps persisted resource follow-up actions working across fresh CLI invocations', async () => {
    await withTempStateDir(undefined, async () => {
      const createdUri = 'flux://resource/demo/follow-up';
      const createCaptureOne = createCapture();

      const createExitCode = await runCli(['tool', 'call', 'flux_demo', '--json'], {
        io: createCaptureOne.io,
        toolRuntime: {
          listTools: async () => [],
          callTool: async () => ({
            isError: false,
            structuredContent: {
              ok: true,
              resourceUri: createdUri,
              nextActions: [{ tool: 'flux_resource_read', arguments: { uri: createdUri } }],
            },
            content: [
              { type: 'text', text: '{"ok":true}' },
              {
                type: 'resource_link',
                uri: createdUri,
                name: 'Persisted follow-up resource',
                mimeType: 'application/json',
              },
            ],
          }),
          readResource: async () => ({
            uri: createdUri,
            mimeType: 'application/json',
            text: JSON.stringify({ safe: 'persisted-follow-up' }),
          }),
        },
      });

      expect(createExitCode).toBe(0);

      const createPayload = JSON.parse(createCaptureOne.getStdout()) as {
        nextActions: Array<{ tool?: string; arguments?: { uri?: string } }>;
      };

      expect(createPayload.nextActions).toEqual([{ tool: 'flux_resource_read', arguments: { uri: createdUri } }]);

      const followUpCapture = createCapture();
      const followUp = createPayload.nextActions[0];
      const followUpExitCode = await runCli(['tool', 'call', followUp.tool ?? '', '--arg', `uri=${createdUri}`, '--json'], {
        io: followUpCapture.io,
      });

      expect(followUpExitCode).toBe(0);
      expect(followUpCapture.getStderr()).toBe('');

      const followUpPayload = JSON.parse(followUpCapture.getStdout()) as {
        ok: boolean;
        tool: string;
        result: { ok: boolean; uri: string; mimeType: string };
      };

      expect(followUpPayload.ok).toBe(true);
      expect(followUpPayload.tool).toBe('flux_resource_read');
      expect(followUpPayload.result).toEqual({ ok: true, uri: createdUri, mimeType: 'application/json' });
    });
  });

  it('omits expired resources from listings and prunes them on read misses', async () => {
    await withTempStateDir({ ttlMs: '25' }, async () => {
      const createdUri = 'flux://resource/demo/expired-listing';

      const createExitCode = await runCli(['tool', 'call', 'flux_demo', '--json'], {
        io: createCapture().io,
        toolRuntime: {
          listTools: async () => [],
          callTool: async () => ({
            isError: false,
            structuredContent: { ok: true, resourceUri: createdUri },
            content: [
              { type: 'text', text: '{"ok":true}' },
              {
                type: 'resource_link',
                uri: createdUri,
                name: 'Short lived resource',
                mimeType: 'application/json',
              },
            ],
          }),
          readResource: async () => ({
            uri: createdUri,
            mimeType: 'application/json',
            text: JSON.stringify({ created: true }),
          }),
        },
      });

      expect(createExitCode).toBe(0);
      await new Promise((resolve) => setTimeout(resolve, 40));

      const listCapture = createCapture();
      const listExitCode = await runCli(['resource', 'list', '--json'], { io: listCapture.io });

      expect(listExitCode).toBe(0);
      expect(listCapture.getStderr()).toBe('');

      const listPayload = JSON.parse(listCapture.getStdout()) as {
        count: number;
        resources: Array<{ uri: string }>;
      };

      expect(listPayload.count).toBe(0);
      expect(listPayload.resources).toEqual([]);

      const readCapture = createCapture();
      const readExitCode = await runCli(['resource', 'read', createdUri, '--json'], { io: readCapture.io });

      expect(readExitCode).toBe(2);

      const readPayload = JSON.parse(readCapture.getStdout()) as { ok: boolean; error: string };
      expect(readPayload.ok).toBe(false);
      expect(readPayload.error).toBe(`Resource not found: ${createdUri}`);

      const pruneCapture = createCapture();
      const pruneExitCode = await runCli(['resource', 'prune', '--json'], { io: pruneCapture.io });

      expect(pruneExitCode).toBe(0);

      const prunePayload = JSON.parse(pruneCapture.getStdout()) as {
        before: number;
        after: number;
        removedExpired: number;
      };

      expect(prunePayload.before).toBe(0);
      expect(prunePayload.after).toBe(0);
      expect(prunePayload.removedExpired).toBe(0);
    });
  });

  it('reports expired and overflow removals when pruning the disk-backed store', async () => {
    await withTempStateDir({ ttlMs: '40', maxEntries: '1' }, async () => {
      let counter = 0;

      const createRuntime = {
        listTools: async () => [],
        callTool: async () => {
          counter += 1;
          const uri = `flux://resource/demo/prune-${counter}`;

          return {
            isError: false,
            structuredContent: { ok: true, resourceUri: uri },
            content: [
              { type: 'text', text: '{"ok":true}' },
              {
                type: 'resource_link',
                uri,
                name: `Prune resource ${counter}`,
                mimeType: 'application/json',
              },
            ],
          };
        },
        readResource: async (uri: string) => ({
          uri,
          mimeType: 'application/json',
          text: JSON.stringify({ uri }),
        }),
      };

      expect(await runCli(['tool', 'call', 'flux_demo', '--json'], { io: createCapture().io, toolRuntime: createRuntime })).toBe(0);
      await new Promise((resolve) => setTimeout(resolve, 60));
      expect(await runCli(['tool', 'call', 'flux_demo', '--json'], { io: createCapture().io, toolRuntime: createRuntime })).toBe(0);
      expect(await runCli(['tool', 'call', 'flux_demo', '--json'], { io: createCapture().io, toolRuntime: createRuntime })).toBe(0);

      const pruneCapture = createCapture();
      const pruneExitCode = await runCli(['resource', 'prune', '--json'], { io: pruneCapture.io });

      expect(pruneExitCode).toBe(0);
      expect(pruneCapture.getStderr()).toBe('');

      const payload = JSON.parse(pruneCapture.getStdout()) as {
        ok: boolean;
        status: string;
        action: string;
        before: number;
        after: number;
        removedExpired: number;
        removedOverflow: number;
      };

      expect(payload.ok).toBe(true);
      expect(payload.status).toBe('ok');
      expect(payload.action).toBe('prune');
      expect(payload.before).toBe(3);
      expect(payload.after).toBe(1);
      expect(payload.removedExpired).toBe(1);
      expect(payload.removedOverflow).toBe(1);
    });
  });
});
