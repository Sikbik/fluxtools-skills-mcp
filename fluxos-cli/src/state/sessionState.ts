import { chmod, mkdir, readFile, writeFile } from 'node:fs/promises';

import { resolveCliResourceStorePath, resolveCliStateDir, resolveCliStateStorePath } from './paths.js';

export type AuthSummary = {
  present: boolean;
  zelid?: string;
};

export type EnterpriseKeySummary = {
  present: boolean;
};

export type PersistedHttpDefaults = {
  timeoutMs: number;
  retryCount: number;
  retryBackoffMs: number;
};

export type PersistedProfileState = {
  baseUrl: string | null;
  zelidauth: string | null;
  enterpriseKey: string | null;
  fluxDriveMwsBaseUrl: string;
  httpDefaults: PersistedHttpDefaults;
};

type StateFileProfileState = {
  baseUrl?: unknown;
  zelidauth?: unknown;
  enterpriseKey?: unknown;
  fluxDriveMwsBaseUrl?: unknown;
  httpDefaults?: unknown;
};

type StateFileShape = {
  version: 1;
  activeProfile: string;
  profiles: Record<string, StateFileProfileState>;
};

export type PersistedStateSnapshot = {
  activeProfile: string;
  profile: PersistedProfileState;
};

export type PersistedProfileSummary = {
  name: string;
  active: boolean;
  baseUrl: string | null;
  auth: AuthSummary;
  enterpriseKey: EnterpriseKeySummary;
  fluxDriveMwsBaseUrl: string;
  httpDefaults: PersistedHttpDefaults;
};

export type PersistedProfilesSummary = {
  activeProfile: string;
  profiles: PersistedProfileSummary[];
};

export type StateVisibilitySummary = {
  activeProfile: string;
  baseUrl: string | null;
  auth: AuthSummary;
  enterpriseKey: EnterpriseKeySummary;
  fluxDriveMwsBaseUrl: string;
  httpDefaults: PersistedHttpDefaults;
  paths: {
    stateDir: string;
    stateFile: string;
    resourceStoreFile: string;
  };
};

const STATE_FILE_VERSION = 1;
const DEFAULT_ACTIVE_PROFILE = 'default';
const DEFAULT_FLUX_API_BASE_URL = 'https://api.runonflux.io';
const DEFAULT_HTTP_DEFAULTS: PersistedHttpDefaults = {
  timeoutMs: 30000,
  retryCount: 2,
  retryBackoffMs: 500,
};
const DEFAULT_FLUXDRIVE_BASE_URL = 'https://mws.fluxdrive.runonflux.io';

function normalizeBaseUrl(url: string): string {
  const parsed = new URL(url);
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('Base URL must start with http:// or https://');
  }

  return url.replace(/\/+$/, '');
}

function defaultProfileState(): PersistedProfileState {
  const configuredBaseUrl = process.env.FLUX_API_BASE_URL?.trim();
  const effectiveBaseUrl = configuredBaseUrl ? normalizeBaseUrl(configuredBaseUrl) : DEFAULT_FLUX_API_BASE_URL;

  return {
    baseUrl: effectiveBaseUrl,
    zelidauth: null,
    enterpriseKey: null,
    fluxDriveMwsBaseUrl: DEFAULT_FLUXDRIVE_BASE_URL,
    httpDefaults: { ...DEFAULT_HTTP_DEFAULTS },
  };
}

function normalizeProfileName(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) {
    throw new Error('Profile name must not be empty.');
  }

  return trimmed;
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function asNonEmptyString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function asPersistedHttpDefaults(value: unknown): PersistedHttpDefaults {
  const record = asRecord(value);

  const timeoutMs = Number(record.timeoutMs);
  const retryCount = Number(record.retryCount);
  const retryBackoffMs = Number(record.retryBackoffMs);

  return {
    timeoutMs: Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : DEFAULT_HTTP_DEFAULTS.timeoutMs,
    retryCount: Number.isFinite(retryCount) && retryCount >= 0 && Number.isInteger(retryCount)
      ? retryCount
      : DEFAULT_HTTP_DEFAULTS.retryCount,
    retryBackoffMs: Number.isFinite(retryBackoffMs) && retryBackoffMs >= 0
      ? retryBackoffMs
      : DEFAULT_HTTP_DEFAULTS.retryBackoffMs,
  };
}

