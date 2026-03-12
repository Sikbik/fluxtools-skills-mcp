import { mkdtemp, rm, writeFile } from 'node:fs/promises';
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

describe('tool args output exit-codes', () => {
  it('normalizes --arg, --args-json, and --args-file into the same payload', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'fluxos-cli-args-'));
    const argsFile = join(tempDir, 'args.json');
    const capturedArgs: unknown[] = [];

    await writeFile(argsFile, JSON.stringify({ query: 'appregister', limit: 1, filters: { category: 'apps' } }), 'utf8');

    const toolRuntime = {
      listTools: async () => [],
      callTool: async (_name: string, rawArgs: unknown) => {
        capturedArgs.push(rawArgs);
        return {
          isError: false,
          structuredContent: { ok: true, echoedArgs: rawArgs },
          content: [{ type: 'text', text: JSON.stringify(rawArgs) }],
        };
      },
    };

    try {
      const argCapture = createCapture();
      const jsonCapture = createCapture();
      const fileCapture = createCapture();

      const argExitCode = await runCli(
        [
          'tool',
          'call',
          'flux_search_endpoints',
          '--arg',
          'query=appregister',
          '--arg',
          'limit=1',
          '--arg',
          'filters={"category":"apps"}',
          '--json',
        ],
        { io: argCapture.io, toolRuntime }
      );

      const jsonExitCode = await runCli(
        [
          'tool',
          'call',
          'flux_search_endpoints',
          '--args-json',
          '{"query":"appregister","limit":1,"filters":{"category":"apps"}}',
          '--json',
        ],
        { io: jsonCapture.io, toolRuntime }
      );

      const fileExitCode = await runCli(
        ['tool', 'call', 'flux_search_endpoints', '--args-file', argsFile, '--json'],
        { io: fileCapture.io, toolRuntime }
      );

      expect(argExitCode).toBe(0);
      expect(jsonExitCode).toBe(0);
      expect(fileExitCode).toBe(0);

      expect(capturedArgs).toEqual([
        { query: 'appregister', limit: 1, filters: { category: 'apps' } },
        { query: 'appregister', limit: 1, filters: { category: 'apps' } },
        { query: 'appregister', limit: 1, filters: { category: 'apps' } },
      ]);

      const argPayload = JSON.parse(argCapture.getStdout()) as Record<string, unknown>;
      const jsonPayload = JSON.parse(jsonCapture.getStdout()) as Record<string, unknown>;
      const filePayload = JSON.parse(fileCapture.getStdout()) as Record<string, unknown>;

      expect(argPayload.result).toEqual(jsonPayload.result);
      expect(jsonPayload.result).toEqual(filePayload.result);
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it('returns a validation error for malformed --args-json input in JSON mode', async () => {
    const capture = createCapture();

    const exitCode = await runCli(['tool', 'call', 'flux_demo', '--args-json', '{"broken":', '--json'], {
      io: capture.io,
      toolRuntime: {
        listTools: async () => [],
        callTool: async () => ({ isError: false, structuredContent: {}, content: [] }),
      },
    });

    expect(exitCode).toBe(2);
    expect(capture.getStderr()).toBe('');

    const payload = JSON.parse(capture.getStdout()) as Record<string, unknown>;
    expect(payload.ok).toBe(false);
    expect(payload.status).toBe('validation_error');
    expect(payload.error).toBe('Invalid JSON for --args-json: Unexpected end of JSON input');
  });

  it('keeps --json parseable, --pretty human-readable, and --raw unwrapped', async () => {
    const jsonCapture = createCapture();
    const prettyCapture = createCapture();
    const rawCapture = createCapture();

    const rawResult = {
      isError: false,
      structuredContent: { ok: true, status: 'ready', resourceUri: 'flux://resource/demo', nextActions: [{ step: 'next' }] },
      content: [
        { type: 'text', text: '{"ok":true,"status":"ready"}' },
        { type: 'resource_link', uri: 'flux://resource/demo', name: 'demo', mimeType: 'application/json' },
      ],
    };

    const toolRuntime = {
      listTools: async () => [],
      callTool: async () => rawResult,
    };

    const jsonExitCode = await runCli(['tool', 'call', 'flux_demo', '--json'], { io: jsonCapture.io, toolRuntime });
    const prettyExitCode = await runCli(['tool', 'call', 'flux_demo', '--pretty'], { io: prettyCapture.io, toolRuntime });
    const rawExitCode = await runCli(['tool', 'call', 'flux_demo', '--raw'], { io: rawCapture.io, toolRuntime });

    expect(jsonExitCode).toBe(0);
    expect(prettyExitCode).toBe(0);
    expect(rawExitCode).toBe(0);

    const jsonPayload = JSON.parse(jsonCapture.getStdout()) as Record<string, unknown>;
    expect(jsonPayload.ok).toBe(true);
    expect(jsonPayload.resourceUri).toBe('flux://resource/demo');
    expect(jsonCapture.getStderr()).toBe('');

    expect(prettyCapture.getStderr()).toBe('');
    expect(prettyCapture.getStdout()).toContain('Tool: flux_demo');
    expect(prettyCapture.getStdout()).toContain('Resource URI: flux://resource/demo');
    expect(prettyCapture.getStdout()).toContain('Next actions:');

    expect(rawCapture.getStderr()).toBe('');
    expect(JSON.parse(rawCapture.getStdout())).toEqual(rawResult);
  });

  it.each([
    {
      name: 'validation failures',
      expectedExitCode: 2,
      toolResult: {
        isError: true,
        structuredContent: { error: 'limit must be a number' },
        content: [{ type: 'text', text: '{"error":"limit must be a number"}' }],
      },
    },
    {
      name: 'auth-required failures',
      expectedExitCode: 3,
      toolResult: {
        isError: true,
        structuredContent: { ok: false, error: 'Authentication required (zelidauth not set).' },
        content: [{ type: 'text', text: '{"ok":false,"error":"Authentication required (zelidauth not set)."}' }],
      },
    },
    {
      name: 'confirm-required failures',
      expectedExitCode: 4,
      toolResult: {
        isError: true,
        structuredContent: { error: 'confirm=true is required to run: apps/appstart' },
        content: [{ type: 'text', text: '{"error":"confirm=true is required to run: apps/appstart"}' }],
      },
    },
    {
      name: 'network failures',
      expectedExitCode: 5,
      toolResult: {
        isError: true,
        structuredContent: { error: 'Error: fetch failed (network error)' },
        content: [{ type: 'text', text: '{"error":"Error: fetch failed (network error)"}' }],
      },
    },
    {
      name: 'Flux failures',
      expectedExitCode: 6,
      toolResult: {
        isError: false,
        structuredContent: undefined,
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              url: 'https://api.runonflux.io/apps/example',
              status: 200,
              ok: true,
              headers: {},
              data: { status: 'error', data: 'Flux execution failed' },
            }),
          },
        ],
      },
    },
  ])('maps $name to the expected shell exit code', async ({ toolResult, expectedExitCode }) => {
    const capture = createCapture();

    const exitCode = await runCli(['tool', 'call', 'flux_demo', '--json'], {
      io: capture.io,
      toolRuntime: {
        listTools: async () => [],
        callTool: async () => toolResult,
      },
    });

    expect(exitCode).toBe(expectedExitCode);
    expect(capture.getStderr()).toBe('');

    const payload = JSON.parse(capture.getStdout()) as Record<string, unknown>;
    expect(payload.ok).toBe(false);
  });
});
