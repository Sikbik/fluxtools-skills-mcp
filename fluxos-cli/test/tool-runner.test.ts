import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { callTool, tools } from 'flux-mcp';
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
  const stateDir = await mkdtemp(join(tmpdir(), 'fluxos-cli-tool-runner-'));
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
    await withTempStateDir(async () => {
      const genericCapture = createCapture();
      const firstClassCapture = createCapture();

      const genericExitCode = await runCli(['tool', 'call', 'flux_resource_prune', '--json'], { io: genericCapture.io });
      const firstClassExitCode = await runCli(['resource', 'prune', '--json'], { io: firstClassCapture.io });

      expect(genericExitCode).toBe(0);
      expect(firstClassExitCode).toBe(0);
      expect(genericCapture.getStderr()).toBe('');
      expect(firstClassCapture.getStderr()).toBe('');

      const genericPayload = JSON.parse(genericCapture.getStdout()) as Record<string, unknown>;
      const firstClassPayload = JSON.parse(firstClassCapture.getStdout()) as Record<string, unknown>;
      const firstClassComparable = { ...firstClassPayload };
      delete (firstClassComparable as { status?: unknown }).status;

      expect(genericPayload.ok).toBe(true);
      expect(genericPayload.status).toBe('ok');
      expect(genericPayload.tool).toBe('flux_resource_prune');
      expect(genericPayload.result).toEqual(firstClassComparable);
    });
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
