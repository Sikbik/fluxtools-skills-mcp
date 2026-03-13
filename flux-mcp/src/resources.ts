import { sanitizeForResource } from '../../shared-runtime/src/resources.js';

type StoredResource = {
  uri: string;
  name: string;
  description?: string;
  mimeType?: string;
  text: string;
  createdAtMs: number;
  expiresAtMs: number;
};

export type ResourceDescriptor = {
  uri: string;
  name: string;
  description?: string;
  mimeType?: string;
};

export type HydratedResource = ResourceDescriptor & {
  text: string;
  createdAtMs?: number;
  expiresAtMs?: number;
};

function nowMs(): number {
  return Date.now();
}

function makeId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

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

export class ResourceStore {
  private resources = new Map<string, StoredResource>();
  private maxEntries: number;
  private ttlMs: number;

  constructor(opts?: { ttlMs?: number; maxEntries?: number }) {
    this.ttlMs = Number(opts?.ttlMs ?? 10 * 60 * 1000);
    this.maxEntries = Number(opts?.maxEntries ?? 200);
  }

  private prune(): ResourcePruneResult {
    const before = this.resources.size;

    const t = nowMs();
    let removedExpired = 0;
    for (const [uri, r] of this.resources.entries()) {
      if (r.expiresAtMs <= t) {
        this.resources.delete(uri);
        removedExpired += 1;
      }
    }

    let removedOverflow = 0;
    if (this.resources.size > this.maxEntries) {
      const ordered = Array.from(this.resources.values()).sort((a, b) => a.createdAtMs - b.createdAtMs);
      const overflow = this.resources.size - this.maxEntries;
      for (let i = 0; i < overflow; i++) {
        this.resources.delete(ordered[i].uri);
        removedOverflow += 1;
      }
    }

    return {
      before,
      after: this.resources.size,
      removedExpired,
      removedOverflow,
    };
  }

  pruneNow(): ResourcePruneResult {
    return this.prune();
  }

  clearAll(): ResourceClearResult {
    const before = this.resources.size;
    this.resources.clear();
    return { before, after: 0, removed: before };
  }

  hydrate(resource: HydratedResource): ResourceDescriptor {
    this.prune();

    const createdAtMs = Number.isFinite(resource.createdAtMs) ? Number(resource.createdAtMs) : nowMs();
    const fallbackExpiresAtMs = createdAtMs + this.ttlMs;
    const expiresAtMs =
      Number.isFinite(resource.expiresAtMs) && Number(resource.expiresAtMs) > createdAtMs
        ? Number(resource.expiresAtMs)
        : fallbackExpiresAtMs;

    this.resources.set(resource.uri, {
      uri: resource.uri,
      name: resource.name,
      description: resource.description,
      mimeType: resource.mimeType,
      text: resource.text,
      createdAtMs,
      expiresAtMs,
    });

    this.prune();
    return {
      uri: resource.uri,
      name: resource.name,
      description: resource.description,
      mimeType: resource.mimeType,
    };
  }

  size(): number {
    return this.resources.size;
  }

  putText(opts: {
    kind: string;
    text: string;
    name: string;
    description?: string;
    mimeType?: string;
    ttlMs?: number;
  }): ResourceDescriptor {
    this.prune();

    const id = makeId();
    const uri = `flux://resource/${encodeURIComponent(opts.kind)}/${id}`;
    const createdAtMs = nowMs();
    const ttlMs = Number(opts.ttlMs ?? this.ttlMs);
    const expiresAtMs = createdAtMs + (Number.isFinite(ttlMs) && ttlMs > 0 ? ttlMs : this.ttlMs);

    this.resources.set(uri, {
      uri,
      name: opts.name,
      description: opts.description,
      mimeType: opts.mimeType,
      text: opts.text,
      createdAtMs,
      expiresAtMs,
    });

    return { uri, name: opts.name, description: opts.description, mimeType: opts.mimeType };
  }

  putJson(opts: {
    kind: string;
    value: unknown;
    name: string;
    description?: string;
    ttlMs?: number;
  }): ResourceDescriptor {
    const sanitized = sanitizeForResource(opts.value);
    return this.putText({
      kind: opts.kind,
      name: opts.name,
      description: opts.description,
      mimeType: 'application/json',
      ttlMs: opts.ttlMs,
      text: JSON.stringify(sanitized, null, 2),
    });
  }

  list(): ResourceDescriptor[] {
    this.prune();
    return Array.from(this.resources.values()).map((r) => ({
      uri: r.uri,
      name: r.name,
      description: r.description,
      mimeType: r.mimeType,
    }));
  }

  read(uri: string): { uri: string; mimeType?: string; text: string } | null {
    this.prune();
    const r = this.resources.get(uri);
    if (!r) return null;
    return { uri: r.uri, mimeType: r.mimeType, text: r.text };
  }
}
