const redactedValue = '<REDACTED>';

export function isSensitiveResourceKey(key) {
  const normalized = String(key ?? '').trim().toLowerCase();
  if (!normalized) return false;

  const exact = new Set([
    'zelidauth',
    'authorization',
    'cookie',
    'set-cookie',
    'signature',
    'loginphrase',
    'login_phrase',
    'privkey',
    'privatekey',
    'private_key',
    'mnemonic',
    'seed',
    'passphrase',
    'password',
  ]);

  return exact.has(normalized);
}

function sanitize(value, seen) {
  if (value === null || value === undefined) return value;
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return value;

  if (Array.isArray(value)) {
    const out = [];
    for (const item of value) out.push(sanitize(item, seen));
    return out;
  }

  if (typeof value === 'object') {
    if (seen.has(value)) return '[Circular]';
    seen.add(value);

    const out = {};
    for (const [key, nestedValue] of Object.entries(value)) {
      out[key] = isSensitiveResourceKey(key) ? redactedValue : sanitize(nestedValue, seen);
    }

    return out;
  }

  return String(value);
}

export function sanitizeForResource(value) {
  return sanitize(value, new WeakSet());
}

export { redactedValue };
