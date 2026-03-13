import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { sanitizeForResource } from '../../../shared-runtime/src/resources.js';
import { resolveCliResourceStorePath } from './paths.js';

export type ResourceDescriptor = {
  uri: string;
  name: string;
  description?: string;
  mimeType?: string;
};

export type StoredCliResource = ResourceDescriptor & {
  text: string;
  createdAtMs: number;
  expiresAtMs: number;
  sizeBytes: number;
};

type ResourceStoreFileShape = {
  version: 1;
  resources: StoredCliResource[];
};

export type ResourcePruneResult = {
  before: number;
  after: number;
  removedExpired: number;
  removedOverflow: number;
};

export type ResourceClearResult = {
  before: number;
  after: number;
  removed: number;
};

export type PersistedResourceContent = {
  uri: string;
  mimeType?: string;
  text: string;
};

const DEFAULT_TTL_MS = 10 * 60 * 1000;
const DEFAULT_MAX_ENTRIES = 200;

function nowMs(): number {
  return Date.now();
}

function resolveTtlMs(): number {
  const configured = Number(process.env.FLUXOS_CLI_RESOURCE_TTL_MS ?? DEFAULT_TTL_MS);
  return Number.isFinite(configured) && configured > 0 ? configured : DEFAULT_TTL_MS;
}

function resolveMaxEntries(): number {
  const configured = Number(process.env.FLUXOS_CLI_RESOURCE_MAX_ENTRIES ?? DEFAULT_MAX_ENTRIES);
  return Number.isFinite(configured) && configured > 0 ? Math.floor(configured) : DEFAULT_MAX_ENTRIES;
}

function isJsonMimeType(mimeType: string | undefined): boolean {
  if (!mimeType) return false;
  const normalized = mimeType.toLowerCase();
  return normalized === 'application/json' || normalized.endsWith('+json') || normalized.includes('/json');
}

function isExpired(resource: StoredCliResource, currentTime = nowMs()): boolean {
  return resource.expiresAtMs <= currentTime;
}

async function ensureParentDir(filePath: string) {
  await mkdir(path.dirname(filePath), { recursive: true, mode: 0o700 });
}

function parseStoredFile(raw: string): ResourceStoreFileShape {
  const parsed = JSON.parse(raw) as Partial<ResourceStoreFileShape> | null;
  if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.resources)) {
    return { version: 1, resources: [] };
  }

  const resources = parsed.resources.filter((entry): entry is StoredCliResource => {
    return (
      !!entry &&
      typeof entry === 'object' &&
      typeof entry.uri === 'string' &&
      typeof entry.name === 'string' &&
      typeof entry.text === 'string' &&
      typeof entry.createdAtMs === 'number' &&
      typeof entry.expiresAtMs === 'number' &&
      typeof entry.sizeBytes === 'number'
    );
  });

  return { version: 1, resources };
}

async function loadStoreFile(filePath: string): Promise<ResourceStoreFileShape> {
  try {
    return parseStoredFile(await readFile(filePath, 'utf8'));
  } catch (error) {
    const code = error instanceof Error && 'code' in error ? String((error as NodeJS.ErrnoException).code) : null;
    if (code === 'ENOENT') return { version: 1, resources: [] };
    throw error;
  }
}

async function saveStoreFile(filePath: string, store: ResourceStoreFileShape): Promise<void> {
  await ensureParentDir(filePath);
  await writeFile(filePath, JSON.stringify(store, null, 2), { encoding: 'utf8', mode: 0o600 });
}

async function loadPrunedStore(filePath: string): Promise<{ store: ResourceStoreFileShape; pruneResult: ResourcePruneResult }> {
  const store = await loadStoreFile(filePath);
  const { resources, result } = pruneResources(store.resources);

  if (
    result.removedExpired > 0 ||
    result.removedOverflow > 0 ||
    resources.length !== store.resources.length
  ) {
    const prunedStore = { version: 1 as const, resources };
    await saveStoreFile(filePath, prunedStore);
    return { store: prunedStore, pruneResult: result };
  }

  return { store, pruneResult: result };
}

