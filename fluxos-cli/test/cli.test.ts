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

describe('fluxos-cli root command', () => {
  it('prints help when no arguments are provided', async () => {
    const capture = createCapture();

    const exitCode = await runCli([], { io: capture.io });

    expect(exitCode).toBe(0);
    expect(capture.getStdout()).toContain('Usage:');
    expect(capture.getStdout()).toContain('flux [global-options] <command>');
    expect(capture.getStdout()).toContain('node resolve-gateway');
    expect(capture.getStderr()).toBe('');
  });

  it('returns a validation-style exit code for unknown commands', async () => {
    const capture = createCapture();

    const exitCode = await runCli(['unknown-command'], { io: capture.io });

    expect(exitCode).toBe(2);
    expect(capture.getStdout()).toBe('');
    expect(capture.getStderr()).toContain('Unknown command: unknown-command');
    expect(capture.getStderr()).toContain('Usage:');
  });

  it('lists tools in stable JSON mode', async () => {
    const capture = createCapture();

    const exitCode = await runCli(['tool', 'list', '--json'], {
      io: capture.io,
      toolRuntime: {
        listTools: async () => [
          { name: 'flux_beta', description: 'Beta description', inputSchema: { type: 'object' } },
          { name: 'flux_alpha', description: 'Alpha description', inputSchema: { type: 'object' } },
        ],
        callTool: async () => ({ content: [], structuredContent: undefined, isError: false }),
      },
    });

    expect(exitCode).toBe(0);
    expect(capture.getStderr()).toBe('');

    const payload = JSON.parse(capture.getStdout()) as Record<string, unknown>;
    expect(payload.ok).toBe(true);
    expect(payload.status).toBe('ok');
    expect(payload.count).toBe(2);

    const tools = payload.tools as Array<{ name: string }>;
    expect(tools.map((tool) => tool.name)).toEqual(['flux_alpha', 'flux_beta']);
  });

  it('renders a readable pretty summary for tool list', async () => {
    const capture = createCapture();

    const exitCode = await runCli(['tool', 'list', '--pretty'], {
      io: capture.io,
      toolRuntime: {
        listTools: async () => [
          { name: 'flux_beta', description: 'Beta description', inputSchema: { type: 'object' } },
          { name: 'flux_alpha', description: 'Alpha description', inputSchema: { type: 'object' } },
        ],
        callTool: async () => ({ content: [], structuredContent: undefined, isError: false }),
      },
    });

    expect(exitCode).toBe(0);
    expect(capture.getStderr()).toBe('');
    expect(capture.getStdout()).toContain('Flux tool catalog (2)');
    expect(capture.getStdout()).toContain('flux_alpha');
    expect(capture.getStdout()).toContain('Alpha description');
    expect(capture.getStdout()).toContain('flux_beta');
  });

  it('wraps tool calls in a stable JSON envelope', async () => {
    const capture = createCapture();
    const nextActions = [{ tool: 'flux_resource_read', arguments: { uri: 'flux://resource/demo' } }];

    const exitCode = await runCli(['tool', 'call', 'flux_demo', '--json'], {
      io: capture.io,
      toolRuntime: {
        listTools: async () => [],
        callTool: async () => ({
          isError: false,
          structuredContent: {
            count: 2,
            resourceUri: 'flux://resource/demo',
            nextActions,
          },
          content: [{ type: 'text', text: '{"count":2}' }],
        }),
      },
    });

    expect(exitCode).toBe(0);
    expect(capture.getStderr()).toBe('');

    const payload = JSON.parse(capture.getStdout()) as Record<string, unknown>;
    expect(payload.ok).toBe(true);
    expect(payload.status).toBe('ok');
    expect(payload.tool).toBe('flux_demo');
    expect(payload.resourceUri).toBe('flux://resource/demo');
    expect(payload.nextActions).toEqual(nextActions);

    const result = payload.result as Record<string, unknown>;
    expect(result.count).toBe(2);
  });

  it('falls back to parsed text when a tool omits structuredContent', async () => {
    const capture = createCapture();

    const exitCode = await runCli(['tool', 'call', 'flux_list_endpoint_categories', '--json'], {
      io: capture.io,
      toolRuntime: {
        listTools: async () => [],
        callTool: async () => ({
          isError: false,
          structuredContent: undefined,
          content: [
            {
              type: 'text',
              text: JSON.stringify({ routeCount: 2, categories: [{ category: 'apps', count: 2 }] }),
            },
          ],
        }),
      },
    });

    expect(exitCode).toBe(0);
    expect(capture.getStderr()).toBe('');

    const payload = JSON.parse(capture.getStdout()) as Record<string, unknown>;
    expect(payload.ok).toBe(true);
    expect(payload.status).toBe('ok');

    const result = payload.result as Record<string, unknown>;
    expect(result.routeCount).toBe(2);

    const categories = result.categories as Array<{ category: string; count: number }>;
    expect(categories).toEqual([{ category: 'apps', count: 2 }]);
  });
});
