import os from 'node:os';
import path from 'node:path';

export function resolveCliStateDir(): string {
  const override = process.env.FLUXOS_CLI_STATE_DIR?.trim();
  if (override) return path.resolve(override);

  const xdgStateHome = process.env.XDG_STATE_HOME?.trim();
  if (xdgStateHome) return path.resolve(xdgStateHome, 'fluxos-cli');

  const homeDir = process.env.HOME?.trim() || os.homedir();
  if (homeDir) return path.resolve(homeDir, '.local', 'state', 'fluxos-cli');

  return path.resolve(process.cwd(), '.fluxos-cli-state');
}

export function resolveCliResourceStorePath(): string {
  return path.join(resolveCliStateDir(), 'resources.json');
}

export function resolveCliStateStorePath(): string {
  return path.join(resolveCliStateDir(), 'state.json');
}
