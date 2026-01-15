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

function nowMs(): number {
  return Date.now();
}

function makeId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

const redactedValue = '<REDACTED>';

function isSensitiveKey(key: string): boolean {
  const k = key.trim().toLowerCase();
  if (!k) return false;

  const exact = new Set([
    'zelidauth',
    'authorization',
    'cookie',
    'set-cookie',
    'signature',
    'loginphrase',
    'privkey',
    'privatekey',
    'mnemonic',
    'seed',
    'passphrase',
    'password',
  ]);

  return exact.has(k);
}

function sanitizeForResource(value: unknown, seen: WeakSet<object>): unknown {
  if (value === null || value === undefined) return value;
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return value;

  if (Array.isArray(value)) {
    const out: unknown[] = [];
    for (const item of value) out.push(sanitizeForResource(item, seen));
    return out;
  }

  if (typeof value === 'object') {
    if (seen.has(value)) return '[Circular]';
    seen.add(value);

    const obj = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};

    for (const [k, v] of Object.entries(obj)) {
      out[k] = isSensitiveKey(k) ? redactedValue : sanitizeForResource(v, seen);
    }

    return out;
  }

  return String(value);
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
    const sanitized = sanitizeForResource(opts.value, new WeakSet());
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