function asPersistedProfileState(value: unknown): PersistedProfileState {
  const defaults = defaultProfileState();
  const record = asRecord(value);
  const baseUrl = asNonEmptyString(record.baseUrl);
  const zelidauth = asNonEmptyString(record.zelidauth);
  const enterpriseKey = asNonEmptyString(record.enterpriseKey);
  const fluxDriveMwsBaseUrl = asNonEmptyString(record.fluxDriveMwsBaseUrl);

  return {
    baseUrl: baseUrl ? normalizeBaseUrl(baseUrl) : defaults.baseUrl,
    zelidauth,
    enterpriseKey,
    fluxDriveMwsBaseUrl: fluxDriveMwsBaseUrl ? normalizeBaseUrl(fluxDriveMwsBaseUrl) : defaults.fluxDriveMwsBaseUrl,
    httpDefaults: asPersistedHttpDefaults(record.httpDefaults),
  };
}

function parseStateFile(raw: string): StateFileShape {
  const parsed = JSON.parse(raw) as Partial<StateFileShape> | null;
  const activeProfile = asNonEmptyString(parsed?.activeProfile) ?? DEFAULT_ACTIVE_PROFILE;
  const rawProfiles = parsed?.profiles && typeof parsed.profiles === 'object' && !Array.isArray(parsed.profiles)
    ? parsed.profiles
    : {};

  const profiles: Record<string, StateFileProfileState> = {};

  for (const [profileName, profileState] of Object.entries(rawProfiles)) {
    const trimmed = profileName.trim();
    if (!trimmed) continue;
    profiles[trimmed] = asRecord(profileState);
  }

  return {
    version: STATE_FILE_VERSION,
    activeProfile,
    profiles,
  };
}

async function ensureDir(pathname: string) {
  await mkdir(pathname, { recursive: true, mode: 0o700 });
  await chmod(pathname, 0o700).catch(() => undefined);
}

async function loadStateFile(): Promise<StateFileShape> {
  const filePath = resolveCliStateStorePath();

  try {
    return parseStateFile(await readFile(filePath, 'utf8'));
  } catch (error) {
    const code = error instanceof Error && 'code' in error ? String((error as NodeJS.ErrnoException).code) : null;
    if (code === 'ENOENT') {
      return {
        version: STATE_FILE_VERSION,
        activeProfile: DEFAULT_ACTIVE_PROFILE,
        profiles: {},
      };
    }

    throw error;
  }
}

async function saveStateFile(store: StateFileShape): Promise<void> {
  const stateDir = resolveCliStateDir();
  const stateFilePath = resolveCliStateStorePath();

  await ensureDir(stateDir);
  await writeFile(stateFilePath, JSON.stringify(store, null, 2), { encoding: 'utf8', mode: 0o600 });
  await chmod(stateFilePath, 0o600).catch(() => undefined);
}

function getProfileState(store: StateFileShape, profileName = store.activeProfile): PersistedProfileState {
  return asPersistedProfileState(store.profiles[profileName]);
}

function collectProfileNames(store: StateFileShape): string[] {
  return Array.from(new Set([DEFAULT_ACTIVE_PROFILE, store.activeProfile, ...Object.keys(store.profiles)]))
    .map((name) => name.trim())
    .filter((name) => name.length > 0)
    .sort((left, right) => left.localeCompare(right));
}

function hasProfile(store: StateFileShape, profileName: string): boolean {
  return collectProfileNames(store).includes(profileName);
}

function summarizeProfile(store: StateFileShape, profileName: string): PersistedProfileSummary {
  const profile = getProfileState(store, profileName);

  return {
    name: profileName,
    active: store.activeProfile === profileName,
    baseUrl: profile.baseUrl,
    auth: summarizeAuth(profile.zelidauth),
    enterpriseKey: { present: Boolean(profile.enterpriseKey) },
    fluxDriveMwsBaseUrl: profile.fluxDriveMwsBaseUrl,
    httpDefaults: { ...profile.httpDefaults },
  };
}

function summarizeAuth(zelidauth: string | null): AuthSummary {
  if (!zelidauth) return { present: false };

  try {
    const parsed = JSON.parse(zelidauth) as unknown;
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      const zelid = asRecord(parsed).zelid;
      if (typeof zelid === 'string' && zelid.trim()) return { present: true, zelid: zelid.trim() };
    }
  } catch {
    // Non-JSON auth values are still considered present.
  }

  return { present: true };
}

export function defaultPersistedProfileState(): PersistedProfileState {
  return defaultProfileState();
}

export async function loadPersistedStateSnapshot(): Promise<PersistedStateSnapshot> {
  const store = await loadStateFile();
  return {
    activeProfile: store.activeProfile,
    profile: getProfileState(store),
  };
}

