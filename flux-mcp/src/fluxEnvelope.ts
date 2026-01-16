export type FluxEnvelope<T = unknown> =
  | { status: 'success'; data: T }
  | { status: 'error'; data: unknown }
  | { status: string; data: unknown };

export function unwrapFluxEnvelope<T = unknown>(value: unknown): T {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const obj = value as Record<string, unknown>;
    if ('status' in obj && 'data' in obj) return obj.data as T;
  }
  return value as T;
}

export function isFluxSuccess(value: unknown): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return true;
  const obj = value as Record<string, unknown>;
  const status = obj.status;
  if (typeof status !== 'string') return true;
  return status.toLowerCase() === 'success';
}

export function extractFluxErrorMessage(value: unknown): string | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const obj = value as Record<string, unknown>;
  const status = obj.status;
  if (typeof status === 'string' && status.toLowerCase() === 'success') return null;

  const data = obj.data;
  if (typeof data === 'string') return normalizeFluxErrorMessage(data);
  if (data && typeof data === 'object' && !Array.isArray(data)) {
    const msg = (data as Record<string, unknown>).message;
    if (typeof msg === 'string') return normalizeFluxErrorMessage(msg);
  }

  if (typeof status === 'string') return normalizeFluxErrorMessage(status);
  return 'unknown error';
}

function normalizeFluxErrorMessage(message: string): string {
  const m = message.trim();
  if (m.includes("Cannot read properties of undefined") && m.includes("reading 'Id'")) {
    return "Container not found on this node. Likely wrong node/port or you passed a global app name instead of the container name. MCP observability tools (logs/stats/inspect/top) will auto-resolve via /apps/location + /apps/listrunningapps when possible.";
  }
  return message;
}
