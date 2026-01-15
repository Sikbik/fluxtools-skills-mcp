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
  if (typeof data === 'string') return data;
  if (data && typeof data === 'object' && !Array.isArray(data)) {
    const msg = (data as Record<string, unknown>).message;
    if (typeof msg === 'string') return msg;
  }

  if (typeof status === 'string') return status;
  return 'unknown error';
}
