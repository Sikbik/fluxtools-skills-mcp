const redactedValue = '<REDACTED>';
const assignmentRedactedValue = '<redacted>';

function normalizeSensitiveStringKey(key) {
  return String(key ?? '').trim().toLowerCase().replace(/[^a-z0-9]/g, '');
}

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
    'repotoken',
    'repo_token',
    'repoauth',
    'git_repo_url',
    'gitrepourl',
  ]);

  return exact.has(normalized);
}

function isSensitiveAssignmentKey(key) {
  const normalized = normalizeSensitiveStringKey(key);
  if (!normalized) return false;

  if (
    normalized === 'gitrepourl' ||
    normalized === 'repoauth' ||
    normalized === 'repotoken' ||
    normalized === 'loginphrase'
  ) {
    return true;
  }

  return (
    normalized.endsWith('token') ||
    normalized.endsWith('secret') ||
    normalized.includes('password') ||
    normalized.includes('passphrase') ||
    normalized.includes('privatekey') ||
    normalized.includes('privkey')
  );
}

function redactedValueForKey(key) {
  const normalized = normalizeSensitiveStringKey(key);
  if (normalized === 'repoauth') return assignmentRedactedValue;
  return redactedValue;
}

function redactCredentialedUrl(text) {
  try {
    const url = new URL(text.trim());
    if (!url.password) return null;
    url.password = assignmentRedactedValue;
    return url.toString();
  } catch {
    return null;
  }
}

function sanitizeString(value) {
  const assignmentIndex = value.indexOf('=');
  if (assignmentIndex > 0) {
    const key = value.slice(0, assignmentIndex);
    const rawValue = value.slice(assignmentIndex + 1);

    if (isSensitiveAssignmentKey(key)) {
      return `${key}=${assignmentRedactedValue}`;
    }

    const redactedAssignmentValue = redactCredentialedUrl(rawValue);
    if (redactedAssignmentValue) {
      return `${key}=${redactedAssignmentValue}`;
    }
  }

  return redactCredentialedUrl(value) ?? value;
}

function sanitize(value, seen) {
  if (value === null || value === undefined) return value;
  if (typeof value === 'string') return sanitizeString(value);
  if (typeof value === 'number' || typeof value === 'boolean') return value;

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
      out[key] = isSensitiveResourceKey(key) ? redactedValueForKey(key) : sanitize(nestedValue, seen);
    }

    return out;
  }

  return String(value);
}

export function sanitizeForResource(value) {
  return sanitize(value, new WeakSet());
}

export { redactedValue };
