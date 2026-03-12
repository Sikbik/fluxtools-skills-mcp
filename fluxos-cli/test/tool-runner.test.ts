import { describe, expect, it } from 'vitest';

import { callTool, tools } from '../../flux-mcp/dist/index.js';
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

describe('tool runner integration', () => {
  it('lists the callable tool catalog in JSON mode', async () => {
    const capture = createCapture();

    const exitCode = await runCli(['tool', 'list', '--json'], { io: capture.io });

    expect(exitCode).toBe(0);
    expect(capture.getStderr()).toBe('');

    const payload = JSON.parse(capture.getStdout()) as Record<string, unknown>;
    expect(payload.ok).toBe(true);
    expect(payload.status).toBe('ok');
    expect(payload.count).toBe(tools.length);

    const listedTools = payload.tools as Array<{ name: string }>;
    expect(listedTools.some((tool) => tool.name === 'flux_get_state')).toBe(true);
    expect(listedTools.some((tool) => tool.name === 'flux_maintenance_checklist')).toBe(true);
  });

  it('renders a readable tool catalog in pretty mode', async () => {
    const capture = createCapture();

    const exitCode = await runCli(['tool', 'list', '--pretty'], { io: capture.io });

    expect(exitCode).toBe(0);
    expect(capture.getStderr()).toBe('');
    expect(capture.getStdout()).toContain('Flux tool catalog');
    expect(capture.getStdout()).toContain('flux_get_state');
    expect(capture.getStdout()).toContain('flux_maintenance_checklist');
  });

  it('wraps a tool that maps to a future first-class command in the stable envelope', async () => {
    const capture = createCapture();

    const exitCode = await runCli(['tool', 'call', 'flux_get_state', '--json'], { io: capture.io });

    expect(exitCode).toBe(0);
    expect(capture.getStderr()).toBe('');

    const payload = JSON.parse(capture.getStdout()) as Record<string, unknown>;
    const direct = await callTool('flux_get_state', {});

    expect(payload.ok).toBe(true);
    expect(payload.status).toBe('ok');
    expect(payload.tool).toBe('flux_get_state');
    expect(payload.result).toEqual(direct.structuredContent);
  });

  it('preserves nextActions for a generic-only tool call', async () => {
    const capture = createCapture();

    const exitCode = await runCli(['tool', 'call', 'flux_maintenance_checklist', '--json'], { io: capture.io });

    expect(exitCode).toBe(0);
    expect(capture.getStderr()).toBe('');

    const payload = JSON.parse(capture.getStdout()) as Record<string, unknown>;
    const direct = await callTool('flux_maintenance_checklist', {});
    const directStructured = direct.structuredContent as Record<string, unknown>;

    expect(payload.ok).toBe(true);
    expect(payload.status).toBe('ok');
    expect(payload.tool).toBe('flux_maintenance_checklist');
    expect(payload.result).toEqual(directStructured);
    expect(payload.nextActions).toEqual(directStructured.nextActions);
  });
});
