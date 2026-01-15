function normalizeBaseUrl(url: string): string {
  const parsed = new URL(url);
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('Base URL must start with http:// or https://');
  }
  return url.replace(/\/+$/, '');
}

function toQueryString(query: Record<string, unknown>): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null) continue;
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
      params.set(key, String(value));
      continue;
    }
    params.set(key, JSON.stringify(value));
  }
  const s = params.toString();
  return s ? `?${s}` : '';
}

function tryParseJson(text: string): unknown {
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function isMutatingGetPath(pathname: string): boolean {
  const path = pathname.startsWith('/') ? pathname : `/${pathname}`;

  const mutatingPrefixes = [
    // Apps lifecycle / orchestration
    '/apps/appstart',
    '/apps/appstop',
    '/apps/apprestart',
    '/apps/apppause',
    '/apps/appunpause',
    '/apps/appremove',
    '/apps/installapplocally',
    '/apps/testappinstall',
    '/apps/createfluxnetwork',
    '/apps/redeploy',
    '/apps/redeploycomponent',
    '/apps/startmonitoring',
    '/apps/stopmonitoring',

    // Volume browser (filesystem mutations)
    '/apps/createfolder',
    '/apps/renameobject',
    '/apps/removeobject',

    // FluxShare (filesystem mutations)
    '/apps/fluxshare/createfolder',
    '/apps/fluxshare/uploadfile',
    '/apps/fluxshare/removefile',
    '/apps/fluxshare/removefolder',
    '/apps/fluxshare/sharefile',
    '/apps/fluxshare/unsharefile',
    '/apps/fluxshare/rename',

    // Backups
    '/backup/removebackupfile',

    // Explorer index controls
    '/explorer/reindex',
    '/explorer/restart',
    '/explorer/stop',
    '/explorer/rescan',

    // Flux maintenance / updates
    '/flux/restart',
    '/flux/reindexdaemon',
    '/flux/startbenchmark',
    '/flux/restartbenchmark',
    '/flux/startdaemon',
    '/flux/restartdaemon',
    '/flux/entermaster',
    '/flux/enterdevelopment',
    '/flux/updateflux',
    '/flux/softupdateflux',
    '/flux/softupdatefluxinstall',
    '/flux/hardupdateflux',
    '/flux/rebuildhome',
    '/flux/updatedaemon',
    '/flux/updatebenchmark',
    '/flux/adjustkadena',
    '/flux/adjustrouterip',
    '/flux/adjustblockedports',
    '/flux/adjustapiport',
    '/flux/adjustblockedrepositories',

    // Syncthing controls
    '/syncthing/system/error/clear',
    '/syncthing/system/pause',
    '/syncthing/system/reset',
    '/syncthing/system/restart',
    '/syncthing/system/resume',
    '/syncthing/system/shutdown',
    '/syncthing/system/upgrade',
  ];

  return mutatingPrefixes.some((prefix) => path === prefix || path.startsWith(`${prefix}/`));
}

function isNonMutatingPostPath(method: string, pathname: string): boolean {
  if (method !== 'POST') return false;
  const path = pathname.startsWith('/') ? pathname : `/${pathname}`;

  const allowed = ['/id/verifylogin', '/id/checkprivilege'];
  return allowed.includes(path);
}

export type ZelidauthValue = string;
export type FluxResponseType = 'auto' | 'text' | 'base64';

export type FluxHttpDefaults = {
  timeoutMs: number;
  retryCount: number;
  retryBackoffMs: number;
};

export class FluxClient {
  private baseUrl: string | null;
  private zelidauth: ZelidauthValue | null;
  private httpDefaults: FluxHttpDefaults;

  constructor(opts?: { baseUrl?: string; zelidauth?: unknown }) {
    this.baseUrl = opts?.baseUrl ? normalizeBaseUrl(opts.baseUrl) : null;
    this.zelidauth = null;

    const timeoutMs = Number(process.env.FLUX_HTTP_TIMEOUT_MS ?? '30000');
    this.httpDefaults = {
      timeoutMs: Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : 30000,
      retryCount: 0,
      retryBackoffMs: 250,
    };

    if (opts?.zelidauth !== undefined) this.setZelidauth(opts.zelidauth);
  }

  setBaseUrl(url: string) {
    this.baseUrl = normalizeBaseUrl(url);
  }

  getBaseUrl(): string | null {
    return this.baseUrl;
  }

  setHttpDefaults(value: Partial<FluxHttpDefaults>) {
    const next: FluxHttpDefaults = { ...this.httpDefaults };

    if (value.timeoutMs !== undefined) {
      const v = Number(value.timeoutMs);
      if (!Number.isFinite(v) || v <= 0) throw new Error('timeoutMs must be a positive number');
      next.timeoutMs = v;
    }

    if (value.retryCount !== undefined) {
      const v = Number(value.retryCount);
      if (!Number.isFinite(v) || v < 0 || !Number.isInteger(v)) {
        throw new Error('retryCount must be a non-negative integer');
      }
      next.retryCount = v;
    }

    if (value.retryBackoffMs !== undefined) {
      const v = Number(value.retryBackoffMs);
      if (!Number.isFinite(v) || v < 0) throw new Error('retryBackoffMs must be a non-negative number');
      next.retryBackoffMs = v;
    }

    this.httpDefaults = next;
  }

  getHttpDefaults(): FluxHttpDefaults {
    return { ...this.httpDefaults };
  }

  clearZelidauth() {
    this.zelidauth = null;
  }

  getZelidauthValue(): string | null {
    return this.zelidauth;
  }

  setZelidauth(value: unknown) {
    if (typeof value === 'string' && value.trim()) {
      this.zelidauth = value;
      return;
    }
    if (value && typeof value === 'object') {
      this.zelidauth = JSON.stringify(value);
      return;
    }
    throw new Error('zelidauth must be a non-empty string or an object');
  }

  getZelidauthSummary(): { present: boolean; zelid?: string } {
    if (!this.zelidauth) return { present: false };
    try {
      const parsed: unknown = JSON.parse(this.zelidauth);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        const obj = parsed as Record<string, unknown>;
        const zelid = obj.zelid;
        if (typeof zelid === 'string') return { present: true, zelid };
      }
    } catch {
      // ignore
    }
    return { present: true };
  }

  async request(
    pathname: string,
    opts?: {
      method?: string;
      query?: Record<string, unknown>;
      body?: unknown;
      bodyType?: 'json' | 'form';
      zelidauth?: unknown;
      useStoredZelidauth?: boolean;
      timeoutMs?: number;
      allowMutation?: boolean;
      responseType?: FluxResponseType;
      maxBytes?: number;
    }
  ) {
    if (!this.baseUrl) throw new Error('Base URL not set. Use flux_set_base_url first.');

    const method = (opts?.method ?? (opts?.body === undefined ? 'GET' : 'POST')).toUpperCase();
    const allowMutation = opts?.allowMutation === true;

    const isMutating =
      (method === 'GET' && isMutatingGetPath(pathname)) ||
      (method !== 'GET' && !isNonMutatingPostPath(method, pathname));

    if (isMutating && !allowMutation) {
      throw new Error(
        `Refusing mutating request without allowMutation=true. If you are calling flux_request, retry with { allowMutation: true }.`
      );
    }

    const query = opts?.query ?? {};
    const queryString = query && Object.keys(query).length ? toQueryString(query) : '';

    const base = this.baseUrl.replace(/\/+$/, '');
    const path = pathname.startsWith('/') ? pathname : `/${pathname}`;
    const url = `${base}${path}${queryString}`;

    const headers: Record<string, string> = {
      accept: 'application/json',
    };

    const useStoredZelidauth = opts?.useStoredZelidauth !== false;

    if (opts?.zelidauth !== undefined) {
      if (typeof opts.zelidauth === 'string' && opts.zelidauth.trim()) headers.zelidauth = opts.zelidauth;
      else if (opts.zelidauth && typeof opts.zelidauth === 'object') headers.zelidauth = JSON.stringify(opts.zelidauth);
      else throw new Error('zelidauth override must be a non-empty string or object');
    } else if (useStoredZelidauth && this.zelidauth) {
      headers.zelidauth = this.zelidauth;
    }

    const bodyType = opts?.bodyType ?? 'json';

    let body: string | undefined;

    if (opts?.body !== undefined) {
      if (bodyType === 'json') {
        body = JSON.stringify(opts.body);
        headers['content-type'] = 'application/json';
      } else if (bodyType === 'form') {
        if (!opts.body || typeof opts.body !== 'object' || Array.isArray(opts.body)) {
          throw new Error("Form bodyType requires a plain object body");
        }

        const params = new URLSearchParams();
        for (const [key, value] of Object.entries(opts.body as Record<string, unknown>)) {
          if (value === undefined || value === null) continue;
          params.set(key, String(value));
        }

        body = params.toString();
        headers['content-type'] = 'application/x-www-form-urlencoded';
      } else {
        throw new Error(`Unsupported bodyType: ${String(bodyType)}`);
      }
    }

    const timeoutMsRaw = opts?.timeoutMs ?? this.httpDefaults.timeoutMs;
    const timeoutMs = Number(timeoutMsRaw);
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
      throw new Error('timeoutMs must be a positive number');
    }

    const canRetry = !isMutating && (method === 'GET' || isNonMutatingPostPath(method, pathname));
    const maxAttempts = 1 + (canRetry ? this.httpDefaults.retryCount : 0);

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), timeoutMs);

      try {
        const res = await fetch(url, { method, headers, body, signal: controller.signal });

        if (canRetry && attempt < maxAttempts && (res.status === 502 || res.status === 503 || res.status === 504)) {
          const backoff = this.httpDefaults.retryBackoffMs * attempt;
          await new Promise((resolve) => setTimeout(resolve, backoff));
          continue;
        }

      const outHeaders: Record<string, string> = {};
      for (const [k, v] of res.headers.entries()) outHeaders[k.toLowerCase()] = v;

      const responseType: FluxResponseType = opts?.responseType ?? 'auto';

      if (responseType === 'base64') {
        const maxBytes = Number(opts?.maxBytes ?? 1024 * 1024);
        if (!Number.isFinite(maxBytes) || maxBytes <= 0) {
          throw new Error('maxBytes must be a positive number');
        }

        const contentLengthHeader = res.headers.get('content-length');
        if (contentLengthHeader) {
          const contentLength = Number(contentLengthHeader);
          if (Number.isFinite(contentLength) && contentLength > maxBytes) {
            throw new Error(`Response too large (${contentLength} bytes) for maxBytes=${maxBytes}`);
          }
        }

        const buffer = Buffer.from(await res.arrayBuffer());
        if (buffer.length > maxBytes) {
          throw new Error(`Response too large (${buffer.length} bytes) for maxBytes=${maxBytes}`);
        }

        const contentType = res.headers.get('content-type') ?? undefined;
        const contentDisposition = res.headers.get('content-disposition') ?? undefined;

        return {
          url,
          status: res.status,
          ok: res.ok,
          headers: outHeaders,
          data: {
            base64: buffer.toString('base64'),
            bytes: buffer.length,
            contentType,
            contentDisposition,
          },
        };
      }

      const text = await res.text();

      if (responseType === 'text') {
        return { url, status: res.status, ok: res.ok, headers: outHeaders, data: text };
      }

      const data = tryParseJson(text);
      return { url, status: res.status, ok: res.ok, headers: outHeaders, data };
      } catch (err: unknown) {
        clearTimeout(timeout);

        if (!canRetry || attempt >= maxAttempts) throw err;

        const message = err instanceof Error ? err.message : String(err);
        const retryable =
          err instanceof Error &&
          (err.name === 'AbortError' ||
            message.toLowerCase().includes('fetch failed') ||
            message.toLowerCase().includes('econnreset') ||
            message.toLowerCase().includes('timed out'));

        if (!retryable) throw err;

        const backoff = this.httpDefaults.retryBackoffMs * attempt;
        await new Promise((resolve) => setTimeout(resolve, backoff));
        continue;
      } finally {
        clearTimeout(timeout);
      }
    }

    throw new Error('Request failed after retries');
  }
}