function sanitizeTextForMimeType(text: string, mimeType?: string): string {
  if (isJsonMimeType(mimeType)) {
    try {
      const parsed = JSON.parse(text);
      return JSON.stringify(sanitizeForResource(parsed), null, 2);
    } catch {
      return text;
    }
  }

  return text;
}

function pruneResources(resources: StoredCliResource[]): { resources: StoredCliResource[]; result: ResourcePruneResult } {
  const before = resources.length;
  const currentTime = nowMs();
  let removedExpired = 0;
  const notExpired: StoredCliResource[] = [];

  for (const resource of resources) {
    if (resource.expiresAtMs <= currentTime) {
      removedExpired += 1;
      continue;
    }

    notExpired.push(resource);
  }

  const maxEntries = resolveMaxEntries();
  const ordered = [...notExpired].sort((left, right) => left.createdAtMs - right.createdAtMs);
  let removedOverflow = 0;
  while (ordered.length > maxEntries) {
    ordered.shift();
    removedOverflow += 1;
  }

  return {
    resources: ordered,
    result: {
      before,
      after: ordered.length,
      removedExpired,
      removedOverflow,
    },
  };
}

export async function persistCliResource(opts: {
  descriptor: ResourceDescriptor;
  contents: PersistedResourceContent;
}): Promise<void> {
  const filePath = resolveCliResourceStorePath();
  const store = await loadStoreFile(filePath);

  const createdAtMs = nowMs();
  const ttlMs = resolveTtlMs();
  const sanitizedText = sanitizeTextForMimeType(opts.contents.text, opts.contents.mimeType ?? opts.descriptor.mimeType);
  const resource: StoredCliResource = {
    uri: opts.descriptor.uri,
    name: opts.descriptor.name,
    description: opts.descriptor.description,
    mimeType: opts.contents.mimeType ?? opts.descriptor.mimeType,
    text: sanitizedText,
    createdAtMs,
    expiresAtMs: createdAtMs + ttlMs,
    sizeBytes: Buffer.byteLength(sanitizedText, 'utf8'),
  };

  const withoutPrevious = store.resources.filter((existing) => existing.uri !== resource.uri);
  const nextStore = [...withoutPrevious, resource];

  await saveStoreFile(filePath, { version: 1, resources: nextStore });
}

export async function listCliResources(): Promise<Array<ResourceDescriptor & { createdAtMs: number; expiresAtMs: number; sizeBytes: number }>> {
  const filePath = resolveCliResourceStorePath();
  const { store } = await loadPrunedStore(filePath);
  return [...store.resources]
    .sort((left, right) => right.createdAtMs - left.createdAtMs)
    .map((resource) => ({
      uri: resource.uri,
      name: resource.name,
      description: resource.description,
      mimeType: resource.mimeType,
      createdAtMs: resource.createdAtMs,
      expiresAtMs: resource.expiresAtMs,
      sizeBytes: resource.sizeBytes,
    }));
}

export async function readCliResource(uri: string): Promise<StoredCliResource | null> {
  const filePath = resolveCliResourceStorePath();
  const { store } = await loadPrunedStore(filePath);
  const found = store.resources.find((resource) => resource.uri === uri) ?? null;
  if (!found) return null;
  if (isExpired(found)) return null;
  return found;
}

export async function pruneCliResources(): Promise<ResourcePruneResult> {
  const filePath = resolveCliResourceStorePath();
  const store = await loadStoreFile(filePath);
  const { resources, result } = pruneResources(store.resources);
  await saveStoreFile(filePath, { version: 1, resources });
  return result;
}

export async function clearCliResources(): Promise<ResourceClearResult> {
  const filePath = resolveCliResourceStorePath();
  const store = await loadStoreFile(filePath);
  const before = store.resources.length;
  await saveStoreFile(filePath, { version: 1, resources: [] });
  return {
    before,
    after: 0,
    removed: before,
  };
}