export async function listPersistedProfiles(): Promise<PersistedProfilesSummary> {
  const store = await loadStateFile();

  return {
    activeProfile: store.activeProfile,
    profiles: collectProfileNames(store).map((profileName) => summarizeProfile(store, profileName)),
  };
}

export async function createPersistedProfile(profileName: string): Promise<{ activeProfile: string; profile: PersistedProfileSummary }> {
  const normalizedName = normalizeProfileName(profileName);
  const store = await loadStateFile();

  if (hasProfile(store, normalizedName)) {
    throw new Error(`Profile already exists: ${normalizedName}`);
  }

  store.profiles[normalizedName] = defaultProfileState();
  await saveStateFile(store);

  return {
    activeProfile: store.activeProfile,
    profile: summarizeProfile(store, normalizedName),
  };
}

export async function usePersistedProfile(profileName: string): Promise<{ activeProfile: string; profile: PersistedProfileSummary }> {
  const normalizedName = normalizeProfileName(profileName);
  const store = await loadStateFile();

  if (!hasProfile(store, normalizedName)) {
    throw new Error(`Profile not found: ${normalizedName}`);
  }

  store.activeProfile = normalizedName;
  if (normalizedName !== DEFAULT_ACTIVE_PROFILE && !(normalizedName in store.profiles)) {
    store.profiles[normalizedName] = defaultProfileState();
  }

  await saveStateFile(store);

  return {
    activeProfile: store.activeProfile,
    profile: summarizeProfile(store, normalizedName),
  };
}

export async function deletePersistedProfile(
  profileName: string
): Promise<{ activeProfile: string; deletedProfile: string; deletedWasActive: boolean }> {
  const normalizedName = normalizeProfileName(profileName);
  const store = await loadStateFile();

  if (normalizedName === DEFAULT_ACTIVE_PROFILE) {
    throw new Error('Cannot delete the default profile.');
  }

  if (!hasProfile(store, normalizedName)) {
    throw new Error(`Profile not found: ${normalizedName}`);
  }

  const deletedWasActive = store.activeProfile === normalizedName;
  delete store.profiles[normalizedName];

  if (deletedWasActive) {
    store.activeProfile = DEFAULT_ACTIVE_PROFILE;
  }

  await saveStateFile(store);

  return {
    activeProfile: store.activeProfile,
    deletedProfile: normalizedName,
    deletedWasActive,
  };
}

export async function updatePersistedProfileState(
  update: (current: PersistedProfileState, context: { activeProfile: string }) => PersistedProfileState
): Promise<PersistedStateSnapshot> {
  const store = await loadStateFile();
  const activeProfile = store.activeProfile || DEFAULT_ACTIVE_PROFILE;
  const nextProfileState = update(getProfileState(store, activeProfile), { activeProfile });

  store.activeProfile = activeProfile;
  store.profiles[activeProfile] = nextProfileState;

  await saveStateFile(store);

  return {
    activeProfile,
    profile: nextProfileState,
  };
}

export async function clearPersistedProfileState(): Promise<PersistedStateSnapshot> {
  return updatePersistedProfileState(() => defaultProfileState());
}

export async function clearPersistedAuthState(): Promise<PersistedStateSnapshot> {
  return updatePersistedProfileState((current) => ({
    ...current,
    zelidauth: null,
  }));
}

export async function clearPersistedEnterpriseKeyState(): Promise<PersistedStateSnapshot> {
  return updatePersistedProfileState((current) => ({
    ...current,
    enterpriseKey: null,
  }));
}

export async function getStateVisibilitySummary(): Promise<StateVisibilitySummary> {
  const snapshot = await loadPersistedStateSnapshot();

  return {
    activeProfile: snapshot.activeProfile,
    baseUrl: snapshot.profile.baseUrl,
    auth: summarizeAuth(snapshot.profile.zelidauth),
    enterpriseKey: { present: Boolean(snapshot.profile.enterpriseKey) },
    fluxDriveMwsBaseUrl: snapshot.profile.fluxDriveMwsBaseUrl,
    httpDefaults: { ...snapshot.profile.httpDefaults },
    paths: {
      stateDir: resolveCliStateDir(),
      stateFile: resolveCliStateStorePath(),
      resourceStoreFile: resolveCliResourceStorePath(),
    },
  };
}

export function summarizePersistedAuth(zelidauth: string | null): AuthSummary {
  return summarizeAuth(zelidauth);
}
