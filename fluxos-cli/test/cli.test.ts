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
  it('prints help when no arguments are provided', () => {
    const capture = createCapture();

    const exitCode = runCli([], capture.io);

    expect(exitCode).toBe(0);
    expect(capture.getStdout()).toContain('Usage:');
    expect(capture.getStdout()).toContain('flux [command]');
    expect(capture.getStderr()).toBe('');
  });

  it('returns a validation-style exit code for unknown commands', () => {
    const capture = createCapture();

    const exitCode = runCli(['unknown-command'], capture.io);

    expect(exitCode).toBe(2);
    expect(capture.getStdout()).toBe('');
    expect(capture.getStderr()).toContain('Unknown command: unknown-command');
    expect(capture.getStderr()).toContain('Usage:');
  });
});
