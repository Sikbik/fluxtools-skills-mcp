#!/usr/bin/env node

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs/promises';
import { createPublicKey, publicEncrypt, randomBytes, constants, createHash, createDecipheriv, createCipheriv } from 'node:crypto';

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ListResourcesRequestSchema,
  ReadResourceRequestSchema,
  Tool,
} from '@modelcontextprotocol/sdk/types.js';

import { FluxClient } from './fluxClient.js';
import type { FluxResponseType } from './fluxClient.js';

import { ResourceStore } from './resources.js';
import {
  loadEndpointInventory,
  searchRoutes,
  summarizeByCategory,
} from './endpoints.js';
import { renderMarkdownTable } from './markdownTable.js';
import { buildTableResult } from './toolOutput.js';
import { extractFluxErrorMessage, isFluxSuccess, unwrapFluxEnvelope } from './fluxEnvelope.js';

type CallToolRequest = { params: { name: string; arguments?: unknown } };

type FluxRequestResult = Awaited<ReturnType<FluxClient['request']>>;

type FluxRequestErrorHint = {
  code?: string;
  hint?: string;
  recommended?: string;
};

function classifyRequestFailure(err: unknown): FluxRequestErrorHint {
  const message = err instanceof Error ? err.message : String(err);
  const lower = message.toLowerCase();

  if (lower.includes('aborterror') || lower.includes('timeout')) {
    return { code: 'timeout', hint: 'Request timed out. Node may be unreachable or slow.', recommended: 'Try another candidate node or increase timeout.' };
  }

  if (lower.includes('econnrefused') || lower.includes('connection refused')) {
    return { code: 'refused', hint: 'Connection refused. Node API port may be blocked or incorrect.', recommended: 'Verify the node API port from /apps/location and try another candidate.' };
  }

  if (lower.includes('ehostunreach') || lower.includes('host unreachable')) {
    return { code: 'unreachable', hint: 'Host unreachable. Network path to node failed.', recommended: 'Try another candidate node.' };
  }

  if (lower.includes('fetch failed') || lower.includes('network error')) {
    return { code: 'network', hint: 'Network request failed. Node may not be reachable from this environment.', recommended: 'Try another candidate node.' };
  }

  return {};
}

async function attemptOnCandidates<T>(
  candidates: Array<{ baseUrl: string; host: string; apiPort: number }>,
  fn: (baseUrl: string) => Promise<T>
): Promise<{ ok: true; value: T; used: { baseUrl: string; host: string; apiPort: number }; failures: Array<{ baseUrl: string; error: string; hint?: FluxRequestErrorHint }> } | { ok: false; failures: Array<{ baseUrl: string; error: string; hint?: FluxRequestErrorHint }> }> {
  const failures: Array<{ baseUrl: string; error: string; hint?: FluxRequestErrorHint }> = [];

  for (const c of candidates) {
    try {
      const value = await fn(c.baseUrl);
      return { ok: true, value, used: c, failures };
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      failures.push({ baseUrl: c.baseUrl, error, hint: classifyRequestFailure(err) });
    }
  }

  return { ok: false, failures };
}

async function attemptOnBaseUrls<T>(
  baseUrls: string[],
  fn: (baseUrl: string) => Promise<T>
): Promise<{ ok: true; value: T; used: string; failures: Array<{ baseUrl: string; error: string; hint?: FluxRequestErrorHint }> } | { ok: false; failures: Array<{ baseUrl: string; error: string; hint?: FluxRequestErrorHint }> }> {
  const failures: Array<{ baseUrl: string; error: string; hint?: FluxRequestErrorHint }> = [];

  for (const baseUrl of baseUrls) {
    try {
      const value = await fn(baseUrl);
      return { ok: true, value, used: baseUrl, failures };
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      failures.push({ baseUrl, error, hint: classifyRequestFailure(err) });
    }
  }

  return { ok: false, failures };
}

type FluxDriveClientState = {
  baseUrl: string;
};

function normalizeHttpBaseUrl(url: string): string {
  const parsed = new URL(url);
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('Base URL must start with http:// or https://');
  }
  return url.replace(/\/+$/, '');
}

const fluxDriveClient: FluxDriveClientState = {
  baseUrl: process.env.FLUXDRIVE_MWS_BASE_URL
    ? normalizeHttpBaseUrl(process.env.FLUXDRIVE_MWS_BASE_URL)
    : 'https://mws.fluxdrive.runonflux.io',
};

async function fluxDriveRequest(
  pathname: string,
  opts?: { method?: string; query?: Record<string, unknown>; body?: unknown; timeoutMs?: number }
) {
  const method = (opts?.method ?? (opts?.body === undefined ? 'GET' : 'POST')).toUpperCase();

  const path = pathname.startsWith('/') ? pathname : `/${pathname}`;
  const qs = opts?.query ? new URLSearchParams(Object.entries(opts.query).map(([k, v]) => [k, String(v)])).toString() : '';
  const url = `${fluxDriveClient.baseUrl}${path}${qs ? `?${qs}` : ''}`;

  const headers: Record<string, string> = {
    accept: 'application/json',
  };

  const zelidauth = client.getZelidauthValue();
  if (zelidauth) headers.zelidauth = zelidauth;

  let body: string | undefined;
  if (opts?.body !== undefined) {
    body = JSON.stringify(opts.body);
    headers['content-type'] = 'application/json';
  }

  const timeoutMs = Number(opts?.timeoutMs ?? client.getHttpDefaults().timeoutMs);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(url, { method, headers, body, signal: controller.signal });
    const outHeaders: Record<string, string> = {};
    for (const [k, v] of res.headers.entries()) outHeaders[k.toLowerCase()] = v;
    const text = await res.text();
    let data: unknown = text;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
    }
    return { url, status: res.status, ok: res.ok, headers: outHeaders, data };
  } finally {
    clearTimeout(timeout);
  }
}

function mustBeString(value: unknown, name: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${name} must be a non-empty string`);
  return value;
}

const ENTERPRISE_KEY_HEADER = 'enterprise-key';

function generateEnterpriseKey(publicKeyBase64: string): { enterpriseKey: string; aesKeyBase64: string } {
  const aesKey = randomBytes(32);
  const aesKeyBase64 = aesKey.toString('base64');
  let key: ReturnType<typeof createPublicKey>;
  try {
    key = createPublicKey({
      key: Buffer.from(publicKeyBase64, 'base64'),
      format: 'der',
      type: 'spki',
    });
  } catch (error) {
    throw new Error('publicKey must be a base64-encoded SPKI DER RSA public key');
  }
  const encrypted = publicEncrypt(
    { key, padding: constants.RSA_PKCS1_OAEP_PADDING, oaepHash: 'sha256' },
    Buffer.from(aesKeyBase64)
  );
  return { enterpriseKey: encrypted.toString('base64'), aesKeyBase64 };
}

function buildGitRepoUrl(opts: { repoUrl: string; username?: string; token?: string }): string {
  const raw = opts.repoUrl.trim();
  if (!raw) throw new Error('repoUrl must be a non-empty string');

  if (!opts.token) return raw;

  try {
    const u = new URL(raw);
    const username = typeof opts.username === 'string' && opts.username.trim() ? opts.username.trim() : 'git';
    u.username = username;
    u.password = opts.token;
    return u.toString();
  } catch {
    throw new Error('repoUrl must be a valid URL (e.g. https://github.com/owner/repo)');
  }
}

function encryptEnterpriseV8(opts: { publicKeyBase64: string; enterprise: unknown }): string {
  const plainText = JSON.stringify(opts.enterprise);
  const publicKey = opts.publicKeyBase64.trim().replace(/\s+/g, '');

  const { enterpriseKey, aesKeyBase64 } = generateEnterpriseKey(publicKey);
  const encryptedAesKey = Buffer.from(enterpriseKey, 'base64');

  const key = Buffer.from(aesKeyBase64, 'base64');
  if (key.length !== 32) {
    throw new Error('Generated AES key did not decode to 32 bytes (AES-256-GCM).');
  }

  const nonce = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, nonce);

  const encryptedStart = cipher.update(plainText, 'utf8');
  const encryptedEnd = cipher.final();
  const tag = cipher.getAuthTag();

  // Flux enterprise encoding: rsaEncryptedAesKey || nonce || ciphertext || tag
  const payload = Buffer.concat([encryptedAesKey, nonce, encryptedStart, encryptedEnd, tag]);
  return payload.toString('base64');
}

function asOptionalString(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}

function parseHostPort(raw: string): { host: string; port: number | null } {
  const trimmed = raw.trim();
  const parts = trimmed.split(':');
  if (parts.length === 2) {
    const port = Number(parts[1]);
    return { host: parts[0], port: Number.isFinite(port) ? port : null };
  }
  return { host: trimmed, port: null };
}

function containerNameFromRunningEntry(entry: Record<string, unknown>): string | null {
  const nameRaw = entry['name'] ?? entry['Names'];
  if (typeof nameRaw === 'string') return nameRaw.replace(/^\//, '');
  if (Array.isArray(nameRaw) && typeof nameRaw[0] === 'string') return (nameRaw[0] as string).replace(/^\//, '');
  return null;
}

function isContainerForApp(containerName: string, appname: string): boolean {
  const n = containerName.replace(/^\//, '');
  return n === `flux${appname}` || n === `zel${appname}` || n.endsWith(`_${appname}`);
}

function isSensitivePath(p: string): boolean {
  const s = p.toLowerCase();
  if (s.includes('credential') || s.includes('secret') || s.includes('private')) return true;
  if (s.endsWith('.env') || s.includes('/.env') || s.includes('\\.env')) return true;
  if (s.endsWith('credentials.json') || s.includes('credentials.json')) return true;
  if (s.endsWith('.pem') || s.endsWith('.key') || s.endsWith('.p12') || s.endsWith('.pfx')) return true;
  return false;
}

function isVolumeNotFoundError(message: string | null): boolean {
  if (!message) return false;
  return message.toLowerCase().includes('application volume not found');
}

const GIT_DEPLOY_REPOTAG = 'runonflux/orbit:latest';

const GIT_DEPLOY_BANNED_PORTS: Array<number | { min: number; max: number }> = [
  // Port ranges
  { min: 16100, max: 16299 },
  { min: 26100, max: 26299 },
  { min: 30000, max: 30099 },

  // Privileged ports (0-1023)
  { min: 0, max: 1023 },

  // Individual banned ports
  8384, // Syncthing
  27017, // MongoDB
  22, // SSH
  23, // Telnet
  25, // SMTP
  3389, // RDP
  5900, // VNC
  5800, // VNC HTTP
  5901, // VNC
  161, // SNMP
  512, // rexec
  513, // rlogin
  3388, // RDP variant
  4444, // Common backdoor port
  123, // NTP
  53, // DNS
  8080, // HTTP alternate
  8081, // HTTP alternate
  8443, // HTTPS alternate
  6667, // IRC
];

function isGitDeployPortBanned(port: number): boolean {
  if (!Number.isFinite(port)) return true;
  const p = Math.trunc(port);

  for (const banned of GIT_DEPLOY_BANNED_PORTS) {
    if (typeof banned === 'number') {
      if (p === banned) return true;
      continue;
    }
    if (p >= banned.min && p <= banned.max) return true;
  }
  return false;
}

function generateGitDeployPort(min = 20000, max = 65535): number {
  const minV = Math.max(1, Math.trunc(min));
  const maxV = Math.max(minV, Math.trunc(max));

  let port = minV;
  let attempts = 0;
  while (attempts < 100) {
    port = Math.floor(Math.random() * (maxV - minV + 1)) + minV;
    if (!isGitDeployPortBanned(port)) return port;
    attempts += 1;
  }
  return port;
}

function generateGitDeployManagementPort(exposedPort: number): number {
  let port = generateGitDeployPort(10000, 65535);
  let attempts = 0;
  while (attempts < 100 && (port === exposedPort || isGitDeployPortBanned(port))) {
    port = generateGitDeployPort(10000, 65535);
    attempts += 1;
  }
  return port;
}

type ParsedProgressOutput = {
  raw: string;
  events: string[];
  jsonObjects: unknown[];
};

function parseProgressOutput(raw: string): ParsedProgressOutput {
  const text = raw ?? '';
  const events: string[] = [];
  const jsonObjects: unknown[] = [];

  let lastIndex = 0;
  let jsonStart: number | null = null;
  let depth = 0;
  let inString = false;
  let escape = false;

  const flushText = (value: string) => {
    for (const line of value.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      events.push(trimmed);
    }
  };

  const flushJson = (value: string) => {
    const trimmed = value.trim();
    if (!trimmed) return;
    try {
      const parsed: unknown = JSON.parse(trimmed);
      jsonObjects.push(parsed);

      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        const obj = parsed as Record<string, unknown>;
        const status = typeof obj.status === 'string' ? obj.status : undefined;
        const data = obj.data;
        if (data && typeof data === 'object' && !Array.isArray(data)) {
          const msg = (data as Record<string, unknown>).message;
          if (typeof msg === 'string' && msg.trim()) {
            events.push(status ? `${status}: ${msg}` : msg);
            return;
          }
        }
        if (typeof data === 'string' && data.trim()) {
          events.push(status ? `${status}: ${data}` : data);
          return;
        }
        if (status) {
          events.push(status);
          return;
        }
      }

      events.push(trimmed);
    } catch {
      flushText(value);
    }
  };

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];

    if (jsonStart === null) {
      if (ch === '{') {
        const before = text.slice(lastIndex, i);
        flushText(before);
        jsonStart = i;
        depth = 1;
        inString = false;
        escape = false;
      }
      continue;
    }

    if (inString) {
      if (escape) {
        escape = false;
      } else if (ch === '\\') {
        escape = true;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }

    if (ch === '"') {
      inString = true;
      continue;
    }

    if (ch === '{') {
      depth += 1;
      continue;
    }

    if (ch === '}') {
      depth -= 1;
      if (depth === 0) {
        const end = i + 1;
        const chunk = text.slice(jsonStart, end);
        flushJson(chunk);
        lastIndex = end;
        jsonStart = null;
      }
    }
  }

  if (jsonStart !== null) {
    flushText(text.slice(jsonStart));
  } else {
    flushText(text.slice(lastIndex));
  }

  return { raw: text, events, jsonObjects };
}

type RuntimeTargetCandidate = { host: string; apiPort: number; baseUrl: string };

type RuntimeTargetCheck = {
  baseUrl: string;
  ok: boolean;
  error?: string;
  matchingContainers?: string[];
};

type RuntimeTargetResult = {
  ok: boolean;
  appname: string;
  baseUrl?: string;
  host?: string;
  apiPort?: number;
  containerNames?: string[];
  candidates: RuntimeTargetCandidate[];
  checks: RuntimeTargetCheck[];
  error?: string;
};

type ResolveContainerOptions = {
  client: FluxClient;
  appname: string;
  requireRunning: boolean;
};

type ResolvedContainer = {
  baseUrl: string;
  host: string;
  apiPort: number;
  containerNames: string[];
  containerName: string;
  candidates: Array<{ host: string; apiPort: number; baseUrl: string }>;
};

async function resolveContainerOnCorrectNode(opts: ResolveContainerOptions): Promise<ResolvedContainer | null> {
  const resolved = await resolveRuntimeTarget({ client: opts.client, appname: opts.appname, requireRunning: opts.requireRunning });
  if (!resolved.ok || typeof resolved.baseUrl !== 'string') return null;

  const containerNames = Array.isArray(resolved.containerNames)
    ? resolved.containerNames.map((x) => (typeof x === 'string' ? x.trim() : '')).filter((x) => x.length > 0)
    : [];

  const containerName = typeof containerNames[0] === 'string' ? containerNames[0] : null;
  if (!containerName) return null;

  const host = typeof resolved.host === 'string' ? resolved.host : '';
  const apiPort = typeof resolved.apiPort === 'number' && Number.isFinite(resolved.apiPort) ? resolved.apiPort : 16127;

  return {
    baseUrl: resolved.baseUrl,
    host,
    apiPort,
    containerNames,
    containerName,
    candidates: resolved.candidates,
  };
}

async function getLocationCandidates(opts: {
  client: FluxClient;
  appname: string;
  preferHost?: string;
}): Promise<
  | { ok: true; candidates: Array<{ host: string; apiPort: number; baseUrl: string }>; locations: unknown }
  | { ok: false; candidates: Array<{ host: string; apiPort: number; baseUrl: string }>; error: string; locations: unknown }
> {
  const locationRes = await opts.client.request(`/apps/location/${encodeURIComponent(opts.appname)}`);
  const locations = unwrapFluxEnvelope<unknown>(locationRes.data);
  const candidates: Array<{ host: string; apiPort: number; baseUrl: string }> = [];

  if (!locationRes.ok || !isFluxSuccess(locationRes.data)) {
    return {
      ok: false,
      candidates,
      locations,
      error: extractFluxErrorMessage(locationRes.data) ?? 'Location lookup failed',
    };
  }

  const list = Array.isArray(locations)
    ? locations.filter((x): x is Record<string, unknown> => !!x && typeof x === 'object' && !Array.isArray(x))
    : [];

  const defaultApiPort = 16127;

  for (const x of list) {
    const ip = x['ip'];
    const ipString = typeof ip === 'string' ? ip : '';
    const parsed = ipString ? parseHostPort(ipString) : { host: '', port: null };
    const apiPort = parsed.port ?? defaultApiPort;
    const baseUrl = parsed.host ? `http://${parsed.host}:${apiPort}` : null;
    if (!baseUrl) continue;

    candidates.push({ host: parsed.host, apiPort, baseUrl });
  }

  const ordered = opts.preferHost
    ? [...candidates.filter((c) => c.host === opts.preferHost), ...candidates.filter((c) => c.host !== opts.preferHost)]
    : candidates;

  return { ok: true, candidates: ordered, locations };
}

function parseFluxErrorFromBase64Download(blob: Record<string, unknown>): { parsed: unknown; error: string | null; fluxOk: boolean | null } | null {
  const base64 = typeof blob.base64 === 'string' ? blob.base64 : null;
  if (!base64) return null;

  // Successful downloads from /apps/downloadfile|downloadfolder set Content-Disposition.
  const contentDisposition = typeof blob.contentDisposition === 'string' ? blob.contentDisposition : '';

  const likelySuccess = contentDisposition.toLowerCase().includes('attachment');
  if (likelySuccess) return null;

  try {
    const decoded = Buffer.from(base64, 'base64').toString('utf-8').trim();
    if (!decoded.startsWith('{')) return null;

    const parsed: unknown = JSON.parse(decoded);
    const fluxOk = isFluxSuccess(parsed);
    const error = fluxOk ? null : extractFluxErrorMessage(parsed);
    if (error) return { parsed, fluxOk, error };
    return null;
  } catch {
    return null;
  }
}

async function resolveRuntimeTarget(opts: {
  client: FluxClient;
  appname: string;
  preferHost?: string;
  requireRunning: boolean;
}): Promise<RuntimeTargetResult> {
  const locationRes = await opts.client.request(`/apps/location/${encodeURIComponent(opts.appname)}`);
  if (!locationRes.ok) {
    return {
      ok: false,
      appname: opts.appname,
      candidates: [],
      checks: [],
      error: extractFluxErrorMessage(locationRes.data) ?? 'Location lookup failed',
    };
  }

  const locationsRaw = unwrapFluxEnvelope<unknown>(locationRes.data);
  const locations = Array.isArray(locationsRaw)
    ? locationsRaw.filter((x): x is Record<string, unknown> => !!x && typeof x === 'object' && !Array.isArray(x))
    : [];

  const defaultApiPort = 16127;

  const candidates = locations
    .map((x) => {
      const ip = x['ip'];
      const ipString = typeof ip === 'string' ? ip : '';
      const parsed = ipString ? parseHostPort(ipString) : { host: '', port: null };

      const apiPort = parsed.port ?? defaultApiPort;
      const baseUrl = parsed.host ? `http://${parsed.host}:${apiPort}` : null;

      return {
        raw: ipString,
        host: parsed.host,
        apiPort,
        baseUrl,
      };
    })
    .filter((x): x is { raw: string; host: string; apiPort: number; baseUrl: string } => !!x.baseUrl);

  const ordered = opts.preferHost
    ? [...candidates.filter((c) => c.host === opts.preferHost), ...candidates.filter((c) => c.host !== opts.preferHost)]
    : candidates;

  const checks: RuntimeTargetCheck[] = [];

  for (const c of ordered) {
    const tmp = new FluxClient({
      baseUrl: c.baseUrl,
      zelidauth: opts.client.getZelidauthValueForBaseUrl(c.baseUrl) ?? undefined,
      enterpriseKey: opts.client.getEnterpriseKeyValueForBaseUrl(c.baseUrl) ?? undefined,
    });
    tmp.setHttpDefaults({ ...opts.client.getHttpDefaults(), timeoutMs: Math.max(opts.client.getHttpDefaults().timeoutMs, 15000) });

    const runningRes = await tmp.request('/apps/listrunningapps');
    if (!runningRes.ok) {
      checks.push({ baseUrl: c.baseUrl, ok: false, error: extractFluxErrorMessage(runningRes.data) ?? 'listrunningapps failed' });
      continue;
    }

    const runningRaw = unwrapFluxEnvelope<unknown>(runningRes.data);
    const running = Array.isArray(runningRaw)
      ? runningRaw.filter((x): x is Record<string, unknown> => !!x && typeof x === 'object' && !Array.isArray(x))
      : [];

    const containerNames = running
      .map((x) => containerNameFromRunningEntry(x))
      .filter((x): x is string => typeof x === 'string');

    const matching = containerNames.filter((n) => isContainerForApp(n, opts.appname));

    checks.push({
      baseUrl: c.baseUrl,
      ok: true,
      matchingContainers: matching,
    });

    if (opts.requireRunning && matching.length === 0) continue;

    return {
      ok: true,
      appname: opts.appname,
      baseUrl: c.baseUrl,
      host: c.host,
      apiPort: c.apiPort,
      containerNames: matching,
      candidates: ordered.map((x) => ({ host: x.host, apiPort: x.apiPort, baseUrl: x.baseUrl })),
      checks,
    };
  }

  return {
    ok: false,
    appname: opts.appname,
    apiPort: defaultApiPort,
    candidates: ordered.map((x) => ({ host: x.host, apiPort: x.apiPort, baseUrl: x.baseUrl })),
    checks,
    error: opts.requireRunning
      ? 'No candidate node reported the app as running. Try requireRunning=false to just get baseUrl candidates.'
      : 'No location candidates available.',
  };
}

function mustBeNumber(value: unknown, name: string): number {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) throw new Error(`${name} must be a number`);
  return n;
}

function asOptionalNumber(value: unknown): number | undefined {
  if (value === undefined || value === null) return undefined;
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) return undefined;
  return n;
}

function mustBeBoolean(value: unknown, name: string): boolean {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    const v = value.trim().toLowerCase();
    if (v === 'true' || v === '1' || v === 'yes') return true;
    if (v === 'false' || v === '0' || v === 'no') return false;
  }
  throw new Error(`${name} must be a boolean`);
}

function asOptionalBoolean(value: unknown): boolean | undefined {
  if (value === undefined || value === null) return undefined;
  try {
    return mustBeBoolean(value, 'value');
  } catch {
    return undefined;
  }
}

function mustBeObject(value: unknown, name: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${name} must be an object`);
  }
  return value as Record<string, unknown>;
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function jsonResult(
  data: unknown,
  opts?: {
    isError?: boolean;
    structuredContent?: Record<string, unknown>;
    contentText?: string;
  }
) {
  const text = opts?.contentText ?? JSON.stringify(data, null, 2);

  return {
    content: [{ type: 'text', text }],
    structuredContent: opts?.structuredContent,
    isError: opts?.isError ?? false,
  };
}

function errorResult(error: unknown, opts?: { tool?: string; hint?: string }) {
  const message = error instanceof Error ? error.message : String(error);
  return jsonResult(
    {
      error: message,
      tool: opts?.tool,
      hint: opts?.hint,
    },
    { isError: true }
  );
}

function normalizeEnvParams(env: unknown): string[] {
  if (env === undefined || env === null) return [];

  if (Array.isArray(env)) {
    return env
      .filter((x) => typeof x === 'string')
      .map((s) => s.trim())
      .filter(Boolean);
  }

  if (typeof env === 'object') {
    const out: string[] = [];
    for (const [k, v] of Object.entries(env as Record<string, unknown>)) {
      if (!k) continue;
      if (v === undefined || v === null) continue;
      out.push(`${k}=${String(v)}`);
    }
    return out;
  }

  return [];
}

function normalizeCommands(cmd: unknown): string[] {
  if (cmd === undefined || cmd === null) return [];
  if (!Array.isArray(cmd)) return [];
  return cmd
    .filter((x) => typeof x === 'string')
    .map((s) => s.trim())
    .filter(Boolean);
}

async function buildGitDeploySpecV8(opts: {
  client: FluxClient;
  args: Record<string, unknown>;
}): Promise<{
  spec: Record<string, unknown>;
  meta: {
    appname: string;
    owner: string;
    repoUrl: string;
    branch: string;
    projectPath: string;
    hasRepoToken: boolean;
    enterprise: boolean;
    repotag: string;
    appPort: number;
    exposedPort: number;
    managementPort: number;
    domain: string;
    instances: number;
    cpu: number;
    ramMb: number;
    hddGb: number;
    expireBlocks: number;
    envCount: number;
    geolocationCount: number;
    staticip: boolean;
    publicKeySource: 'provided' | 'apps/getpublickey' | null;
  };
}> {
  const appname = mustBeString(opts.args['name'], 'name');
  const owner = mustBeString(opts.args['owner'], 'owner');
  const repoUrl = mustBeString(opts.args['repoUrl'], 'repoUrl');

  const description = asOptionalString(opts.args['description']) ?? `Git deployment (${GIT_DEPLOY_REPOTAG})`;
  if (!description.trim()) throw new Error('description must be a non-empty string');

  const branch = asOptionalString(opts.args['branch']) ?? 'main';
  const projectPath = asOptionalString(opts.args['projectPath']) ?? '/';

  const repoUsername = asOptionalString(opts.args['repoUsername']);
  const repoToken = asOptionalString(opts.args['repoToken']);

  const contactsRaw = opts.args['contacts'];
  const contacts = Array.isArray(contactsRaw)
    ? contactsRaw
        .filter((x): x is string => typeof x === 'string')
        .map((s) => s.trim())
        .filter(Boolean)
    : [];

  const appPort = asOptionalNumber(opts.args['appPort']) ?? 3000;
  const exposedPort = asOptionalNumber(opts.args['exposedPort']) ?? generateGitDeployPort();
  const managementPort = asOptionalNumber(opts.args['managementPort']) ?? generateGitDeployManagementPort(exposedPort);

  if (!Number.isFinite(appPort) || appPort < 1 || appPort > 65535) {
    throw new Error('appPort must be between 1 and 65535');
  }
  if (!Number.isFinite(exposedPort) || exposedPort < 1 || exposedPort > 65535) {
    throw new Error('exposedPort must be between 1 and 65535');
  }
  if (!Number.isFinite(managementPort) || managementPort < 1 || managementPort > 65535) {
    throw new Error('managementPort must be between 1 and 65535');
  }
  if (isGitDeployPortBanned(exposedPort)) {
    throw new Error(`exposedPort ${Math.trunc(exposedPort)} is not allowed (banned/reserved)`);
  }
  if (isGitDeployPortBanned(managementPort)) {
    throw new Error(`managementPort ${Math.trunc(managementPort)} is not allowed (banned/reserved)`);
  }
  if (Math.trunc(exposedPort) === Math.trunc(managementPort)) {
    throw new Error('exposedPort and managementPort must be different');
  }

  const domain = asOptionalString(opts.args['domain']) ?? '';

  const instances = Math.max(1, Math.trunc(asOptionalNumber(opts.args['instances']) ?? 3));
  const cpu = Math.max(0.1, asOptionalNumber(opts.args['cpu']) ?? 1);
  const ramMb = Math.max(128, Math.trunc(asOptionalNumber(opts.args['ramMb']) ?? 2000));
  const hddGb = Math.max(1, Math.trunc(asOptionalNumber(opts.args['hddGb']) ?? 10));
  const expireBlocks = Math.max(1, Math.trunc(asOptionalNumber(opts.args['expireBlocks']) ?? 88000));

  const geolocationRaw = opts.args['geolocation'];
  const geolocation = Array.isArray(geolocationRaw)
    ? geolocationRaw
        .filter((x): x is string => typeof x === 'string')
        .map((s) => s.trim())
        .filter(Boolean)
    : [];

  const staticip = asOptionalBoolean(opts.args['staticip']) ?? false;
  const repotag = asOptionalString(opts.args['repotag']) ?? GIT_DEPLOY_REPOTAG;

  const enterpriseExplicit = (asOptionalBoolean(opts.args['enterprise']) ?? false) === true;
  const enterprise = enterpriseExplicit || !!repoToken;

  if (repoToken && !enterprise) {
    throw new Error('repoToken was provided but enterprise=false. For safety, private repo tokens must be enterprise-encrypted.');
  }

  const gitUrl = buildGitRepoUrl({ repoUrl, username: repoUsername, token: repoToken });

  const envParams: string[] = [`GIT_REPO_URL=${gitUrl}`, `APP_PORT=${String(appPort)}`];
  if (branch && branch !== 'main') envParams.push(`GIT_BRANCH=${branch}`);
  if (projectPath && projectPath !== '/') envParams.push(`PROJECT_PATH=${projectPath}`);

  const extraEnv = normalizeEnvParams(opts.args['environment']);
  for (const e of extraEnv) {
    if (!e || typeof e !== 'string') continue;
    const trimmed = e.trim();
    if (!trimmed) continue;
    envParams.push(trimmed);
  }

  const compose = [
    {
      name: 'cloudgit',
      description: 'cloudgit',
      repotag,
      ports: [Math.trunc(exposedPort), Math.trunc(managementPort)],
      containerPorts: [Math.trunc(appPort), 9001],
      domains: [domain, ''],
      environmentParameters: envParams,
      commands: [],
      containerData: '/app',
      cpu,
      ram: ramMb,
      hdd: hddGb,
      tiered: false,
      repoauth: '',
    },
  ];

  let spec: Record<string, unknown> = {
    version: 8,
    name: appname,
    description,
    owner,
    contacts,
    instances,
    staticip,
    enterprise: '',
    nodes: [],
    geolocation,
    expire: expireBlocks,
    compose,
  };

  let publicKeySource: 'provided' | 'apps/getpublickey' | null = null;

  if (enterprise) {
    let publicKey = asOptionalString(opts.args['publicKeyBase64']);
    if (publicKey) {
      publicKeySource = 'provided';
    } else {
      const res = await opts.client.request('/apps/getpublickey', {
        method: 'POST',
        body: { owner, name: appname },
        timeoutMs: 60 * 1000,
      });
      if (!res.ok || !isFluxSuccess(res.data)) {
        throw new Error(extractFluxErrorMessage(res.data) ?? 'Failed to fetch public key for enterprise encryption.');
      }
      const key = unwrapFluxEnvelope<unknown>(res.data);
      if (typeof key !== 'string' || !key.trim()) {
        throw new Error('Failed to fetch public key for enterprise encryption (empty response).');
      }
      publicKey = key;
      publicKeySource = 'apps/getpublickey';
    }

    const enterpriseSpecs = {
      contacts: spec.contacts,
      compose: spec.compose,
    };

    const encryptedEnterprise = encryptEnterpriseV8({ publicKeyBase64: publicKey, enterprise: enterpriseSpecs });

    spec = {
      ...spec,
      enterprise: encryptedEnterprise,
      contacts: [],
      compose: [],
    };
  }

  return {
    spec,
    meta: {
      appname,
      owner,
      repoUrl,
      branch,
      projectPath,
      hasRepoToken: !!repoToken,
      enterprise,
      repotag,
      appPort: Math.trunc(appPort),
      exposedPort: Math.trunc(exposedPort),
      managementPort: Math.trunc(managementPort),
      domain,
      instances,
      cpu,
      ramMb,
      hddGb,
      expireBlocks,
      envCount: envParams.length,
      geolocationCount: geolocation.length,
      staticip,
      publicKeySource,
    },
  };
}

function buildMessageToSign(opts: {
  type: 'fluxappregister' | 'fluxappupdate' | 'zelappregister' | 'zelappupdate';
  version: number;
  spec: Record<string, unknown>;
  timestamp: number;
}): string {
  const specJson = JSON.stringify(opts.spec);
  return `${opts.type}${opts.version}${specJson}${opts.timestamp}`;
}

function buildMessageToSignDetails(messageToSign: string) {
  const base64 = Buffer.from(messageToSign, 'utf8').toString('base64');
  const sha256 = createHash('sha256').update(messageToSign, 'utf8').digest('hex');
  const jsonEscaped = JSON.stringify(messageToSign);
  const jsonEscapedNoQuotes =
    jsonEscaped.length >= 2 && jsonEscaped.startsWith('"') && jsonEscaped.endsWith('"')
      ? jsonEscaped.slice(1, -1)
      : jsonEscaped;

  return {
    messageToSignRaw: messageToSign,
    messageToSignBase64: base64,
    messageToSignSha256: sha256,
    messageToSignJsonEscaped: jsonEscaped,
    messageToSignJsonEscapedNoQuotes: jsonEscapedNoQuotes,
    messageToSignBytes: Buffer.byteLength(messageToSign, 'utf8'),
  };
}

function decryptEnterprisePayload(enterpriseBase64: string, aesKeyBase64: string): string {
  const payload = Buffer.from(enterpriseBase64, 'base64');
  if (payload.length < 12 + 16) {
    throw new Error('enterprise payload is too short (expected nonce + ciphertext + tag).');
  }

  const nonce = payload.subarray(0, 12);
  const tag = payload.subarray(payload.length - 16);
  const ciphertext = payload.subarray(12, payload.length - 16);

  const key = Buffer.from(aesKeyBase64, 'base64');
  if (key.length !== 32) {
    throw new Error('aesKeyBase64 must decode to 32 bytes for AES-256-GCM.');
  }

  const decipher = createDecipheriv('aes-256-gcm', key, nonce);
  decipher.setAuthTag(tag);

  const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return decrypted.toString('utf8');
}

async function uploadToFluxStorage(message: string): Promise<string> {
  const publicid = Math.floor(Math.random() * 999999999999999).toString();
  const res = await fetch('https://storage.runonflux.io/v1/public', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ publicid, public: message }),
  });

  if (!res.ok) {
    throw new Error(`Flux Storage upload failed (status ${res.status}).`);
  }

  return `https://storage.runonflux.io/v1/public/${publicid}`;
}

function buildSignedPayload(opts: {
  type: string;
  version: number;
  spec: Record<string, unknown>;
  timestamp: number;
  signature?: string;
}) {
  return {
    type: opts.type,
    version: opts.version,
    appSpecification: opts.spec,
    timestamp: opts.timestamp,
    signature: opts.signature ?? '<SIGNATURE>',
  };
}


function extractHashFromAppMessageResponse(responseBody: unknown): string | undefined {
  if (!responseBody || typeof responseBody !== 'object') return undefined;

  const body = responseBody as Record<string, unknown>;

  const data = body.data;
  if (typeof data === 'string') return data;

  if (data && typeof data === 'object' && !Array.isArray(data)) {
    const inner = data as Record<string, unknown>;
    const candidates = [inner.hash, inner.messageHASH, inner.messageHash, inner.id];
    for (const c of candidates) {
      if (typeof c === 'string' && c.trim()) return c;
    }
  }

  const topCandidates = [body.hash, body.messageHASH, body.messageHash, body.id];
  for (const c of topCandidates) {
    if (typeof c === 'string' && c.trim()) return c;
  }


  return undefined;
}

function sleep(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

function hasNonEmptyValue(value: unknown): boolean {
  if (value === null || value === undefined) return false;
  if (typeof value === 'string') return value.trim().length > 0;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === 'object') return Object.keys(value as Record<string, unknown>).length > 0;
  return true;
}

function extractAppIdentity(spec: Record<string, unknown>): { appname?: string; owner?: string } {
  const name = spec.name;
  const owner = spec.owner;
  return {
    appname: typeof name === 'string' && name.trim() ? name.trim() : undefined,
    owner: typeof owner === 'string' && owner.trim() ? owner.trim() : undefined,
  };
}

function isFluxEnvelopeOk(res: FluxRequestResult): boolean {
  return res.ok && isFluxSuccess(res.data);
}

function extractFluxAmountFromPrice(priceRes: FluxRequestResult): number | null {
  if (!priceRes.ok || !isFluxSuccess(priceRes.data)) return null;
  const priceData = unwrapFluxEnvelope<unknown>(priceRes.data);
  if (!priceData || typeof priceData !== 'object' || Array.isArray(priceData)) return null;
  const fluxRaw = (priceData as Record<string, unknown>)['flux'];
  const flux = typeof fluxRaw === 'number' ? fluxRaw : Number(fluxRaw);
  return Number.isFinite(flux) ? Number(flux.toFixed(2)) : null;
}

async function buildPaymentInfo(spec: Record<string, unknown>, memo: string | null) {
  const [deploymentInfoRes, priceRes] = await Promise.all([
    client.request('/apps/deploymentinformation'),
    client.request('/apps/calculateprice', {
      method: 'POST',
      body: spec,
      allowMutation: true,
      timeoutMs: 5 * 60 * 1000,
    }),
  ]);

  const deploymentInfo = unwrapFluxEnvelope<unknown>(deploymentInfoRes.data);
  const paymentAddress =
    deploymentInfo && typeof deploymentInfo === 'object' && !Array.isArray(deploymentInfo)
      ? (deploymentInfo as Record<string, unknown>)['address']
      : undefined;

  const fluxAmount = extractFluxAmountFromPrice(priceRes);

  return {
    deploymentInformation: deploymentInfoRes,
    price: priceRes,
    payment: {
      address: typeof paymentAddress === 'string' && paymentAddress.trim() ? paymentAddress : null,
      amountFlux: fluxAmount,
      memo,
      note: memo
        ? 'Pay to address with memo=hash.'
        : 'After submission returns a hash, pay to address with memo=hash.',
    },
  };
}

async function buildPaymentInfoFromPrice(priceRes: FluxRequestResult, memo: string | null) {
  const deploymentInfoRes = await client.request('/apps/deploymentinformation');
  const deploymentInfo = unwrapFluxEnvelope<unknown>(deploymentInfoRes.data);
  const paymentAddress =
    deploymentInfo && typeof deploymentInfo === 'object' && !Array.isArray(deploymentInfo)
      ? (deploymentInfo as Record<string, unknown>)['address']
      : undefined;

  const fluxAmount = extractFluxAmountFromPrice(priceRes);

  return {
    deploymentInformation: deploymentInfoRes,
    price: priceRes,
    payment: {
      address: typeof paymentAddress === 'string' && paymentAddress.trim() ? paymentAddress : null,
      amountFlux: fluxAmount,
      memo,
      note: memo
        ? 'Pay to address with memo=hash.'
        : 'After submission returns a hash, pay to address with memo=hash.',
    },
  };
}

function pickLatestGlobalSpec(apps: unknown[], appname: string, owner?: string) {
  const filtered = apps.filter((app) => {
    if (!app || typeof app !== 'object' || Array.isArray(app)) return false;
    const obj = app as Record<string, unknown>;
    const name = obj['name'];
    const appOwner = obj['owner'];
    if (typeof name !== 'string' || name !== appname) return false;
    if (owner && typeof appOwner === 'string' && appOwner !== owner) return false;
    return true;
  }) as Array<Record<string, unknown>>;

  if (filtered.length === 0) return null;
  return filtered.reduce((latest, current) => {
    const latestHeight = typeof latest['height'] === 'number' ? latest['height'] : Number(latest['height']);
    const currentHeight = typeof current['height'] === 'number' ? current['height'] : Number(current['height']);
    if (!Number.isFinite(latestHeight)) return current;
    if (!Number.isFinite(currentHeight)) return latest;
    return currentHeight >= latestHeight ? current : latest;
  });
}

function computeAppExpiration(opts: {
  app: Record<string, unknown>;
  currentHeight: number;
  blocksLasting: number;
  daemonPONFork: number;
}) {
  const heightRaw = opts.app['height'];
  const height = typeof heightRaw === 'number' ? heightRaw : Number(heightRaw);

  const expireRaw = opts.app['expire'];
  const expire = expireRaw === undefined || expireRaw === null
    ? null
    : (typeof expireRaw === 'number' ? expireRaw : Number(expireRaw));

  const defaultExpire = height >= opts.daemonPONFork ? opts.blocksLasting * 4 : opts.blocksLasting;
  const expireIn = Number.isFinite(expire as number) ? (expire as number) : defaultExpire;

  const originalExpirationHeight = height + expireIn;
  let expirationHeight = originalExpirationHeight;

  if (height < opts.daemonPONFork && opts.currentHeight >= opts.daemonPONFork && originalExpirationHeight > opts.daemonPONFork) {
    const blocksAfterFork = originalExpirationHeight - opts.daemonPONFork;
    expirationHeight = opts.daemonPONFork + blocksAfterFork * 4;
  }

  const blocksRemaining = expirationHeight - opts.currentHeight;

  return {
    height: Number.isFinite(height) ? height : null,
    expire: Number.isFinite(expire as number) ? (expire as number) : null,
    defaultExpire,
    expireIn,
    originalExpirationHeight,
    expirationHeight,
    blocksRemaining,
  };
}

function formatDurationSeconds(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '-';
  const s = Math.floor(seconds);
  const days = Math.floor(s / 86400);
  const hours = Math.floor((s % 86400) / 3600);
  const minutes = Math.floor((s % 3600) / 60);

  if (days > 0) return `~${days}d ${hours}h`;
  if (hours > 0) return `~${hours}h ${minutes}m`;
  return `~${minutes}m`;
}

function estimateSecondsFromBlocks(blocksRemaining: number, secondsPerBlock: number): number {
  if (!Number.isFinite(blocksRemaining) || !Number.isFinite(secondsPerBlock)) return NaN;
  if (blocksRemaining <= 0) return 0;
  return blocksRemaining * secondsPerBlock;
}

type JsonPrimitive = string | number | boolean | null;

type RedactionOptions = {
  maxDepth: number;
  maxArrayLength: number;
  maxStringLength: number;
  redactTxHex: boolean;
};

function redactSensitive(value: unknown, opts: RedactionOptions, depth = 0): unknown {
  if (depth > opts.maxDepth) return '[REDACTED:depth]';

  if (value === null || value === undefined) return value;

  if (typeof value === 'string') {
    if (value.length > opts.maxStringLength) return `${value.slice(0, opts.maxStringLength)}…`;
    if (opts.redactTxHex && /^[0-9a-fA-F]{128,}$/.test(value)) return '[REDACTED:hex]';
    return value;
  }

  if (typeof value === 'number' || typeof value === 'boolean') return value;

  if (Array.isArray(value)) {
    const sliced = value.slice(0, opts.maxArrayLength);
    return sliced.map((v) => redactSensitive(v, opts, depth + 1));
  }

  if (typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      const key = k.toLowerCase();

      if (
        key.includes('privkey') ||
        key.includes('privatekey') ||
        key.includes('mnemonic') ||
        key.includes('seed') ||
        key.includes('wif') ||
        key === 'hex' ||
        key.endsWith('hex') ||
        key.includes('secret')
      ) {
        out[k] = '[REDACTED]';
        continue;
      }

      out[k] = redactSensitive(v, opts, depth + 1);
    }
    return out;
  }

  return '[REDACTED:unsupported]';
}

function validateDaemonMethod(method: string): string {
  const m = method.trim().toLowerCase();
  if (!/^[a-z0-9_]+$/.test(m)) throw new Error('method must match ^[a-z0-9_]+$');
  return m;
}

function validateDaemonParams(params: unknown): JsonPrimitive[] {
  if (params === undefined || params === null) return [];
  if (!Array.isArray(params)) throw new Error('params must be an array when provided');
  if (params.length > 10) throw new Error('params array too large');

  const out: JsonPrimitive[] = [];
  for (const p of params) {
    if (p === null) {
      out.push(null);
      continue;
    }
    if (typeof p === 'string') {
      if (p.length > 4096) throw new Error('string param too long');
      out.push(p);
      continue;
    }
    if (typeof p === 'number') {
      if (!Number.isFinite(p)) throw new Error('number param must be finite');
      out.push(p);
      continue;
    }
    if (typeof p === 'boolean') {
      out.push(p);
      continue;
    }
    throw new Error('params may only contain string/number/boolean/null');
  }

  return out;
}

function isAllowedDaemonReadOnlyMethod(method: string): boolean {
  const allowed = new Set([
    'getinfo',
    'getblockchaininfo',
    'getnetworkinfo',
    'getmempoolinfo',
    'getpeerinfo',
    'getblockcount',
    'getdifficulty',
    'getconnectioncount',
    'getrawmempool',
  ]);

  return allowed.has(method);
}

async function pollMessagePropagation(opts: {
  hash: string;
  attempts: number;
  intervalMs: number;
  timeoutMs?: number;
}): Promise<{
  attemptsUsed: number;
  temporaryPresent: boolean;
  permanentPresent: boolean;
  lastTemporary: unknown;
  lastPermanent: unknown;
}> {
  const attempts = Math.max(1, Math.floor(opts.attempts));
  const intervalMs = Math.max(0, Math.floor(opts.intervalMs));

  let lastTemporary: unknown = null;
  let lastPermanent: unknown = null;
  let temporaryPresent = false;
  let permanentPresent = false;

  for (let i = 0; i < attempts; i++) {
    const [temporaryRes, permanentRes] = await Promise.all([
      client.request(`/apps/temporarymessages/${encodeURIComponent(opts.hash)}`, {
        timeoutMs: opts.timeoutMs,
      }),
      client.request(`/apps/permanentmessages/${encodeURIComponent(opts.hash)}`, {
        timeoutMs: opts.timeoutMs,
      }),
    ]);

    if (!temporaryRes.ok || !permanentRes.ok) {
      return {
        attemptsUsed: i + 1,
        temporaryPresent: false,
        permanentPresent: false,
        lastTemporary: temporaryRes,
        lastPermanent: permanentRes,
      };
    }

    lastTemporary = temporaryRes;
    lastPermanent = permanentRes;

    const tempOk = isFluxSuccess(temporaryRes.data);
    const permOk = isFluxSuccess(permanentRes.data);

    const tempValue = tempOk ? unwrapFluxEnvelope<unknown>(temporaryRes.data) : null;
    const permValue = permOk ? unwrapFluxEnvelope<unknown>(permanentRes.data) : null;

    temporaryPresent = tempOk && hasNonEmptyValue(tempValue);
    permanentPresent = permOk && hasNonEmptyValue(permValue);

    if (permanentPresent) {
      return {
        attemptsUsed: i + 1,
        temporaryPresent,
        permanentPresent,
        lastTemporary,
        lastPermanent,
      };
    }

    if (i < attempts - 1 && intervalMs > 0) await sleep(intervalMs);
  }

  return {
    attemptsUsed: attempts,
    temporaryPresent,
    permanentPresent,
    lastTemporary,
    lastPermanent,
  };
}

function requireConfirm(args: Record<string, unknown>, actionDescription: string) {
  const confirm = asOptionalBoolean(args.confirm) ?? false;
  if (confirm !== true) {
    throw new Error(`confirm=true is required to run: ${actionDescription}`);
  }
}

function assertAuthenticatedFor(action: string) {
  const z = client.getZelidauthSummary();
  if (z.present) return;
  throw new Error(
    `Not authenticated (zelidauth not set). Required for: ${action}. Run flux_auth_flow or flux_set_zelidauth before continuing.`
  );
}

function asResponseType(value: unknown): FluxResponseType | undefined {
  if (typeof value !== 'string') return undefined;
  const v = value.trim().toLowerCase();
  if (v === 'auto' || v === 'text' || v === 'base64') return v as FluxResponseType;
  return undefined;
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const endpointsPath =
  process.env.FLUX_ENDPOINTS_PATH ?? path.resolve(__dirname, '..', 'data', 'endpoints.json');

const inventory = loadEndpointInventory(endpointsPath);

const envBaseUrl = process.env.FLUX_API_BASE_URL;
const baseUrl = envBaseUrl && envBaseUrl.trim() ? envBaseUrl : 'https://api.runonflux.io';

const client = new FluxClient({
  baseUrl,
  zelidauth: process.env.FLUX_ZELIDAUTH,
  enterpriseKey: process.env.FLUX_ENTERPRISE_KEY,
});

const resourceStore = new ResourceStore({
  ttlMs: Number(process.env.FLUX_MCP_RESOURCE_TTL_MS ?? 10 * 60 * 1000),
  maxEntries: Number(process.env.FLUX_MCP_RESOURCE_MAX_ENTRIES ?? 200),
});

export const tools: Tool[] = [
  // Session/auth helpers
  {
    name: 'flux_get_state',
    description: 'Get current MCP client state (base URL, whether zelidauth is set, HTTP defaults).',
    inputSchema: { type: 'object', properties: {} },
  },

  {
    name: 'flux_fluxdrive_set_base_url',
    description:
      'Set FluxDrive MWS base URL for this MCP session (default https://mws.fluxdrive.runonflux.io). This is separate from the Flux node baseUrl.',
    inputSchema: {
      type: 'object',
      properties: {
        baseUrl: {
          type: 'string',
          description: 'FluxDrive MWS base URL (e.g. https://mws.fluxdrive.runonflux.io)',
        },
      },
      required: ['baseUrl'],
    },
  },
  {
    name: 'flux_fluxdrive_register_backup_file',
    description:
      'Register a backup file with FluxDrive MWS (POST /registerbackupfile). Requires zelidauth set (use flux_set_zelidauth).',
    inputSchema: {
      type: 'object',
      properties: {
        appname: { type: 'string' },
        component: { type: 'string' },
        filename: { type: 'string' },
        filesize: { type: 'number' },
        host: {
          type: 'string',
          description: 'Publicly reachable download URL for the backup tarball (usually /backup/downloadlocalfile/... on a node API domain).',
        },
        timestamp: { type: 'number', description: 'Epoch ms used by UI to identify backup run.' },
      },
      required: ['appname', 'component', 'filename', 'filesize', 'host', 'timestamp'],
    },
  },
  {
    name: 'flux_fluxdrive_get_task_status',
    description: 'Get FluxDrive MWS task status (GET /gettaskstatus?taskId=...). Requires zelidauth set.',
    inputSchema: {
      type: 'object',
      properties: {
        taskId: { type: 'number' },
      },
      required: ['taskId'],
    },
  },
  {
    name: 'flux_fluxdrive_get_backup_list',
    description:
      'Get FluxDrive MWS backup inventory for an app (GET /getbackuplist?appname=...). Requires zelidauth set.',
    inputSchema: {
      type: 'object',
      properties: {
        appname: { type: 'string' },
      },
      required: ['appname'],
    },
  },
  {
    name: 'flux_fluxdrive_remove_checkpoint',
    description: 'Remove a FluxDrive checkpoint (POST /removeCheckpoint). Requires zelidauth set.',
    inputSchema: {
      type: 'object',
      properties: {
        appname: { type: 'string' },
        timestamp: { type: 'number' },
      },
      required: ['appname', 'timestamp'],
    },
  },
  {
    name: 'flux_ioutils_file_upload',
    description:
      'Upload a file into an app volume via IOUtils.fileUpload (POST /ioutils/fileupload). Requires confirm=true. Note: Flux responds with a streaming (non-JSON) body and can take a while; set timeoutMs accordingly.',
    inputSchema: {
      type: 'object',
      properties: {
        type: {
          type: 'string',
          description: 'Upload type (e.g. backup). When type=backup, uploads into <mount>/backup/upload/.',
        },
        appname: { type: 'string' },
        component: { type: 'string' },
        folder: { type: 'string', description: 'Folder path or "null" for backup uploads.' },
        filename: { type: 'string' },
        filePath: { type: 'string', description: 'Absolute path to a local file to upload as multipart/form-data.' },
        timeoutMs: { type: 'number', description: 'Request timeout in ms (default: 15 minutes).', minimum: 1 },
        maxFileBytes: { type: 'number', description: 'Max bytes to read from disk (default: 1GB).', minimum: 1 },
        allowProxy: {
          type: 'boolean',
          description:
            'If true, allow using gateway/proxy base URLs (often unreliable for this endpoint). Default: false (recommended).',
        },
        confirm: { type: 'boolean' },
      },
      required: ['type', 'appname', 'component', 'filename', 'filePath', 'confirm'],
    },
  },
  {
    name: 'flux_resource_prune',
    description: 'Prune expired dynamic resources or clear them all. Does not affect static resources like flux://inventory/endpoints.',
    inputSchema: {
      type: 'object',
      properties: {
        clearAll: { type: 'boolean', description: 'If true, clears all dynamic resources (default false).', default: false },
      },
    },
  },
  {
    name: 'flux_resolve_gateway_node',
    description: 'Resolve the current Flux node IP behind a gateway base URL (e.g. https://api.runonflux.io). Uses /flux/info and the response header `fluxnode` when available.',
    inputSchema: {
      type: 'object',
      properties: {
        gatewayBaseUrl: {
          type: 'string',
          description: 'Gateway base URL (e.g. https://api.runonflux.io)',
        },
      },
      required: ['gatewayBaseUrl'],
    },
  },
  {
    name: 'flux_set_base_url_from_gateway',
    description: 'Resolve a gateway to its current node and set baseUrl to the recommended direct node URL.',
    inputSchema: {
      type: 'object',
      properties: {
        gatewayBaseUrl: {
          type: 'string',
          description: 'Gateway base URL (e.g. https://api.runonflux.io)',
        },
      },
      required: ['gatewayBaseUrl'],
    },
  },
  {
    name: 'flux_set_http_defaults',
    description: 'Set session-level HTTP defaults (timeoutMs, retryCount, retryBackoffMs). Applies to all subsequent calls.',
    inputSchema: {
      type: 'object',
      properties: {
        timeoutMs: { type: 'number', description: 'Default request timeout in ms (default 30000).', minimum: 1, default: 30000 },
        retryCount: { type: 'number', description: 'Default retry count for safe requests (default 0).', minimum: 0, default: 0 },
        retryBackoffMs: { type: 'number', description: 'Base backoff in ms between retries (default 250).', minimum: 0, default: 250 },
      },
    },
  },
  {
    name: 'flux_auth_flow',
    description:
      'Plan a step-by-step auth flow (no network calls). Returns the exact tool calls to run for loginphrase/emergencyphrase -> sign -> (optional resolve gateway -> set base url) -> verifylogin -> set zelidauth.',
    inputSchema: {
      type: 'object',
      properties: {
        useEmergencyPhrase: { type: 'boolean', description: 'If true, prefer /id/emergencyphrase.' },
        gatewayBaseUrl: {
          type: 'string',
          description:
            'Optional: if provided, include a step to resolve the node behind this gateway and then set baseUrl to the recommended direct node URL.',
        },
      },
    },
  },
  {
    name: 'flux_auth_diagnose',
    description: 'Run auth + connectivity preflight checks and return actionable next steps (no mutations).',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'flux_logs_tail',
    description: 'Tail recent logs safely using /apps/applogpolling (prefers incremental since).',
    inputSchema: {
      type: 'object',
      properties: {
        appname: { type: 'string', description: 'Flux app name' },
        lines: { type: 'number', description: 'Max log lines (default 200, max 500).', minimum: 1, maximum: 500, default: 200 },
        since: {
          description: 'Optional since token from previous call.',
          anyOf: [{ type: 'string' }, { type: 'number' }],
        },
        maxBytes: { type: 'number', description: 'Max bytes of returned logs (default 65536).', minimum: 1024, maximum: 1048576, default: 65536 },
      },
      required: ['appname'],
    },
  },
  {
    name: 'flux_app_health_report',
    description: 'Return a compact health/observability summary for an app (inspect/stats/top/monitor/logs).',
    inputSchema: {
      type: 'object',
      properties: {
        appname: { type: 'string', description: 'Flux app name' },
        logsLines: { type: 'number', description: 'Lines for logs preview (default 100, max 300).', minimum: 1, maximum: 300, default: 100 },
        monitorRangeMs: { type: 'number', description: 'Range for monitor history in ms (default 600000).', minimum: 1000, maximum: 86400000, default: 600000 },
      },
      required: ['appname'],
    },
  },
  {
    name: 'flux_set_base_url',
    description: 'Set the Flux node API base URL for this MCP session (e.g. http://<node-ip>:16127).',
    inputSchema: {
      type: 'object',
      properties: { baseUrl: { type: 'string' } },
      required: ['baseUrl'],
    },
  },
  {
    name: 'flux_resolve_gateway_node',
    description:
      'Resolve the current Flux node IP behind a gateway base URL (e.g. https://api.runonflux.io). Uses /flux/info and the response header `fluxnode` when available.',
    inputSchema: {
      type: 'object',
      properties: {
        gatewayBaseUrl: { type: 'string' },
      },
      required: ['gatewayBaseUrl'],
    },
  },
  {
    name: 'flux_set_zelidauth',
    description: 'Set the zelidauth header value (string or object) for this MCP session.',
    inputSchema: {
      type: 'object',
      properties: {
        zelidauth: {
          description: 'Either a JSON string or an object {zelid, signature, loginPhrase}',
        },
      },
      required: ['zelidauth'],
    },
  },
  {
    name: 'flux_set_enterprise_key',
    description: 'Set the enterprise-key header value for this MCP session.',
    inputSchema: {
      type: 'object',
      properties: {
        enterpriseKey: {
          type: 'string',
          description: 'Base64 RSA-encrypted AES session key for enterprise-key header.',
        },
      },
      required: ['enterpriseKey'],
    },
  },
  {
    name: 'flux_enterprise_key_generate',
    description:
      'Generate an AES-256 session key and wrap it with the RSA public key (RSA-OAEP SHA-256) for the enterprise-key header.',
    inputSchema: {
      type: 'object',
      properties: {
        publicKey: {
          type: 'string',
          description: 'Base64 SPKI DER public key from flux_apps_get_public_key.',
        },
      },
      required: ['publicKey'],
    },
  },
  {
    name: 'flux_enterprise_preflight',
    description:
      'Fetch enterprise public key, generate enterprise-key, and optionally verify decrypt. Supports baseUrl fallbacks.',
    inputSchema: {
      type: 'object',
      properties: {
        appname: { type: 'string', description: 'Flux app name.' },
        owner: { type: 'string', description: 'Original app owner (optional). If omitted, uses /apps/apporiginalowner.' },
        baseUrls: { type: 'array', items: { type: 'string' }, description: 'Optional list of base URLs to try in order.' },
        setBaseUrlOnSuccess: {
          type: 'boolean',
          description: 'If true (default), set MCP baseUrl to the successful base URL.',
          default: true,
        },
        setEnterpriseKey: {
          type: 'boolean',
          description: 'If true (default), store enterprise-key in MCP session.',
          default: true,
        },
        verifyDecrypt: {
          type: 'boolean',
          description: 'If true (default), attempt /apps/appspecifications/<app>/true with generated key.',
          default: true,
        },
        timeoutMs: { type: 'number', description: 'Timeout per request in ms (optional).' },
      },
      required: ['appname'],
    },
  },
  {
    name: 'flux_enterprise_decrypt',
    description: 'Decrypt enterprise payload using AES-256-GCM (nonce+ciphertext+tag).',
    inputSchema: {
      type: 'object',
      properties: {
        enterprise: { type: 'string', description: 'Base64 enterprise payload from appspecifications.' },
        aesKeyBase64: { type: 'string', description: 'Base64 AES-256 key returned by flux_enterprise_key_generate.' },
        parseJson: { type: 'boolean', description: 'If true (default), parse decrypted JSON.', default: true },
      },
      required: ['enterprise', 'aesKeyBase64'],
    },
  },
  {
    name: 'flux_clear_zelidauth',
    description: 'Clear the stored zelidauth header value for this MCP session.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'flux_clear_enterprise_key',
    description: 'Clear the stored enterprise-key header value for this MCP session.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'flux_get_login_phrase',
    description: 'Fetch the current login phrase used for ZelID authentication (GET /id/loginphrase).',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'flux_get_emergency_phrase',
    description: 'Fetch an emergency login phrase (GET /id/emergencyphrase). Useful if /id/loginphrase fails due to node health checks.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'flux_verify_login',
    description: 'Verify a signed login phrase and establish a session (POST /id/verifylogin). Does not require confirm/allowMutation.',
    inputSchema: {
      type: 'object',
      properties: {
        zelid: { type: 'string' },
        signature: { type: 'string' },
        loginPhrase: { type: 'string' },
      },
      required: ['zelid', 'signature', 'loginPhrase'],
    },
  },
  {
    name: 'flux_check_privilege',
    description: 'Check privilege level for a zelidauth tuple (POST /id/checkprivilege). Does not require confirm/allowMutation.',
    inputSchema: {
      type: 'object',
      properties: {
        zelid: { type: 'string' },
        signature: { type: 'string' },
        loginPhrase: { type: 'string' },
      },
      required: ['zelid', 'signature', 'loginPhrase'],
    },
  },
  {
    name: 'flux_build_zelidauth',
    description: 'Build a zelidauth header JSON string from zelid + signature + loginPhrase.',
    inputSchema: {
      type: 'object',
      properties: {
        zelid: { type: 'string' },
        signature: { type: 'string' },
        loginPhrase: { type: 'string' },
      },
      required: ['zelid', 'signature', 'loginPhrase'],
    },
  },
  {
    name: 'flux_build_message_to_sign',
    description: 'Build the canonical message-to-sign string used by Flux app register/update payloads.',
    inputSchema: {
      type: 'object',
      properties: {
        type: { type: 'string', enum: ['fluxappregister', 'fluxappupdate', 'zelappregister', 'zelappupdate'] },
        version: { type: 'number' },
        spec: { type: 'object', additionalProperties: true },
        timestamp: { type: 'number' },
        includeMessageToSign: {
          type: 'boolean',
          description:
            'If true, include the full messageToSign inline (can be very large). Default false; prefer messageToSignResourceUri.',
          default: false,
        },
      },
      required: ['type', 'version', 'spec', 'timestamp'],
    },
  },
  {
    name: 'flux_build_zelcore_sign_link',
    description: 'Build a Zelcore deeplink for signing a message (zel:?action=sign&message=...).',
    inputSchema: {
      type: 'object',
      properties: {
        message: { type: 'string', description: 'Raw message to sign (messageToSignRaw).' },
        messageResourceUri: {
          type: 'string',
          description:
            'Resource URI containing the raw message to sign (preferred: avoids pasting messageToSign into chat).',
        },
        icon: {
          type: 'string',
          description: 'Optional icon URL (default ZelID icon).',
        },
        callback: {
          type: 'string',
          description: 'Optional callback URL (will be url-encoded).',
        },
        useFluxStorage: {
          type: 'boolean',
          description: 'If true, upload long messages to Flux Storage and sign FLUX_URL=... (requires confirm=true).',
          default: false,
        },
        confirm: { type: 'boolean' },
      },
      anyOf: [{ required: ['message'] }, { required: ['messageResourceUri'] }],
    },
  },
  {
    name: 'flux_write_message_to_sign',
    description: 'Write a messageToSign string to a local file (useful to avoid terminal wrapping). Requires confirm=true.',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'File path to write (absolute or relative to cwd).' },
        messageToSign: { type: 'string', description: 'Raw messageToSign bytes to write.' },
        overwrite: { type: 'boolean', description: 'If true, overwrite existing file (default false).' },
        confirm: { type: 'boolean' },
      },
      required: ['path', 'messageToSign', 'confirm'],
    },
  },
  {
    name: 'flux_apps_signing_playbook',
    description: 'Guided signing helper for app registration/update: builds messageToSign and suggests next tool calls.',
    inputSchema: {
      type: 'object',
      properties: {
        type: { type: 'string', enum: ['fluxappregister', 'fluxappupdate', 'zelappregister', 'zelappupdate'] },
        version: { type: 'number' },
        spec: { type: 'object', additionalProperties: true },
        timestamp: { type: 'number', description: 'Unix ms epoch (optional; defaults to now)' },
        includeMessageToSign: {
          type: 'boolean',
          description:
            'If true, include the full messageToSign inline (can be very large). Default false; prefer messageToSignResourceUri.',
          default: false,
        },
        includeNextActionArgs: {
          type: 'boolean',
          description:
            'If true, nextActions will include full argument scaffolds (includes spec, can be very large). Default false.',
          default: false,
        },
      },
      required: ['type', 'version', 'spec'],
    },
  },

  {
    name: 'flux_list_endpoint_categories',
    description: 'List endpoint categories and route counts (from the bundled endpoints inventory).',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'flux_search_endpoints',
    description: 'Search endpoints by keyword (path/comment/access). Optionally filter by category/method/access.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search text (optional)' },
        category: { type: 'string', description: 'Filter by category (optional)' },
        access: { type: 'string', description: 'Filter by access label (optional)' },
        method: { type: 'string', description: 'Filter by HTTP method (optional)' },
        limit: { type: 'number', description: 'Max results (default 50, max 200)' },
      },
    },
  },
  {
    name: 'flux_explorer_height_info',
    description: 'Fetch explorer scanned height and provide best-effort height-to-time conversion hints.',
    inputSchema: {
      type: 'object',
      properties: {
        secondsPerBlock: { type: 'number', description: 'Override seconds per block (default 30)' }
      },
    },
  },
  {
    name: 'flux_explorer_status',
    description: 'Table-first explorer status summary (sync, height, key signals).',
    inputSchema: {
      type: 'object',
      properties: {
        secondsPerBlock: { type: 'number', description: 'Override seconds per block (default 30)' }
      },
    },
  },
  {
    name: 'flux_explorer_balance_summary',
    description: 'Table-first balance summary for a Flux address (explorer wrapper).',
    inputSchema: {
      type: 'object',
      properties: {
        address: { type: 'string', description: 'Flux address' },
      },
      required: ['address'],
    },
  },
  {
    name: 'flux_daemon_call',
    description: 'Call a safe, read-only subset of daemon RPC proxies (strict allowlist + redaction).',
    inputSchema: {
      type: 'object',
      properties: {
        method: { type: 'string', description: 'Daemon method name (e.g. getinfo)' },
        params: { type: 'array', items: { anyOf: [{ type: 'string' }, { type: 'number' }, { type: 'boolean' }, { type: 'null' }] }, description: 'Positional params array (strings/numbers/bools/null only)' },
        redactTxHex: { type: 'boolean', description: 'If true (default), redacts long hex strings.', default: true },
        confirm: { type: 'boolean', description: 'Required if allowMutation is true.' },
        allowMutation: { type: 'boolean', description: 'Must stay false; reserved for future explicit mutation allowlist.' },
      },
      required: ['method'],
    },
  },
  {
    name: 'flux_daemon_get_info',
    description: 'Convenience wrapper for daemon getinfo (read-only).',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'flux_daemon_get_blockchain_info',
    description: 'Convenience wrapper for daemon getblockchaininfo (read-only).',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'flux_daemon_get_network_info',
    description: 'Convenience wrapper for daemon getnetworkinfo (read-only).',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'flux_daemon_get_peer_info',
    description: 'Convenience wrapper for daemon getpeerinfo (read-only).',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'flux_daemon_get_mempool_info',
    description: 'Convenience wrapper for daemon getmempoolinfo (read-only).',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'flux_daemon_get_raw_mempool',
    description: 'Convenience wrapper for daemon getrawmempool (read-only).',
    inputSchema: {
      type: 'object',
      properties: {
        verbose: { type: 'boolean', description: 'If true, request verbose mempool details (default false).' },
      },
    },
  },
  {
    name: 'flux_daemon_get_block_count',
    description: 'Convenience wrapper for daemon getblockcount (read-only).',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'flux_daemon_get_connection_count',
    description: 'Convenience wrapper for daemon getconnectioncount (read-only).',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'flux_daemon_get_difficulty',
    description: 'Convenience wrapper for daemon getdifficulty (read-only).',
    inputSchema: { type: 'object', properties: {} },
  },

  {
    name: 'flux_explorer_restart',
    description: 'Restart explorer (GET /explorer/restart). Requires confirm=true.',
    inputSchema: { type: 'object', properties: { confirm: { type: 'boolean' } }, required: ['confirm'] },
  },
  {
    name: 'flux_explorer_stop',
    description: 'Stop explorer (GET /explorer/stop). Requires confirm=true.',
    inputSchema: { type: 'object', properties: { confirm: { type: 'boolean' } }, required: ['confirm'] },
  },
  {
    name: 'flux_explorer_reindex',
    description: 'Reindex explorer (GET /explorer/reindex). Requires confirm=true.',
    inputSchema: {
      type: 'object',
      properties: {
        reindexapps: { type: 'boolean', description: 'If true, also reindex apps (default false).' },
        confirm: { type: 'boolean' },
      },
      required: ['confirm'],
    },
  },
  {
    name: 'flux_explorer_rescan',
    description: 'Rescan explorer (GET /explorer/rescan). Requires confirm=true.',
    inputSchema: {
      type: 'object',
      properties: {
        blockheight: { type: 'number', description: 'Optional starting blockheight.' },
        rescanapps: { type: 'boolean', description: 'If true, also rescan apps (default false).' },
        confirm: { type: 'boolean' },
      },
      required: ['confirm'],
    },
  },
  {
    name: 'flux_backup_get_volume_data',
    description: 'Fetch backup volume data for an app component (read-only).',
    inputSchema: {
      type: 'object',
      properties: {
        appname: { type: 'string' },
        component: { type: 'string' },
        fields: { type: 'string', description: 'Optional fields selector (comma-separated)' },
        multiplier: { type: 'number', description: 'Optional size multiplier' },
        decimal: { type: 'number', description: 'Optional decimal precision' },
      },
    },
  },
  {
    name: 'flux_backup_get_remote_file_size',
    description: 'Get remote file size for a URL (read-only).',
    inputSchema: {
      type: 'object',
      properties: {
        fileurl: { type: 'string' },
        appname: { type: 'string' },
        multiplier: { type: 'number' },
        decimal: { type: 'number' },
        number: { type: 'number' },
      },
      required: ['fileurl'],
    },
  },
  {
    name: 'flux_backup_list_local',
    description: 'List local backup files (read-only).',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string' },
        appname: { type: 'string' },
        multiplier: { type: 'number' },
        decimal: { type: 'number' },
        number: { type: 'number' },
      },
    },
  },
  {
    name: 'flux_backup_remove_file',
    description: 'Remove a local backup file. Requires confirm=true.',
    inputSchema: {
      type: 'object',
      properties: {
        filepath: { type: 'string' },
        appname: { type: 'string' },
        confirm: { type: 'boolean' },
      },
      required: ['filepath', 'confirm'],
    },
  },
  {
    name: 'flux_backup_download_local_file',
    description: 'Download a local backup file as base64. Requires confirm=true.',
    inputSchema: {
      type: 'object',
      properties: {
        filepath: { type: 'string' },
        appname: { type: 'string' },
        maxBytes: { type: 'number', description: 'Max bytes to download (default 1048576)' },
        confirm: { type: 'boolean' },
      },
      required: ['filepath', 'confirm'],
    },
  },
  {
    name: 'flux_ioutils_file_upload_from_url',
    description:
      'Download a remote file (from fileurl) and upload it into an app volume via IOUtils.fileUpload (POST /ioutils/fileupload). Requires confirm=true. Note: This proxies the content through the MCP server; prefer flux_apps_append_restore_task type=remote when possible.',
    inputSchema: {
      type: 'object',
      properties: {
        type: {
          type: 'string',
          description: 'Upload type (e.g. backup). When type=backup, uploads into <mount>/backup/upload/.',
        },
        appname: { type: 'string' },
        component: { type: 'string' },
        folder: { type: 'string', description: 'Folder path or "null" for backup uploads.' },
        filename: { type: 'string' },
        fileurl: { type: 'string', description: 'Remote URL to download and then upload.' },
        timeoutMs: { type: 'number', description: 'Upload request timeout in ms (default: 15 minutes).', minimum: 1 },
        maxDownloadBytes: { type: 'number', description: 'Max bytes to download (default: 1GB).', minimum: 1 },
        allowProxy: {
          type: 'boolean',
          description:
            'If true, allow using gateway/proxy base URLs (often unreliable for this endpoint). Default: false (recommended).',
        },
        confirm: { type: 'boolean' },
      },
      required: ['type', 'appname', 'component', 'filename', 'fileurl', 'confirm'],
    },
  },
  {
    name: 'flux_maintenance_checklist',
    description: 'Return a guided maintenance checklist with nextActions scaffolds.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
     name: 'flux_apps_append_backup_task',
     description:
       'Append a backup task to the queue (POST /apps/appendbackuptask). Requires confirm=true. If backup is omitted, defaults to backing up all components.',
     inputSchema: {
       type: 'object',
       properties: {
         appname: { type: 'string' },
         backup: {
           type: 'array',
           items: { type: 'object', additionalProperties: true },
           description: 'Optional array of {component, backup:true/false}. Defaults to all components with backup=true.',
         },
         timeoutMs: { type: 'number', description: 'Request timeout in ms (default 10 minutes).', minimum: 1 },
         confirm: { type: 'boolean' },
       },
       required: ['appname', 'confirm'],
     },
   },
  {
     name: 'flux_apps_append_restore_task',
     description:
       'Append a restore task to the queue (POST /apps/appendrestoretask). Requires confirm=true. If restore is omitted, defaults to restoring all components.',
     inputSchema: {
       type: 'object',
       properties: {
         appname: { type: 'string' },
         restore: {
           type: 'array',
           items: { type: 'object', additionalProperties: true },
           description: 'Optional array of {component, restore:true/false, url?}. Defaults to all components with restore=true and url="".',
         },
         type: { type: 'string', enum: ['local', 'remote', 'upload'] },
         timeoutMs: { type: 'number', description: 'Request timeout in ms (default 10 minutes).', minimum: 1 },
         confirm: { type: 'boolean' },
       },
       required: ['appname', 'type', 'confirm'],
     },
   },

  // Generic request (escape hatch)
  {
    name: 'flux_request',
    description: 'Call any Flux node API endpoint. Mutations are blocked unless allowMutation=true. Prefer dedicated tools for workflows; use responseType=base64 for file downloads.',
    inputSchema: {
      type: 'object',
      properties: {
        method: { type: 'string', description: 'HTTP method (default GET)' },
        path: { type: 'string', description: 'API path (e.g. /flux/info)' },
        query: {
          type: 'object',
          description: 'Query parameters (optional)',
          additionalProperties: true,
        },
        body: {
          description: 'JSON body for POST/PUT/PATCH (optional)',
        },
        allowMutation: {
          type: 'boolean',
          description: 'Set true to allow mutating requests (required for most POSTs and state-changing GETs).',
        },
        zelidauth: {
          description: 'Override zelidauth for this request (optional). Uses stored value by default.',
        },
        useStoredZelidauth: {
          type: 'boolean',
          description: 'If false, do not send stored zelidauth header (default true).',
        },
        enterpriseKey: {
          type: 'string',
          description: 'Override enterprise-key for this request (optional). Uses stored value by default.',
        },
        useStoredEnterpriseKey: {
          type: 'boolean',
          description: 'If false, do not send stored enterprise-key header (default true).',
        },
        timeoutMs: {
          type: 'number',
          description: 'Request timeout in ms (optional).',
        },
        responseType: {
          type: 'string',
          enum: ['auto', 'text', 'base64'],
          description: 'Response handling mode (default auto).',
        },
        maxBytes: {
          type: 'number',
          description: 'Max bytes for responseType=base64 (default 1048576).',
        },
        includeBody: {
          type: 'boolean',
          description:
            'If true, also include the full response body in tool output (can be large). Default false (response is stored as a resource_link).',
        },
      },
      required: ['path'],
    },
  },

  // Node / platform
  {
    name: 'flux_node_health',
    description: 'Fetch node health summary (version + info + isarcaneos).',
    inputSchema: { type: 'object', properties: {} },
  },

  // App discovery
  {
    name: 'flux_apps_list_running',
    description: 'List running apps on the node (GET /apps/listrunningapps).',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'flux_apps_list_all',
    description: 'List all apps known to the node (GET /apps/listallapps).',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'flux_apps_list_global_specs',
    description:
      'List global app specifications (GET /apps/globalappsspecifications). Use owner to list apps registered under a ZelID.',
    inputSchema: {
      type: 'object',
      properties: {
        hash: { type: 'string', description: 'Optional message hash filter' },
        owner: { type: 'string', description: 'Optional owner ZelID filter' },
        appname: { type: 'string', description: 'Optional app name filter' },
      },
    },
  },
  {
    name: 'flux_apps_global_status',
    description:
      'Correlate global app specs with message propagation (temporary/permanent) for a ZelID or appname; returns table + resource_link.',
    inputSchema: {
      type: 'object',
      properties: {
        zelid: { type: 'string', description: 'Owner ZelID filter. If omitted, uses stored zelidauth.zelid when available.' },
        appname: { type: 'string', description: 'Optional appname filter.' },
        includeExpired: { type: 'boolean', description: 'Include expired apps (default false).', default: false },
        limit: { type: 'number', description: 'Max rows (default 50, max 200).', minimum: 1, maximum: 200, default: 50 },
      },
    },
  },
  {
    name: 'flux_apps_troubleshoot',
    description: 'Guided troubleshooting for an app name: global registry, locations/installing/errors, node-local runtime state, and logs pointers.',
    inputSchema: {
      type: 'object',
      properties: {
        appname: { type: 'string', description: 'Flux app name' },
        deep: { type: 'boolean', description: 'If true, also attempts app health report endpoints (may require FluxTeam privilege).', default: false },
      },
      required: ['appname'],
    },
  },
  {
    name: 'flux_apps_list_by_zelid_with_expiry',
    description:
      'List globally registered apps for a ZelID with expiration computed from chain height + Flux rules (PON fork adjustment).',
    inputSchema: {
      type: 'object',
      properties: {
        zelid: { type: 'string', description: 'Owner ZelID. If omitted, uses stored zelidauth.zelid when available.' },
        includeExpired: { type: 'boolean', description: 'Include expired apps (default false).', default: false },
        estimateTimeRemaining: { type: 'boolean', description: 'If true, includes a best-effort ~time remaining column (default false).', default: false },
        secondsPerBlock: { type: 'number', description: 'Optional override used when estimateTimeRemaining is true (default 30).' },
        limit: { type: 'number', description: 'Max rows in the table preview (default 50, max 200).', minimum: 1, maximum: 200, default: 50 },
      },
    },
  },
  {
    name: 'flux_apps_get_spec',
    description: 'Fetch app specification (GET /apps/appspecifications/<appname>). For enterprise specs with decrypt=true, send enterprise-key.',
    inputSchema: {
      type: 'object',
      properties: {
        appname: { type: 'string', description: 'Flux app name' },
        decrypt: { type: 'boolean', description: 'Optional decrypt flag for enterprise specs (requires enterprise-key header).' },
      },
      required: ['appname'],
    },
  },
  {
    name: 'flux_apps_get_spec_full',
    description:
      'Fetch an app spec; for v8+ enterprise apps, performs the Arcane enterprise decrypt flow and returns decrypted compose/contacts (requires zelidauth + Arcane node).',
    inputSchema: {
      type: 'object',
      properties: {
        appname: { type: 'string', description: 'Flux app name' },
        owner: { type: 'string', description: 'Original app owner (optional). If omitted, uses /apps/apporiginalowner.' },
        baseUrls: {
          type: 'array',
          items: { type: 'string' },
          description:
            'Optional base URLs to try for Arcane/enterprise operations (e.g. ["http://<ip>:16127", "https://<ip-with-dashes>-16127.node.api.runonflux.io"]).',
        },
        timeoutMs: { type: 'number', description: 'Optional request timeout override.' },
        setBaseUrlOnSuccess: { type: 'boolean', description: 'If true (default), set MCP baseUrl to the successful Arcane node URL.' },
      },
      required: ['appname'],
    },
  },
  {
    name: 'flux_apps_get_public_key',
    description: 'Fetch RSA public key for enterprise encryption (POST /apps/getpublickey). Requires zelidauth and Arcane node.',
    inputSchema: {
      type: 'object',
      properties: {
        owner: { type: 'string', description: 'Original app owner (ZelID) used for enterprise encryption.' },
        name: { type: 'string', description: 'App name.' },
      },
      required: ['owner', 'name'],
    },
  },
  {
    name: 'flux_apps_get_owner',
    description: 'Fetch app owner (GET /apps/appowner/<appname>).',
    inputSchema: {
      type: 'object',
      properties: {
        appname: { type: 'string' },
      },
      required: ['appname'],
    },
  },
  {
    name: 'flux_apps_registration_information',
    description: 'Fetch registration rules and parameters (GET /apps/registrationinformation).',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'flux_apps_deployment_information',
    description: 'Fetch deployment parameters (GET /apps/deploymentinformation).',
    inputSchema: { type: 'object', properties: {} },
  },

  // Spec helpers
  {
    name: 'flux_generate_app_spec_v8',
    description: 'Generate a minimal Flux app spec (version 8) for a single-component app.',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'App name (lowercase letters/digits/hyphen)' },
        owner: { type: 'string', description: 'Owner ZelID / Flux address' },
        repotag: { type: 'string', description: 'Docker image repo:tag' },
        appDescription: { type: 'string', description: 'Top-level description (optional)' },
        componentName: { type: 'string', description: 'Component name (default: web)' },
        componentDescription: { type: 'string', description: 'Component description (optional)' },
        ports: { type: 'array', items: { type: 'number' }, description: 'External ports (optional)' },
        containerPorts: { type: 'array', items: { type: 'number' }, description: 'Container ports (optional)' },
        domains: { type: 'array', items: { type: 'string' }, description: 'Domains array (optional)' },
        environment: {
          description: 'Environment variables (object {KEY:VALUE} or ["KEY=VALUE"]) (optional).',
        },
        commands: { type: 'array', items: { type: 'string' }, description: 'Docker commands array (optional)' },
        containerData: { type: 'string', description: 'Persistent mount (default: /data)' },
        cpu: { type: 'number', description: 'CPU cores (default 1)' },
        ram: { type: 'number', description: 'RAM in MB (default 2000)' },
        hdd: { type: 'number', description: 'Disk in GB (default 10)' },
        instances: { type: 'number', description: 'Instances (default 3)' },
        staticip: { type: 'boolean', description: 'Static IP request (default false)' },
        enterprise: { type: 'string', description: 'Enterprise contract (default empty)' },
      },
      required: ['name', 'owner', 'repotag'],
    },
  },
  {
    name: 'flux_git_deploy_generate_spec_v8',
    description:
      'Generate a v8 app spec for Flux Git deployments (Orbit). Uses runonflux/orbit:latest and Orbit env vars (GIT_REPO_URL, APP_PORT, etc). Optionally enterprise-encrypts contacts+compose (recommended for private repos).',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'App name (lowercase letters/digits/hyphen)' },
        owner: { type: 'string', description: 'Owner ZelID / Flux address' },
        description: { type: 'string', description: 'Top-level description (optional)' },
        repoUrl: { type: 'string', description: 'Repository URL (https://github.com/... or gitlab/bitbucket)' },
        branch: { type: 'string', description: 'Git branch (default main)' },
        projectPath: { type: 'string', description: 'Monorepo project path (default /)' },
        repoUsername: { type: 'string', description: 'Username for private repos (optional)' },
        repoToken: { type: 'string', description: 'Token/password for private repos (optional; will be embedded into GIT_REPO_URL and must be enterprise-encrypted)' },
        contacts: { type: 'array', items: { type: 'string' }, description: 'Contact emails or F_S_CONTACTS=... references (optional)' },
        appPort: { type: 'number', description: 'Internal app port (default 3000)' },
        exposedPort: { type: 'number', description: 'External app port (optional; random safe port if omitted)' },
        managementPort: { type: 'number', description: 'External Orbit management port (optional; random safe port if omitted)' },
        domain: { type: 'string', description: 'Optional custom domain for the app port' },
        instances: { type: 'number', description: 'Instances (default 3)' },
        cpu: { type: 'number', description: 'CPU cores (default 1)' },
        ramMb: { type: 'number', description: 'RAM in MB (default 2000)' },
        hddGb: { type: 'number', description: 'Disk in GB (default 10)' },
        expireBlocks: { type: 'number', description: 'Expire in blocks (default 88000 ~= 1 month post-fork)' },
        geolocation: { type: 'array', items: { type: 'string' }, description: 'Geolocation codes (optional)' },
        environment: { description: 'Extra environment variables (object {KEY:VALUE} or ["KEY=VALUE"]) (optional).' },
        enterprise: { type: 'boolean', description: 'If true, encrypt contacts+compose into spec.enterprise and clear contacts/compose (recommended for private repos).', default: false },
        publicKeyBase64: { type: 'string', description: 'Optional RSA public key (base64 SPKI DER). If omitted, calls /apps/getpublickey (requires zelidauth + Arcane node).' },
        repotag: { type: 'string', description: `Optional Orbit image override (default ${GIT_DEPLOY_REPOTAG}).` },
        staticip: { type: 'boolean', description: 'Static IP request (default false)' },
        confirm: { type: 'boolean', description: 'Required when supplying repoToken (sensitive).' },
      },
      required: ['name', 'owner', 'repoUrl'],
    },
  },
  {
    name: 'flux_git_deploy_plan_registration',
    description:
      'One-shot: generate a Flux Git deployments (Orbit) v8 spec, verify + price it, and build message-to-sign + payload scaffold for registration. Designed to keep outputs token-efficient.',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'App name (lowercase letters/digits/hyphen)' },
        owner: { type: 'string', description: 'Owner ZelID / Flux address' },
        description: { type: 'string', description: 'Top-level description (optional)' },
        repoUrl: { type: 'string', description: 'Repository URL (https://github.com/... or gitlab/bitbucket)' },
        branch: { type: 'string', description: 'Git branch (default main)' },
        projectPath: { type: 'string', description: 'Monorepo project path (default /)' },
        repoUsername: { type: 'string', description: 'Username for private repos (optional)' },
        repoToken: { type: 'string', description: 'Token/password for private repos (optional; will be embedded into GIT_REPO_URL and must be enterprise-encrypted)' },
        contacts: { type: 'array', items: { type: 'string' }, description: 'Contact emails or F_S_CONTACTS=... references (optional)' },
        appPort: { type: 'number', description: 'Internal app port (default 3000)' },
        exposedPort: { type: 'number', description: 'External app port (optional; random safe port if omitted)' },
        managementPort: { type: 'number', description: 'External Orbit management port (optional; random safe port if omitted)' },
        domain: { type: 'string', description: 'Optional custom domain for the app port' },
        instances: { type: 'number', description: 'Instances (default 3)' },
        cpu: { type: 'number', description: 'CPU cores (default 1)' },
        ramMb: { type: 'number', description: 'RAM in MB (default 2000)' },
        hddGb: { type: 'number', description: 'Disk in GB (default 10)' },
        expireBlocks: { type: 'number', description: 'Expire in blocks (default 88000 ~= 1 month post-fork)' },
        geolocation: { type: 'array', items: { type: 'string' }, description: 'Geolocation codes (optional)' },
        environment: { description: 'Extra environment variables (object {KEY:VALUE} or ["KEY=VALUE"]) (optional).' },
        enterprise: { type: 'boolean', description: 'If true, encrypt contacts+compose into spec.enterprise and clear contacts/compose (recommended for private repos).', default: false },
        publicKeyBase64: { type: 'string', description: 'Optional RSA public key (base64 SPKI DER). If omitted, calls /apps/getpublickey (requires zelidauth + Arcane node).' },
        repotag: { type: 'string', description: `Optional Orbit image override (default ${GIT_DEPLOY_REPOTAG}).` },
        staticip: { type: 'boolean', description: 'Static IP request (default false)' },
        timestamp: { type: 'number', description: 'Optional ms epoch timestamp (default now)' },
        typeVersion: { type: 'number', description: 'Message type version (default 1)' },
        confirm: { type: 'boolean', description: 'Required when supplying repoToken (sensitive).' },
      },
      required: ['name', 'owner', 'repoUrl'],
    },
  },

  // Register/update signing workflow
  {
    name: 'flux_apps_verify_registration_spec',
    description: 'Canonicalize and validate a v8 spec for registration (POST /apps/verifyappregistrationspecifications).',
    inputSchema: {
      type: 'object',
      properties: {
        spec: { type: 'object', description: 'App specification JSON object', additionalProperties: true },
      },
      required: ['spec'],
    },
  },
  {
    name: 'flux_apps_verify_update_spec',
    description: 'Canonicalize and validate a v8 spec for update (POST /apps/verifyappupdatespecifications).',
    inputSchema: {
      type: 'object',
      properties: {
        spec: { type: 'object', description: 'App specification JSON object', additionalProperties: true },
      },
      required: ['spec'],
    },
  },
  {
    name: 'flux_apps_calculate_price',
    description: 'Calculate price in FLUX for a v8 spec (POST /apps/calculateprice).',
    inputSchema: {
      type: 'object',
      properties: {
        spec: { type: 'object', description: 'App specification JSON object', additionalProperties: true },
      },
      required: ['spec'],
    },
  },
  {
    name: 'flux_apps_plan_registration',
    description: 'Verify spec + calculate price + build message-to-sign + payload scaffold for app registration. Includes requiresAuth guidance when zelidauth is missing.',
    inputSchema: {
      type: 'object',
      properties: {
        spec: { type: 'object', additionalProperties: true },
        timestamp: { type: 'number', description: 'Optional ms epoch timestamp (default now)' },
        typeVersion: { type: 'number', description: 'Message type version (default 1)' },
      },
      required: ['spec'],
    },
  },
  {
    name: 'flux_apps_register',
    description: 'Submit app registration (POST /apps/appregister). Requires zelidauth and an owner signature over the message-to-sign.',
    inputSchema: {
      type: 'object',
      properties: {
        spec: { type: 'object', additionalProperties: true },
        signature: { type: 'string', description: 'Owner signature over (type+version+spec+timestamp)' },
        timestamp: { type: 'number', description: 'Timestamp used to build the message-to-sign (ms epoch)' },
        verifyFirst: { type: 'boolean', description: 'If true (default), canonicalize spec before submitting' },
        typeVersion: { type: 'number', description: 'Message type version (default 1)' },
      },
      required: ['spec', 'signature', 'timestamp'],
    },
  },
  {
    name: 'flux_apps_plan_update',
    description: 'Verify update spec + calculate price + build message-to-sign + payload scaffold for app update. Includes requiresAuth guidance when zelidauth is missing.',
    inputSchema: {
      type: 'object',
      properties: {
        spec: { type: 'object', additionalProperties: true },
        timestamp: { type: 'number', description: 'Optional ms epoch timestamp (default now)' },
        typeVersion: { type: 'number', description: 'Message type version (default 1)' },
      },
      required: ['spec'],
    },
  },
  {
    name: 'flux_apps_plan_renew',
    description:
      'Plan an update to extend app expiration. Computes expire using chain height + policy, verifies spec, calculates price, and builds message-to-sign.',
    inputSchema: {
      type: 'object',
      properties: {
        appname: { type: 'string', description: 'Flux app name.' },
        owner: { type: 'string', description: 'Optional owner filter for global spec lookup.' },
        spec: { type: 'object', additionalProperties: true, description: 'Optional app spec to update (preferred for enterprise apps).' },
        weeks: { type: 'number', description: 'Number of weeks to add (default 1).' },
        blocksToAdd: { type: 'number', description: 'Override blocks to add (if set, weeks ignored).' },
        mode: {
          type: 'string',
          enum: ['from_now', 'add_to_remaining'],
          description: 'from_now = expire = blocksToAdd; add_to_remaining = expire = blocksRemaining + blocksToAdd (default).',
        },
        blocksPerWeek: { type: 'number', description: 'Blocks per week (default 22000).' },
        secondsPerBlock: { type: 'number', description: 'Seconds per block for ETA display (default 30).' },
        timestamp: { type: 'number', description: 'Optional ms epoch timestamp (default now).' },
        typeVersion: { type: 'number', description: 'Message type version (default 1).' },
      },
      required: ['appname'],
    },
  },
  {
    name: 'flux_apps_update',
    description: 'Submit app update (POST /apps/appupdate). Requires zelidauth and an owner signature over the message-to-sign.',
    inputSchema: {
      type: 'object',
      properties: {
        spec: { type: 'object', additionalProperties: true },
        signature: { type: 'string' },
        timestamp: { type: 'number' },
        verifyFirst: { type: 'boolean', description: 'If true (default), canonicalize spec before submitting' },
        typeVersion: { type: 'number', description: 'Message type version (default 1)' },
        includePayment: { type: 'boolean', description: 'If true (default), include payment info.', default: true },
      },
      required: ['spec', 'signature', 'timestamp'],
    },
  },
   {
     name: 'flux_apps_get_messages',
     description: 'Fetch temporary/permanent messages for a registration/update hash.',
     inputSchema: {
       type: 'object',
       properties: {
         hash: { type: 'string' },
         kind: { type: 'string', enum: ['temporary', 'permanent', 'both'], description: 'Default both' },
       },
       required: ['hash'],
     },
   },
   {
     name: 'flux_apps_wait_for_propagation',
     description: 'Poll temporary/permanent messages for a hash until it appears or attempts exhausted.',
     inputSchema: {
       type: 'object',
       properties: {
         hash: { type: 'string' },
         attempts: { type: 'number', description: 'Poll attempts (default 10).' },
         intervalMs: { type: 'number', description: 'Delay between polls in ms (default 3000).' },
         timeoutMs: { type: 'number', description: 'Timeout per request in ms (optional).' },
       },
       required: ['hash'],
     },
   },
   {
     name: 'flux_apps_register_and_verify',
     description: 'Submit app registration and poll for message propagation. Returns ok=true when broadcast succeeds; use status to track phases.',
     inputSchema: {
       type: 'object',
       properties: {
         spec: { type: 'object', additionalProperties: true },
         signature: { type: 'string', description: 'Owner signature over (type+version+spec+timestamp)' },
         timestamp: { type: 'number', description: 'Timestamp used to build the message-to-sign (ms epoch)' },
         verifyFirst: { type: 'boolean', description: 'If true (default), canonicalize spec before submitting' },
         typeVersion: { type: 'number', description: 'Message type version (default 1)' },
       attempts: { type: 'number', description: 'Poll attempts (default 10)' },
       intervalMs: { type: 'number', description: 'Delay between polls in ms (default 3000)' },
        poll: { type: 'boolean', description: 'If false, skip polling (return hash immediately).', default: true },
        pollTimeoutMs: { type: 'number', description: 'Timeout per polling request in ms (optional).' },
        verifyGlobal: { type: 'boolean', description: 'If true, also verify /apps/globalappsspecifications contains the app', default: true },
        confirm: { type: 'boolean', description: 'Required to submit registration' },
      },
      required: ['spec', 'signature', 'timestamp', 'confirm'],
    },
   },
   {
     name: 'flux_apps_test_install',
     description: 'Test install a registered app by message hash (GET /apps/testappinstall/<hash>). Parses streaming progress output. Requires confirm=true.',
     inputSchema: {
       type: 'object',
       properties: {
         hash: { type: 'string', description: 'Registration message hash' },
         timeoutMs: { type: 'number', description: 'Request timeout in ms (default 120000)' },
         confirm: { type: 'boolean', description: 'Required to run test install' },
       },
       required: ['hash', 'confirm'],
     },
   },
   {
     name: 'flux_apps_update_and_verify',
     description: 'Submit app update and poll for message propagation to permanent messages.',
     inputSchema: {
       type: 'object',
       properties: {
         spec: { type: 'object', additionalProperties: true },
         signature: { type: 'string', description: 'Owner signature over (type+version+spec+timestamp)' },
         timestamp: { type: 'number', description: 'Timestamp used to build the message-to-sign (ms epoch)' },
         verifyFirst: { type: 'boolean', description: 'If true (default), canonicalize spec before submitting' },
         typeVersion: { type: 'number', description: 'Message type version (default 1)' },
        attempts: { type: 'number', description: 'Poll attempts (default 10)' },
        intervalMs: { type: 'number', description: 'Delay between polls in ms (default 3000)' },
        poll: { type: 'boolean', description: 'If false, skip polling (return hash immediately).', default: true },
        pollTimeoutMs: { type: 'number', description: 'Timeout per polling request in ms (optional).' },
        verifyGlobal: { type: 'boolean', description: 'If true, also verify /apps/globalappsspecifications contains the app', default: true },
        includePayment: { type: 'boolean', description: 'If true (default), include payment info.', default: true },
        confirm: { type: 'boolean', description: 'Required to submit update' },
      },
      required: ['spec', 'signature', 'timestamp', 'confirm'],
    },
   },
 
   // App lifecycle (mutating)

  {
    name: 'flux_apps_start',
    description: 'Start an app or component (GET /apps/appstart). Requires confirm=true.',
    inputSchema: {
      type: 'object',
      properties: {
        appname: { type: 'string' },
        global: { type: 'boolean', description: 'If true, request a global start (optional)' },
        confirm: { type: 'boolean', description: 'Required for lifecycle actions' },
      },
      required: ['appname', 'confirm'],
    },
  },
  {
    name: 'flux_apps_stop',
    description: 'Stop an app or component (GET /apps/appstop). Requires confirm=true.',
    inputSchema: {
      type: 'object',
      properties: {
        appname: { type: 'string' },
        global: { type: 'boolean' },
        confirm: { type: 'boolean' },
      },
      required: ['appname', 'confirm'],
    },
  },
  {
    name: 'flux_apps_restart',
    description: 'Restart an app or component (GET /apps/apprestart). Requires confirm=true.',
    inputSchema: {
      type: 'object',
      properties: {
        appname: { type: 'string' },
        global: { type: 'boolean' },
        confirm: { type: 'boolean' },
      },
      required: ['appname', 'confirm'],
    },
  },
  {
    name: 'flux_apps_redeploy',
    description: 'Redeploy an app (GET /apps/redeploy). Requires confirm=true.',
    inputSchema: {
      type: 'object',
      properties: {
        appname: { type: 'string' },
        force: { type: 'boolean', description: 'Force redeploy (optional)' },
        global: { type: 'boolean', description: 'Global redeploy (optional)' },
        timeoutMs: { type: 'number', description: 'Request timeout in ms (optional).' },
        confirm: { type: 'boolean' },
      },
      required: ['appname', 'confirm'],
    },
  },
  {
    name: 'flux_apps_redeploy_component',
    description: 'Redeploy a component (GET /apps/redeploycomponent). Requires confirm=true.',
    inputSchema: {
      type: 'object',
      properties: {
        appname: { type: 'string' },
        component: { type: 'string' },
        force: { type: 'boolean', description: 'Force redeploy (optional)' },
        timeoutMs: { type: 'number', description: 'Request timeout in ms (optional).' },
        confirm: { type: 'boolean' },
      },
      required: ['appname', 'component', 'confirm'],
    },
  },

  // App observability
  {
    name: 'flux_apps_resolve_runtime_target',
    description:
      'Resolve an app name to a node baseUrl (preserving port) and candidate container names for observability (logs/stats/top).',
    inputSchema: {
      type: 'object',
      properties: {
        appname: { type: 'string', description: 'Global Flux app name (e.g. hytale, mcp)' },
        preferHost: { type: 'string', description: 'Optional preferred host/IP from /apps/location results' },
        requireRunning: {
          type: 'boolean',
          description: 'If true, only return a baseUrl if the app appears in /apps/listrunningapps on that node (default true).',
          default: true,
        },
      },
      required: ['appname'],
    },
  },
  {
    name: 'flux_apps_logs',
    description: 'Get app/container logs (GET /apps/applog).',
    inputSchema: {
      type: 'object',
      properties: {
        appname: { type: 'string', description: 'App or component name' },
        lines: { type: 'string', description: 'Line count or "all" (default all)' },
      },
      required: ['appname'],
    },
  },
  {
    name: 'flux_apps_inspect',
    description: 'Inspect a container (GET /apps/appinspect).',
    inputSchema: {
      type: 'object',
      properties: {
        appname: { type: 'string' },
      },
      required: ['appname'],
    },
  },
  {
    name: 'flux_apps_stats',
    description: 'Get container stats (GET /apps/appstats).',
    inputSchema: {
      type: 'object',
      properties: {
        appname: { type: 'string' },
      },
      required: ['appname'],
    },
  },
  {
    name: 'flux_apps_top',
    description: 'Get process list for a container (GET /apps/apptop).',
    inputSchema: {
      type: 'object',
      properties: {
        appname: { type: 'string' },
      },
      required: ['appname'],
    },
  },
  {
    name: 'flux_apps_monitor',
    description: 'Get stored monitoring data (GET /apps/appmonitor).',
    inputSchema: {
      type: 'object',
      properties: {
        appname: { type: 'string' },
        range: { type: 'number', description: 'Optional range (positive integer)' },
      },
      required: ['appname'],
    },
  },
  {
    name: 'flux_apps_exec',
    description: 'Execute a command inside an app container (POST /apps/appexec). Requires confirm=true.',
    inputSchema: {
      type: 'object',
      properties: {
        appname: { type: 'string' },
        cmd: { type: 'array', items: { type: 'string' }, description: 'Command array, e.g. ["sh","-lc","ls -la"]' },
        env: { description: 'Env array, e.g. ["KEY=VALUE"] (optional)' },
        confirm: { type: 'boolean' },
      },
      required: ['appname', 'cmd', 'confirm'],
    },
  },

  // Volume browser (files)
  {
    name: 'flux_apps_list_folder',
    description: 'List a folder in an app volume (GET /apps/getfolderinfo).',
    inputSchema: {
      type: 'object',
      properties: {
        appname: { type: 'string' },
        component: { type: 'string' },
        folder: { type: 'string', description: 'Relative folder path (optional, default "")' },
      },
      required: ['appname', 'component'],
    },
  },
  {
    name: 'flux_apps_download_file',
    description: 'Download a file from an app volume (GET /apps/downloadfile) as base64. Requires confirm=true for sensitive paths.',
    inputSchema: {
      type: 'object',
      properties: {
        appname: { type: 'string' },
        component: { type: 'string' },
        file: { type: 'string', description: 'Relative file path' },
        maxBytes: { type: 'number', description: 'Max bytes to download (default 1048576)' },
        confirm: { type: 'boolean', description: 'Required when file path looks sensitive (e.g. .env, credentials).' },
      },
      required: ['appname', 'component', 'file'],
    },
  },
  {
    name: 'flux_apps_download_folder',
    description: 'Download a folder from an app volume (GET /apps/downloadfolder) as a zipped base64 blob. Requires confirm=true.',
    inputSchema: {
      type: 'object',
      properties: {
        appname: { type: 'string' },
        component: { type: 'string' },
        folder: { type: 'string', description: 'Relative folder path' },
        maxBytes: { type: 'number', description: 'Max bytes to download (default 1048576)' },
        confirm: { type: 'boolean' },
      },
      required: ['appname', 'component', 'folder', 'confirm'],
    },
  },
  {
    name: 'flux_apps_create_folder',
    description: 'Create a folder in an app volume (GET /apps/createfolder). Requires confirm=true.',
    inputSchema: {
      type: 'object',
      properties: {
        appname: { type: 'string' },
        component: { type: 'string' },
        folder: { type: 'string' },
        confirm: { type: 'boolean' },
      },
      required: ['appname', 'component', 'folder', 'confirm'],
    },
  },
  {
    name: 'flux_apps_rename_object',
    description: 'Rename a file/folder in an app volume (GET /apps/renameobject). Requires confirm=true.',
    inputSchema: {
      type: 'object',
      properties: {
        appname: { type: 'string' },
        component: { type: 'string' },
        oldpath: { type: 'string' },
        newname: { type: 'string' },
        confirm: { type: 'boolean' },
      },
      required: ['appname', 'component', 'oldpath', 'newname', 'confirm'],
    },
  },
  {
    name: 'flux_apps_remove_object',
    description: 'Remove a file/folder in an app volume (GET /apps/removeobject). Requires confirm=true.',
    inputSchema: {
      type: 'object',
      properties: {
        appname: { type: 'string' },
        component: { type: 'string' },
        object: { type: 'string' },
        confirm: { type: 'boolean' },
      },
      required: ['appname', 'component', 'object', 'confirm'],
    },
  },

  // Syncthing
  {
    name: 'flux_syncthing_metrics',
    description: 'Get Syncthing metrics (GET /syncthing/metrics).',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'flux_syncthing_metrics_health',
    description: 'Get Syncthing metrics health summary (GET /syncthing/metrics/health).',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'flux_syncthing_system_status',
    description: 'Get Syncthing system status (GET /syncthing/system/status).',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'flux_syncthing_list_folders',
    description: 'List Syncthing folders (GET /syncthing/config/folders).',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'flux_syncthing_list_devices',
    description: 'List Syncthing devices (GET /syncthing/config/devices).',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'flux_syncthing_db_browse',
    description: 'Browse Syncthing DB (GET /syncthing/db/browse).',
    inputSchema: {
      type: 'object',
      properties: {
        folder: { type: 'string', description: 'Folder ID' },
        levels: { type: 'number', description: 'Optional browse depth' },
        prefix: { type: 'string', description: 'Optional prefix' },
      },
      required: ['folder'],
    },
  },
  {
    name: 'flux_syncthing_db_scan',
    description: 'Trigger a Syncthing scan (POST /syncthing/db/scan). Requires confirm=true.',
    inputSchema: {
      type: 'object',
      properties: {
        folder: { type: 'string', description: 'Folder ID' },
        sub: { type: 'string', description: 'Optional subpath' },
        confirm: { type: 'boolean' },
      },
      required: ['folder', 'confirm'],
    },
  },
  {
    name: 'flux_syncthing_restart',
    description: 'Restart Syncthing (GET /syncthing/system/restart). Requires confirm=true.',
    inputSchema: {
      type: 'object',
      properties: {
        confirm: { type: 'boolean' },
      },
      required: ['confirm'],
    },
  },
];

export async function callTool(name: string, rawArgs: unknown) {
  const args = asRecord(rawArgs);

  try {
    switch (name) {
      case 'flux_get_state':
        const out = {
          baseUrl: client.getBaseUrl(),
          zelidauth: client.getZelidauthSummary(),
          zelidauthCache: client.getZelidauthCacheSummary({ limit: 10 }),
          enterpriseKey: client.getEnterpriseKeySummary(),
          enterpriseKeyCache: client.getEnterpriseKeyCacheSummary({ limit: 10 }),
          httpDefaults: client.getHttpDefaults(),
          fluxDriveMwsBaseUrl: fluxDriveClient.baseUrl,
          endpointsInventory: inventory
            ? { path: endpointsPath, routeCount: inventory.routeCount, generatedAt: inventory.generatedAt }
            : { path: endpointsPath, present: false },
        };
        return jsonResult(out, { structuredContent: out });

      case 'flux_resource_prune': {
        const clearAll = asOptionalBoolean(args['clearAll']) ?? false;
        if (clearAll) {
          const result = resourceStore.clearAll();
          const out = { ok: true, action: 'clearAll', ...result };
          return jsonResult(out, { structuredContent: out });
        }
        const result = resourceStore.pruneNow();
        const out = { ok: true, action: 'prune', ...result };
        return jsonResult(out, { structuredContent: out });
      }

      case 'flux_resource_read': {
        const uri = mustBeString(args['uri'], 'uri');

        if (uri === 'flux://inventory/endpoints') {
          const text = JSON.stringify(inventory?.routes ?? [], null, 2);
          const out = { ok: true, uri, mimeType: 'application/json' };
          return {
            content: [{ type: 'text', text }],
            structuredContent: out,
            isError: false,
          };
        }

        const found = resourceStore.read(uri);
        if (!found) {
          const out = { ok: false, error: 'Resource not found', uri };
          return jsonResult(out, { isError: true, structuredContent: out });
        }

        const out = { ok: true, uri: found.uri, mimeType: found.mimeType ?? 'text/plain' };
        return {
          content: [{ type: 'text', text: found.text }],
          structuredContent: out,
          isError: false,
        };
      }

      case 'flux_set_http_defaults': {
        client.setHttpDefaults({
          timeoutMs: asOptionalNumber(args['timeoutMs']) ?? undefined,
          retryCount: asOptionalNumber(args['retryCount']) ?? undefined,
          retryBackoffMs: asOptionalNumber(args['retryBackoffMs']) ?? undefined,
        });
        const out = { ok: true, httpDefaults: client.getHttpDefaults(), note: 'Omitted fields keep their previous values.' };
        return jsonResult(out, { structuredContent: out });
      }

      case 'flux_fluxdrive_set_base_url': {
        const baseUrl = mustBeString(args['baseUrl'], 'baseUrl');
        fluxDriveClient.baseUrl = normalizeHttpBaseUrl(baseUrl);
        const out = { ok: true, fluxDriveMwsBaseUrl: fluxDriveClient.baseUrl };
        return jsonResult(out, { structuredContent: out });
      }

      case 'flux_fluxdrive_register_backup_file': {
        const appname = mustBeString(args['appname'], 'appname');
        const component = mustBeString(args['component'], 'component');
        const filename = mustBeString(args['filename'], 'filename');
        const filesize = mustBeNumber(args['filesize'], 'filesize');
        const host = mustBeString(args['host'], 'host');
        const timestamp = mustBeNumber(args['timestamp'], 'timestamp');

        const payload = { appname, component, filename, filesize, host, timestamp };
        return jsonResult(await fluxDriveRequest('/registerbackupfile', { method: 'POST', body: payload }));
      }

      case 'flux_fluxdrive_get_task_status': {
        const taskId = mustBeNumber(args['taskId'], 'taskId');
        return jsonResult(await fluxDriveRequest('/gettaskstatus', { method: 'GET', query: { taskId } }));
      }

      case 'flux_fluxdrive_get_backup_list': {
        const appname = mustBeString(args['appname'], 'appname');
        return jsonResult(await fluxDriveRequest('/getbackuplist', { method: 'GET', query: { appname } }));
      }

      case 'flux_fluxdrive_remove_checkpoint': {
        const appname = mustBeString(args['appname'], 'appname');
        const timestamp = mustBeNumber(args['timestamp'], 'timestamp');
        return jsonResult(await fluxDriveRequest('/removeCheckpoint', { method: 'POST', body: { appname, timestamp } }));
      }

       case 'flux_apps_resolve_runtime_target': {
         const appname = mustBeString(args['appname'], 'appname');
         const preferHost = asOptionalString(args['preferHost']);
         const requireRunning = asOptionalBoolean(args['requireRunning']) ?? true;
 
         const out = await resolveRuntimeTarget({ client, appname, preferHost, requireRunning });

         const candidateHosts = out.candidates.map((c) => c.host);
         const hasDuplicates = new Set(candidateHosts).size !== candidateHosts.length;

         const guidance = {
           note: 'baseUrl points to the Flux node API. If /apps/location includes a port, that port is treated as the node API port (UPnP-style); otherwise defaults to :16127.',
           warnings: [
             hasDuplicates
               ? 'Multiple candidates share the same host with different ports. This is expected on UPnP nodes: host:port identifies the node.'
               : null,
             out.ok !== true
               ? 'Location broadcasts can be stale; checks[] shows which candidates actually reported the container running.'
               : null,
           ].filter((x): x is string => typeof x === 'string' && x.length > 0),
         };

         return jsonResult({ ...out, guidance }, { isError: out.ok !== true, structuredContent: { ...out, guidance } });
       }

      case 'flux_ioutils_file_upload': {
        requireConfirm(args, 'ioutils/fileupload');
        const type = mustBeString(args['type'], 'type');
        const appname = mustBeString(args['appname'], 'appname');
        const component = mustBeString(args['component'], 'component');
        const filename = mustBeString(args['filename'], 'filename');
        const folder = asOptionalString(args['folder']) ?? 'null';

        const localPath = mustBeString(args['filePath'], 'filePath');
        const timeoutMsRaw = asOptionalNumber(args['timeoutMs']);
        const timeoutMs = timeoutMsRaw === undefined ? 15 * 60 * 1000 : Math.floor(timeoutMsRaw);
        if (timeoutMs <= 0) throw new Error('timeoutMs must be a positive number');

        const allowProxy = asOptionalBoolean(args['allowProxy']) ?? false;
        const baseUrl = client.getBaseUrl();
        if (!allowProxy && baseUrl) {
          const u = new URL(baseUrl);
          const host = u.hostname.toLowerCase();
          const isProxyHost = host === 'api.runonflux.io' || host.endsWith('.node.api.runonflux.io');
          if (isProxyHost) {
            throw new Error(
              'Refusing to call /ioutils/fileupload via gateway/proxy baseUrl. Use a direct node URL like http://<node-ip>:<port> (set allowProxy=true to override).'
            );
          }
        }

        const apiPath = `/ioutils/fileupload/${encodeURIComponent(type)}/${encodeURIComponent(appname)}/${encodeURIComponent(
          component
        )}/${encodeURIComponent(folder)}/${encodeURIComponent(filename)}`;

        const maxFileBytesRaw = asOptionalNumber(args['maxFileBytes']);
        const maxFileBytes = maxFileBytesRaw === undefined ? 1024 * 1024 * 1024 : Math.floor(maxFileBytesRaw);
        if (maxFileBytes <= 0) throw new Error('maxFileBytes must be a positive number');

        const bytes = await fs.readFile(localPath);
        if (bytes.length > maxFileBytes) {
          throw new Error(`Local file too large (${bytes.length} bytes) for maxFileBytes=${maxFileBytes}`);
        }

        const form = new FormData();
        form.set(filename, new Blob([bytes]), filename);

        return jsonResult(
          await client.request(apiPath, {
            method: 'POST',
            allowMutation: true,
            bodyType: 'multipart',
            body: form,
            responseType: 'text',
            timeoutMs,
          })
        );
      }

      case 'flux_auth_flow': {
        const useEmergencyPhrase = asOptionalBoolean(args['useEmergencyPhrase']) ?? false;
        const gatewayBaseUrl = asOptionalString(args['gatewayBaseUrl']);

        const steps: Array<{ tool: string; arguments?: unknown; note: string }> = [];

        if (gatewayBaseUrl) {
          steps.push({
            tool: 'flux_resolve_gateway_node',
            arguments: { gatewayBaseUrl },
            note: 'Resolve the gateway to a direct node base URL.',
          });
          steps.push({
            tool: 'flux_set_base_url',
            arguments: { baseUrl: '<DIRECT_NODE_BASE_URL>' },
            note: 'Set baseUrl to the recommendedBaseUrl from the previous step (or use flux_set_base_url_from_gateway as a shortcut).',
          });
        } else {
          steps.push({
            tool: 'flux_set_base_url',
            arguments: { baseUrl: 'http://<node-ip>:16127' },
            note: 'Set your node API base URL for this session.',
          });
        }

        const phraseTool = useEmergencyPhrase ? 'flux_get_emergency_phrase' : 'flux_get_login_phrase';
        steps.push({
          tool: phraseTool,
          arguments: {},
          note: 'Fetch a login phrase to sign with your ZelID (this is a Bitcoin-format address like 1..., 3..., or bc1...; not a Flux t1/t3 address).',
        });
        steps.push({
          tool: 'USER_ACTION',
          note: 'Sign the returned login phrase with your ZelID wallet/tooling to produce a signature (distinct from app registration signatures).',
        });
        steps.push({
          tool: 'flux_verify_login',
          arguments: { zelid: '<ZELID>', signature: '<SIGNATURE>', loginPhrase: '<PHRASE>' },
          note: 'Establish a server-side session on this pinned node (recommended but not strictly required for header-based auth).',
        });
        steps.push({
          tool: 'flux_set_zelidauth',
          arguments: { zelidauth: { zelid: '<ZELID>', signature: '<SIGNATURE>', loginPhrase: '<PHRASE>' } },
          note: 'Store zelidauth for subsequent calls. If verify_login fails due to gateway/node mismatch, this can still work as long as baseUrl is pinned.',
        });
        steps.push({
          tool: 'flux_check_privilege',
          arguments: { zelid: '<ZELID>', signature: '<SIGNATURE>', loginPhrase: '<PHRASE>' },
          note: 'Confirm your privilege level.',
        });

        const out = { ok: true, steps };

        return jsonResult(out, { structuredContent: out });
      }

      case 'flux_auth_diagnose': {
        const checks: Array<{ name: string; ok: boolean; detail?: unknown }> = [];
        const nextSteps: string[] = [];

        const baseUrl = client.getBaseUrl();
        if (!baseUrl) {
        checks.push({ name: 'baseUrl', ok: false, detail: 'Base URL not set' });
        nextSteps.push("Run flux_set_base_url with baseUrl='http://<node-ip>:16127'");
        const out = { ok: false, checks, nextSteps };
        return jsonResult(out, { isError: false, structuredContent: out });

        }
        checks.push({ name: 'baseUrl', ok: true, detail: baseUrl });

        const version = await client.request('/flux/version');
        checks.push({ name: 'flux/version', ok: version.ok, detail: version.data });

        const phrase = await client.request('/id/loginphrase');
        if (phrase.ok) {
          checks.push({ name: 'id/loginphrase', ok: true });
        } else {
          checks.push({ name: 'id/loginphrase', ok: false, detail: phrase.data });
          const emergency = await client.request('/id/emergencyphrase');
          checks.push({ name: 'id/emergencyphrase', ok: emergency.ok, detail: emergency.data });
          nextSteps.push('If loginphrase fails, use flux_get_emergency_phrase and investigate node health (syncthing/docker/DOS state).');
        }

        const z = client.getZelidauthSummary();
        checks.push({ name: 'zelidauth', ok: z.present, detail: z });
        if (!z.present) {
          nextSteps.push('Run flux_auth_flow to get the exact login steps.');
          return jsonResult({ ok: false, checks, nextSteps }, { isError: false, structuredContent: { ok: false, checks, nextSteps } });
        }

        const raw = client.getZelidauthValue();
        if (raw) {
          try {
            const parsed: unknown = JSON.parse(raw);
            if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
              const obj = parsed as Record<string, unknown>;
              const zelid = obj.zelid;
              const signature = obj.signature;
              const loginPhrase = obj.loginPhrase;
              if (typeof zelid === 'string' && typeof signature === 'string' && typeof loginPhrase === 'string') {
                const priv = await client.request('/id/checkprivilege', {
                  method: 'POST',
                  bodyType: 'form',
                  body: { zelid, signature, loginPhrase },
                });
                checks.push({ name: 'id/checkprivilege', ok: priv.ok, detail: priv.data });
              } else {
                checks.push({ name: 'id/checkprivilege', ok: false, detail: 'Stored zelidauth is not JSON {zelid,signature,loginPhrase}' });
              }
            }
          } catch {
            checks.push({ name: 'id/checkprivilege', ok: false, detail: 'Stored zelidauth is not JSON' });
          }
        }

        const out = { ok: true, checks, nextSteps };
        return jsonResult(out, { structuredContent: out });
      }

       case 'flux_logs_tail': {
         const appname = mustBeString(args['appname'], 'appname');

         const z = client.getZelidauthSummary();
         if (!z.present) {
           const out = {
             ok: false,
             appname,
             error: 'Authentication required (zelidauth not set).',
             nextActions: [{ tool: 'flux_auth_flow', arguments: {} }],
           };
           return jsonResult(out, { isError: true, structuredContent: out });
         }

        const linesRaw = asOptionalNumber(args['lines']);
        const linesValue = linesRaw === undefined ? 200 : Math.floor(linesRaw);
        const lines = Math.min(500, Math.max(1, linesValue));

        const maxBytesRaw = asOptionalNumber(args['maxBytes']);
        const maxBytesValue = maxBytesRaw === undefined ? 65536 : Math.floor(maxBytesRaw);
        const maxBytes = Math.min(1024 * 1024, Math.max(1024, maxBytesValue));

        const sinceRaw = args['since'];
        const since =
          typeof sinceRaw === 'string' && sinceRaw.trim()
            ? sinceRaw.trim()
            : typeof sinceRaw === 'number' && Number.isFinite(sinceRaw)
              ? String(sinceRaw)
              : undefined;

        const path = since
          ? `/apps/applogpolling/${encodeURIComponent(appname)}/${lines}/${encodeURIComponent(since)}`
          : `/apps/applogpolling/${encodeURIComponent(appname)}/${lines}`;

        let res = await client.request(path);

        const knownError = extractFluxErrorMessage(res.data);
        const looksLikeWrongNode =
          knownError === 'Cannot read properties of undefined (reading \'Id\')' ||
          (typeof knownError === 'string' && knownError.includes("reading 'Id'"));

         if ((!res.ok && looksLikeWrongNode) || (!res.ok && res.status === 503)) {
          const resolved = await resolveContainerOnCorrectNode({ client, appname, requireRunning: true });
          if (resolved) {
            const attempt = await attemptOnCandidates(
              resolved.candidates.map((c) => ({ baseUrl: c.baseUrl, host: c.host, apiPort: c.apiPort })),
              async (baseUrl) => {
                client.setBaseUrl(baseUrl);

                const targets = [resolved.containerName, ...resolved.containerNames.filter((n) => n !== resolved.containerName)];

                for (const t of targets) {
                  const fallbackPath = since
                    ? `/apps/applogpolling/${encodeURIComponent(t)}/${lines}/${encodeURIComponent(since)}`
                    : `/apps/applogpolling/${encodeURIComponent(t)}/${lines}`;

                  const r = await client.request(fallbackPath);
                  if (r.ok && isFluxSuccess(r.data)) return r;
                }

                return client.request(`/apps/applogpolling/${encodeURIComponent(resolved.containerName)}/${lines}`);
              }
            );

            if (attempt.ok) {
              res = attempt.value;
            }
          }
        }

        if (!res.ok) {
          const out = { ok: false, appname, status: res.status, error: extractFluxErrorMessage(res.data) ?? res.data };
          return jsonResult(out, { isError: true, structuredContent: out });
        }

        const payload = unwrapFluxEnvelope<unknown>(res.data);
        const obj = payload && typeof payload === 'object' && !Array.isArray(payload) ? (payload as Record<string, unknown>) : undefined;

        if (obj && typeof obj.name === 'string' && obj.name.toLowerCase() === 'unauthorized') {
          const out = {
            ok: false,
            appname,
            status: 401,
            error: typeof obj.message === 'string' ? obj.message : 'Unauthorized',
            nextActions: [{ tool: 'flux_auth_flow', arguments: {} }],
          };
          return jsonResult(out, { isError: true, structuredContent: out });
        }

        const logsValue = obj?.logs ?? obj?.data ?? payload;

        let fullText = '';
        if (typeof logsValue === 'string') fullText = logsValue;
        else if (Array.isArray(logsValue) && logsValue.every((x) => typeof x === 'string')) fullText = (logsValue as string[]).join('\n');
        else fullText = JSON.stringify(payload, null, 2);

        const fullLines = fullText.split(/\r?\n/).filter((l) => l.length);

        let truncated = false;
        let text = fullText;
        if (Buffer.byteLength(fullText, 'utf8') > maxBytes) {
          truncated = true;
          const buffer = Buffer.from(fullText, 'utf8');
          text = buffer.subarray(buffer.length - maxBytes).toString('utf8');
        }

        const linesOut = text.split(/\r?\n/).filter((l) => l.length);

        const looksLikeJsonError =
          linesOut.length > 0 &&
          linesOut.length <= 10 &&
          (() => {
            try {
              const parsed: unknown = JSON.parse(linesOut.join('\n'));
              if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return false;
              const msg = extractFluxErrorMessage(parsed);
              return typeof msg === 'string' && msg.length > 0;
            } catch {
              return false;
            }
          })();

        if (looksLikeJsonError) {
          const out = {
            ok: false,
            appname,
            status: res.status,
            error: extractFluxErrorMessage(res.data) ?? 'Flux log endpoint returned an error.',
            nextActions: [{ tool: 'flux_apps_resolve_runtime_target', arguments: { appname } }],
          };
          return jsonResult(out, { isError: true, structuredContent: out });
        }

        const nextSince =
          typeof obj?.sinceTimestamp === 'string'
            ? obj.sinceTimestamp
            : typeof obj?.sinceTimestamp === 'number'
              ? String(obj.sinceTimestamp)
              : typeof obj?.since === 'string'
                ? obj.since
                : undefined;

        const full = {
          ok: true,
          appname,
          truncated,
          lineCount: linesOut.length,
          logs: linesOut,
          next: nextSince ? { since: nextSince } : undefined,
        };

         const logsText = fullLines.join('\n');
         const link = resourceStore.putText({
           kind: 'logs',
           name: `${appname} logs`,
           description: 'Full log payload from flux_logs_tail',
           mimeType: 'text/plain',
           text: logsText,
         });

         const preview = linesOut.slice(-Math.min(linesOut.length, 50));

         return {
           content: [
             {
               type: 'text',
               text: JSON.stringify({
                 ok: true,
                 appname,
                 truncated,
                 lineCount: linesOut.length,
                 preview,
                 next: full.next,
                 resourceUri: link.uri,
               }, null, 2),
             },
             {
               type: 'resource_link',
               uri: link.uri,
               name: link.name,
               description: link.description,
               mimeType: link.mimeType,
             },
           ],
           structuredContent: { ...full, preview, resourceUri: link.uri },
           isError: false,
         };
      }

       case 'flux_app_health_report': {
         const appname = mustBeString(args['appname'], 'appname');

         const z = client.getZelidauthSummary();
         if (!z.present) {
           const out = {
             ok: false,
             appname,
             error: 'Authentication required (zelidauth not set).',
             nextActions: [{ tool: 'flux_auth_flow', arguments: {} }],
           };
           return jsonResult(out, { isError: true, structuredContent: out });
         }
        const logsLinesRaw = asOptionalNumber(args['logsLines']);
        const logsLinesValue = logsLinesRaw === undefined ? 100 : Math.floor(logsLinesRaw);
        const logsLines = Math.min(300, Math.max(1, logsLinesValue));

        const monitorRangeRaw = asOptionalNumber(args['monitorRangeMs']);
        const monitorRangeValue = monitorRangeRaw === undefined ? 10 * 60 * 1000 : Math.floor(monitorRangeRaw);
        const monitorRangeMs = Math.min(24 * 60 * 60 * 1000, Math.max(1000, monitorRangeValue));

        const resolved = await resolveRuntimeTarget({ client, appname, requireRunning: true });
        const resolvedContainer = await resolveContainerOnCorrectNode({ client, appname, requireRunning: true });
        if (resolvedContainer) client.setBaseUrl(resolvedContainer.baseUrl);
        const target = resolvedContainer ? resolvedContainer.containerName : appname;

        const [inspect, stats, top, monitor, logs] = await Promise.all([
          client.request(`/apps/appinspect/${encodeURIComponent(target)}`),
          client.request(`/apps/appstats/${encodeURIComponent(target)}`),
          client.request(`/apps/apptop/${encodeURIComponent(target)}`),
          client.request(`/apps/appmonitor/${encodeURIComponent(target)}/${monitorRangeMs}`),
          client.request(`/apps/applogpolling/${encodeURIComponent(target)}/${logsLines}`),
        ]);

        const inspectLink = resourceStore.putJson({
          kind: 'app/inspect',
          name: `${target} inspect`,
          description: 'Raw /apps/appinspect response',
          value: inspect,
        });
        const statsLink = resourceStore.putJson({
          kind: 'app/stats',
          name: `${target} stats`,
          description: 'Raw /apps/appstats response',
          value: stats,
        });
        const topLink = resourceStore.putJson({
          kind: 'app/top',
          name: `${target} top`,
          description: 'Raw /apps/apptop response',
          value: top,
        });
        const monitorLink = resourceStore.putJson({
          kind: 'app/monitor',
          name: `${target} monitor`,
          description: 'Raw /apps/appmonitor response',
          value: monitor,
        });
        const logsLink = resourceStore.putJson({
          kind: 'app/logs',
          name: `${target} logs (raw)`,
          description: 'Raw /apps/applogpolling response',
          value: logs,
        });

        const summary = {
          ok: true,
          appname,
          resolved: {
            ok: resolved.ok === true,
            baseUrl: resolved.ok && typeof resolved.baseUrl === 'string' ? resolved.baseUrl : null,
            containerName: target,
            candidates: resolved.candidates,
          },
          inspect: { ok: inspect.ok, status: inspect.status },
          stats: { ok: stats.ok, status: stats.status },
          top: { ok: top.ok, status: top.status },
          monitor: { ok: monitor.ok, status: monitor.status },
          logs: { ok: logs.ok, status: logs.status },
          resources: {
            inspect: inspectLink.uri,
            stats: statsLink.uri,
            top: topLink.uri,
            monitor: monitorLink.uri,
            logs: logsLink.uri,
          },
          nextActions: [
            { tool: 'flux_resource_read', arguments: { uri: logsLink.uri } },
            { tool: 'flux_logs_tail', arguments: { appname: target } },
            { tool: 'flux_apps_resolve_runtime_target', arguments: { appname } },
            { tool: 'flux_apps_redeploy', arguments: { appname, confirm: true } },
            { tool: 'flux_auth_diagnose', arguments: {} },
          ],
        };

        return {
          content: [
            { type: 'text', text: JSON.stringify(summary, null, 2) },
            { type: 'resource_link', ...inspectLink },
            { type: 'resource_link', ...statsLink },
            { type: 'resource_link', ...topLink },
            { type: 'resource_link', ...monitorLink },
            { type: 'resource_link', ...logsLink },
          ],
          structuredContent: summary,
          isError: false,
        };
      }

      case 'flux_set_base_url': {
        const baseUrl = mustBeString(args['baseUrl'], 'baseUrl');
        client.setBaseUrl(baseUrl);
        const out = {
          ok: true,
          baseUrl: client.getBaseUrl(),
          zelidauth: client.getZelidauthSummary(),
          enterpriseKey: client.getEnterpriseKeySummary(),
        };
        return jsonResult(out, { structuredContent: out });
      }

      case 'flux_resolve_gateway_node': {
        const gatewayBaseUrl = mustBeString(args['gatewayBaseUrl'], 'gatewayBaseUrl');

        const prevBase = client.getBaseUrl();
        try {
          client.setBaseUrl(gatewayBaseUrl);
          const info = await client.request('/flux/info', { timeoutMs: 20000 });

          const header = info.headers?.fluxnode;
          const fluxnode = typeof header === 'string' ? header : undefined;

          const responseData = info.data;

          const ip =
            responseData && typeof responseData === 'object' && !Array.isArray(responseData)
              ? (() => {
                  const envelope = (responseData as Record<string, unknown>).data;
                  if (!envelope || typeof envelope !== 'object' || Array.isArray(envelope)) return undefined;

                  const node = (envelope as Record<string, unknown>).node;
                  if (!node || typeof node !== 'object' || Array.isArray(node)) return undefined;

                  const status = (node as Record<string, unknown>).status;
                  if (!status || typeof status !== 'object' || Array.isArray(status)) return undefined;

                  const rawIp = (status as Record<string, unknown>).ip;
                  return typeof rawIp === 'string' && rawIp.trim() ? rawIp : undefined;
                })()
              : undefined;

          const out = {
            ok: true,
            gatewayBaseUrl: gatewayBaseUrl.replace(/\/+$/, ''),
            fluxnode,
            ip,
            recommendedBaseUrl: ip ? `http://${ip}:16127` : undefined,
          };

          return jsonResult(out, { structuredContent: out });
        } finally {
          if (prevBase) client.setBaseUrl(prevBase);
        }
      }

      case 'flux_set_base_url_from_gateway': {
        const gatewayBaseUrl = mustBeString(args['gatewayBaseUrl'], 'gatewayBaseUrl');

        const prevBase = client.getBaseUrl();
        try {
          client.setBaseUrl(gatewayBaseUrl);
          const info = await client.request('/flux/info', { timeoutMs: 20000 });

          const header = info.headers?.fluxnode;
          const fluxnode = typeof header === 'string' ? header : undefined;

          const responseData = info.data;

          const ip =
            responseData && typeof responseData === 'object' && !Array.isArray(responseData)
              ? (() => {
                  const envelope = (responseData as Record<string, unknown>).data;
                  if (!envelope || typeof envelope !== 'object' || Array.isArray(envelope)) return undefined;

                  const node = (envelope as Record<string, unknown>).node;
                  if (!node || typeof node !== 'object' || Array.isArray(node)) return undefined;

                  const status = (node as Record<string, unknown>).status;
                  if (!status || typeof status !== 'object' || Array.isArray(status)) return undefined;

                  const rawIp = (status as Record<string, unknown>).ip;
                  return typeof rawIp === 'string' && rawIp.trim() ? rawIp : undefined;
                })()
              : undefined;

          const recommendedBaseUrl = ip ? `http://${ip}:16127` : undefined;
          if (!recommendedBaseUrl) throw new Error('Could not resolve node IP from /flux/info response');

          client.setBaseUrl(recommendedBaseUrl);

          const out = {
            ok: true,
            gatewayBaseUrl: gatewayBaseUrl.replace(/\/+$/, ''),
            fluxnode,
            ip,
            recommendedBaseUrl,
            baseUrl: client.getBaseUrl(),
          };

          return jsonResult(out, { structuredContent: out });
        } catch (error) {
          // Only restore the previous baseUrl if we fail before setting the recommended direct node URL.
          if (prevBase) client.setBaseUrl(prevBase);
          throw error;
        }
      }

      case 'flux_set_zelidauth': {
        const value = args['zelidauth'];
        client.setZelidauth(value);
        const out = {
          ok: true,
          baseUrl: client.getBaseUrl(),
          zelidauth: client.getZelidauthSummary(),
        };
        return jsonResult(out, { structuredContent: out });
      }

      case 'flux_clear_zelidauth':
        client.clearZelidauth();
        return jsonResult({ ok: true, zelidauth: client.getZelidauthSummary() });

      case 'flux_set_enterprise_key': {
        const value = mustBeString(args['enterpriseKey'], 'enterpriseKey');
        client.setEnterpriseKey(value);
        return jsonResult({ ok: true, enterpriseKey: client.getEnterpriseKeySummary() });
      }

      case 'flux_enterprise_key_generate': {
        const publicKey = mustBeString(args['publicKey'], 'publicKey');
        const { enterpriseKey, aesKeyBase64 } = generateEnterpriseKey(publicKey);
        return jsonResult({
          ok: true,
          headerName: ENTERPRISE_KEY_HEADER,
          enterpriseKey,
          aesKeyBase64,
        });
      }

      case 'flux_enterprise_preflight': {
        const appname = mustBeString(args['appname'], 'appname');
        const ownerArg = asOptionalString(args['owner']);
        const baseUrlsRaw = args['baseUrls'];
        const setBaseUrlOnSuccess = (asOptionalBoolean(args['setBaseUrlOnSuccess']) ?? true) === true;
        const setEnterpriseKey = (asOptionalBoolean(args['setEnterpriseKey']) ?? true) === true;
        const verifyDecrypt = (asOptionalBoolean(args['verifyDecrypt']) ?? true) === true;
        const timeoutMs = asOptionalNumber(args['timeoutMs']);

        const baseUrls = Array.isArray(baseUrlsRaw)
          ? baseUrlsRaw.filter((x): x is string => typeof x === 'string').map((x) => x.trim()).filter(Boolean)
          : [];

        const currentBase = client.getBaseUrl();
        if (baseUrls.length === 0 && currentBase) baseUrls.push(currentBase);

        const normalized = Array.from(new Set(baseUrls.map((u) => normalizeHttpBaseUrl(u))));
        if (normalized.length === 0) throw new Error('No baseUrl available (set FLUX_API_BASE_URL or pass baseUrls).');

        const runWithBaseUrl = async <T>(baseUrl: string, fn: () => Promise<T>) => {
          const restoreBase = client.getBaseUrl();
          client.setBaseUrl(baseUrl);
          try {
            return await fn();
          } finally {
            if (restoreBase) client.setBaseUrl(restoreBase);
          }
        };

        let owner = ownerArg ?? null;
        let ownerFailures: Array<{ baseUrl: string; error: string; hint?: FluxRequestErrorHint }> | undefined;

        if (!owner) {
          const ownerAttempt = await attemptOnBaseUrls(normalized, (baseUrl) =>
            runWithBaseUrl(baseUrl, async () => {
              const res = await client.request(`/apps/apporiginalowner/${encodeURIComponent(appname)}`, { timeoutMs });
              if (!res.ok || !isFluxSuccess(res.data)) {
                throw new Error(extractFluxErrorMessage(res.data) ?? 'Failed to fetch app original owner');
              }
              const payload = unwrapFluxEnvelope<unknown>(res.data);
              if (typeof payload !== 'string' || !payload.trim()) throw new Error('Invalid owner response');
              return payload.trim();
            })
          );

          if (!ownerAttempt.ok) {
            ownerFailures = ownerAttempt.failures;
          } else {
            owner = ownerAttempt.value;
          }
        }

        if (!owner) {
          return jsonResult({
            ok: false,
            appname,
            owner: null,
            error: 'Unable to resolve app owner.',
            failures: ownerFailures ?? [],
          }, { isError: true });
        }

        const publicKeyAttempt = await attemptOnBaseUrls(normalized, (baseUrl) =>
          runWithBaseUrl(baseUrl, async () => {
            const res = await client.request('/apps/getpublickey', {
              method: 'POST',
              bodyType: 'json',
              body: { owner, name: appname },
              timeoutMs,
            });
            if (!res.ok || !isFluxSuccess(res.data)) {
              throw new Error(extractFluxErrorMessage(res.data) ?? 'Failed to fetch public key');
            }
            const payload = unwrapFluxEnvelope<unknown>(res.data);
            if (typeof payload !== 'string' || !payload.trim()) throw new Error('Invalid public key response');
            return payload.trim();
          })
        );

        if (!publicKeyAttempt.ok) {
          return jsonResult(
            {
              ok: false,
              appname,
              owner,
              error: 'Unable to fetch enterprise public key.',
              failures: publicKeyAttempt.failures,
            },
            { isError: true }
          );
        }

        const publicKey = publicKeyAttempt.value;
        const baseUrlUsed = publicKeyAttempt.used;
        const { enterpriseKey, aesKeyBase64 } = generateEnterpriseKey(publicKey);

        if (setEnterpriseKey) client.setEnterpriseKey(enterpriseKey);
        if (setBaseUrlOnSuccess) client.setBaseUrl(baseUrlUsed);

        let decryptCheck: FluxRequestResult | null = null;
        let decryptOk: boolean | null = null;
        let decryptError: string | null = null;

        if (verifyDecrypt) {
          decryptCheck = await runWithBaseUrl(baseUrlUsed, async () =>
            client.request(`/apps/appspecifications/${encodeURIComponent(appname)}/true`, {
              enterpriseKey,
              timeoutMs,
            })
          );
          decryptOk = decryptCheck.ok && isFluxSuccess(decryptCheck.data);
          decryptError = decryptOk ? null : extractFluxErrorMessage(decryptCheck.data) ?? 'Decrypt check failed';
        }

        const summary = {
          ok: verifyDecrypt ? Boolean(decryptOk) : true,
          appname,
          owner,
          baseUrlUsed,
          publicKey,
          enterpriseKey,
          aesKeyBase64,
          enterpriseKeySet: setEnterpriseKey,
          baseUrlSet: setBaseUrlOnSuccess,
          decryptOk,
          decryptError,
        };

        return jsonResult(summary, { structuredContent: summary, isError: verifyDecrypt ? !decryptOk : false });
      }

      case 'flux_enterprise_decrypt': {
        const enterprise = mustBeString(args['enterprise'], 'enterprise');
        const aesKeyBase64 = mustBeString(args['aesKeyBase64'], 'aesKeyBase64');
        const parseJson = (asOptionalBoolean(args['parseJson']) ?? true) === true;

        const decrypted = decryptEnterprisePayload(enterprise, aesKeyBase64);
        let parsed: unknown = null;
        let parsedOk = false;
        if (parseJson) {
          try {
            parsed = JSON.parse(decrypted);
            parsedOk = true;
          } catch (error) {
            parsedOk = false;
          }
        }

        const textLink = resourceStore.putText({
          kind: 'enterprise/decrypted',
          name: 'enterprise decrypted payload',
          description: 'Decrypted enterprise payload (raw UTF-8)',
          mimeType: 'text/plain',
          text: decrypted,
        });

        let jsonLink: ReturnType<typeof resourceStore.putJson> | null = null;
        if (parsedOk) {
          jsonLink = resourceStore.putJson({
            kind: 'enterprise/decrypted/json',
            name: 'enterprise decrypted JSON',
            description: 'Decrypted enterprise payload (parsed JSON)',
            value: parsed,
          });
        }

        const summary = {
          ok: true,
          parsedOk,
          textResourceUri: textLink.uri,
          jsonResourceUri: jsonLink?.uri ?? null,
        };

        return {
          content: [
            { type: 'text', text: JSON.stringify(summary, null, 2) },
            { type: 'resource_link', ...textLink },
            ...(jsonLink ? [{ type: 'resource_link', ...jsonLink }] : []),
          ],
          structuredContent: summary,
          isError: false,
        };
      }

      case 'flux_clear_enterprise_key':
        client.clearEnterpriseKey();
        return jsonResult({ ok: true, enterpriseKey: client.getEnterpriseKeySummary() });

      case 'flux_get_login_phrase':
        return jsonResult(await client.request('/id/loginphrase'));

      case 'flux_get_emergency_phrase':
        return jsonResult(await client.request('/id/emergencyphrase'));

      case 'flux_verify_login': {
        const zelid = mustBeString(args['zelid'], 'zelid');
        const signature = mustBeString(args['signature'], 'signature');
        const loginPhrase = mustBeString(args['loginPhrase'], 'loginPhrase');
        return jsonResult(
          await client.request('/id/verifylogin', {
            method: 'POST',
            bodyType: 'form',
            body: { zelid, signature, loginPhrase },
          })
        );
      }

      case 'flux_check_privilege': {
        const zelid = mustBeString(args['zelid'], 'zelid');
        const signature = mustBeString(args['signature'], 'signature');
        const loginPhrase = mustBeString(args['loginPhrase'], 'loginPhrase');
         return jsonResult(
           await client.request('/id/checkprivilege', {
             method: 'POST',
             bodyType: 'form',
             body: { zelid, signature, loginPhrase },
           })
         );
      }

      case 'flux_build_zelidauth': {
        const zelid = mustBeString(args['zelid'], 'zelid');
        const signature = mustBeString(args['signature'], 'signature');
        const loginPhrase = mustBeString(args['loginPhrase'], 'loginPhrase');
        const headerValue = JSON.stringify({ zelid, signature, loginPhrase });
        return jsonResult({ zelidauth: headerValue });
      }

      case 'flux_build_message_to_sign': {
        const type = mustBeString(args['type'], 'type') as 'fluxappregister' | 'fluxappupdate' | 'zelappregister' | 'zelappupdate';
        if (type !== 'fluxappregister' && type !== 'fluxappupdate' && type !== 'zelappregister' && type !== 'zelappupdate') {
          throw new Error('type must be one of: fluxappregister, fluxappupdate, zelappregister, zelappupdate');
        }
        const version = mustBeNumber(args['version'], 'version');
        const spec = mustBeObject(args['spec'], 'spec');
        const timestamp = mustBeNumber(args['timestamp'], 'timestamp');

        const includeMessageToSign = (asOptionalBoolean(args['includeMessageToSign']) ?? false) === true;

        const messageToSign = buildMessageToSign({ type, version, spec, timestamp });
        const messageToSignSha256 = createHash('sha256').update(messageToSign, 'utf8').digest('hex');
        const messageToSignBytes = Buffer.byteLength(messageToSign, 'utf8');
        const link = resourceStore.putText({
          kind: 'message_to_sign',
          name: `messageToSign ${type}`,
          description: 'Raw messageToSign bytes (exact data to sign)',
          mimeType: 'text/plain',
          text: messageToSign,
        });

        const out: Record<string, unknown> = {
          ok: true,
          type,
          version,
          timestamp,
          messageToSignSha256,
          messageToSignBytes,
          messageToSignResourceUri: link.uri,
        };

        if (includeMessageToSign) {
          const details = buildMessageToSignDetails(messageToSign);
          Object.assign(out, { messageToSign, ...details });
        }

        return {
          content: [{ type: 'text', text: JSON.stringify(out, null, 2) }, { type: 'resource_link', ...link }],
          structuredContent: out,
          isError: false,
        };
      }

      case 'flux_build_zelcore_sign_link': {
        const messageResourceUriRaw = asOptionalString(args['messageResourceUri']);
        const messageResourceUri = messageResourceUriRaw ? messageResourceUriRaw.trim() : null;

        let message: string;
        let messageSource: 'argument' | 'resource' = 'argument';

        if (messageResourceUri) {
          const r = resourceStore.read(messageResourceUri);
          if (!r) throw new Error(`Resource not found: ${messageResourceUri}`);
          message = r.text;
          messageSource = 'resource';
        } else {
          message = mustBeString(args['message'], 'message');
        }

        const iconRaw = asOptionalString(args['icon']);
        const callbackRaw = asOptionalString(args['callback']);
        const useFluxStorage = (asOptionalBoolean(args['useFluxStorage']) ?? false) === true;
        const icon = iconRaw ?? 'https://raw.githubusercontent.com/runonflux/flux/master/zelID.svg';

        let messageToSign = message;
        let storageUrl: string | null = null;
        let warning: string | null = null;

        if (message.length > 1800) {
          if (useFluxStorage) {
            requireConfirm(args, 'upload message to Flux Storage');
            storageUrl = await uploadToFluxStorage(message);
            messageToSign = `FLUX_URL=${storageUrl}`;
          } else {
            warning = 'Message length > 1800 chars. Zelcore may reject it. Re-run with useFluxStorage=true (confirm required) to upload and sign a FLUX_URL.';
          }
        }

        const callback = callbackRaw ? `&callback=${encodeURIComponent(callbackRaw)}` : '';
        const link = `zel:?action=sign&message=${encodeURIComponent(messageToSign)}&icon=${encodeURIComponent(icon)}${callback}`;

        const out = {
          ok: true,
          link,
          messageLength: message.length,
          usedFluxStorage: Boolean(storageUrl),
          storageUrl,
          warning,
          messageSource,
          messageResourceUri: messageSource === 'resource' ? messageResourceUri : null,
        };

        return jsonResult(out, { structuredContent: out });
      }

      case 'flux_write_message_to_sign': {
        requireConfirm(args, 'write messageToSign to disk');
        const path = mustBeString(args['path'], 'path');
        const messageToSign = mustBeString(args['messageToSign'], 'messageToSign');
        const overwrite = (asOptionalBoolean(args['overwrite']) ?? false) === true;
        const messageToSignSha256 = createHash('sha256').update(messageToSign, 'utf8').digest('hex');
        const messageToSignBytes = Buffer.byteLength(messageToSign, 'utf8');

        await fs.writeFile(path, messageToSign, {
          encoding: 'utf8',
          flag: overwrite ? 'w' : 'wx',
        });

        return jsonResult({ ok: true, path, messageToSignSha256, messageToSignBytes });
      }

      case 'flux_apps_signing_playbook': {
        const type = mustBeString(args['type'], 'type') as 'fluxappregister' | 'fluxappupdate' | 'zelappregister' | 'zelappupdate';
        if (type !== 'fluxappregister' && type !== 'fluxappupdate' && type !== 'zelappregister' && type !== 'zelappupdate') {
          throw new Error('type must be one of: fluxappregister, fluxappupdate, zelappregister, zelappupdate');
        }

        const version = mustBeNumber(args['version'], 'version');
        const spec = mustBeObject(args['spec'], 'spec');
        const timestamp = asOptionalNumber(args['timestamp']) ?? Date.now();
        if (!Number.isFinite(timestamp)) throw new Error('timestamp must be a finite number');

        const includeMessageToSign = (asOptionalBoolean(args['includeMessageToSign']) ?? false) === true;
        const includeNextActionArgs = (asOptionalBoolean(args['includeNextActionArgs']) ?? false) === true;

        const messageToSign = buildMessageToSign({ type, version, spec, timestamp });
        const messageToSignSha256 = createHash('sha256').update(messageToSign, 'utf8').digest('hex');
        const messageToSignBytes = Buffer.byteLength(messageToSign, 'utf8');
        const link = resourceStore.putText({
          kind: 'message_to_sign',
          name: `messageToSign ${type}`,
          description: 'Raw messageToSign bytes (exact data to sign)',
          mimeType: 'text/plain',
          text: messageToSign,
        });

        const nextActions = includeNextActionArgs
          ? [
              {
                tool: 'flux_build_message_to_sign',
                arguments: { type, version, spec, timestamp, includeMessageToSign: true },
              },
              { tool: 'flux_apps_plan_registration', arguments: { spec, timestamp, typeVersion: version } },
              { tool: 'flux_apps_plan_update', arguments: { spec, timestamp, typeVersion: version } },
            ]
          : [
              {
                tool: 'flux_build_zelcore_sign_link',
                note: 'Build a wallet deeplink. Pass the raw message from messageToSignResourceUri.',
              },
              {
                tool: 'flux_write_message_to_sign',
                note: 'Write messageToSign to disk for manual signing (confirm required).',
              },
              {
                tool: 'flux_apps_plan_registration',
                note: 'If registering: call with the same spec + timestamp + typeVersion.',
              },
              {
                tool: 'flux_apps_plan_update',
                note: 'If updating: call with the same spec + timestamp + typeVersion.',
              },
            ];

        const out: Record<string, unknown> = {
          ok: true,
          type,
          version,
          timestamp,
          messageToSignSha256,
          messageToSignBytes,
          messageToSignResourceUri: link.uri,
          signatureNotes: {
            loginSignature: 'Sign loginPhrase for zelidauth (auth).',
            appSignature: 'Sign messageToSign for app register/update.',
          },
          nextActions,
        };

        if (includeMessageToSign) {
          const details = buildMessageToSignDetails(messageToSign);
          Object.assign(out, { messageToSign, ...details });
        }

        return {
          content: [{ type: 'text', text: JSON.stringify(out, null, 2) }, { type: 'resource_link', ...link }],
          structuredContent: out,
          isError: false,
        };
      }

      case 'flux_list_endpoint_categories': {
        if (!inventory) {
          const out = { error: 'Endpoint inventory not found', endpointsPath };
          return jsonResult(out, { isError: true, structuredContent: out });
        }
        return jsonResult({
          routeCount: inventory.routeCount,
          categories: summarizeByCategory(inventory.routes),
        });
      }

       case 'flux_search_endpoints': {
         if (!inventory) {
           const out = { error: 'Endpoint inventory not found', endpointsPath };
           return jsonResult(out, { isError: true, structuredContent: out });
         }
         const query = asOptionalString(args['query']);
         const category = asOptionalString(args['category']);
         const access = asOptionalString(args['access']);
         const method = asOptionalString(args['method']);
         const limit = asOptionalNumber(args['limit']);
 
         const results = searchRoutes(inventory.routes, { query, category, access, method, limit });
         const ok = results.length > 0;
         const status = ok ? 'ok' : 'not_found';

        const link = resourceStore.putJson({
          kind: 'inventory/search',
          name: 'Endpoint search results',
          description: 'Full results from flux_search_endpoints',
          value: { query, category, access, method, limit, results },
        });

        const headers = ['Method', 'Path', 'Access', 'Category', 'Notes'];
        const rows = results.map((r) => [
          r.method,
          r.path,
          r.access,
          r.category,
          r.deprecated ? 'DEPRECATED' : r.localOnly ? 'LOCAL-ONLY' : r.cache ? `cache=${r.cache}` : '',
        ]);

        const summary = {
          ok,
          status,
          query: query ?? null,
          category: category ?? null,
          access: access ?? null,
          method: method ?? null,
          count: results.length,
          resourceUri: link.uri,
          nextActions: results.slice(0, 5).map((r) => ({
            tool: 'flux_request',
            arguments: {
              method: r.method,
              path: r.path,
            },
          })),
        };

        return buildTableResult({
          headers,
          rows,
          maxRows: 50,
          summary,
          resource: link,
        });
      }

      case 'flux_explorer_height_info': {
        const secondsPerBlockRaw = asOptionalNumber(args['secondsPerBlock']);
        const secondsPerBlock = secondsPerBlockRaw && secondsPerBlockRaw > 0 ? secondsPerBlockRaw : 30;

        const scannedHeightRes = await client.request('/explorer/scannedheight');
        const scanned = unwrapFluxEnvelope<Record<string, unknown>>(scannedHeightRes.data);

        const currentHeightRaw = scanned?.['generalScannedHeight'];
        const currentHeight = typeof currentHeightRaw === 'number' ? currentHeightRaw : Number(currentHeightRaw);
        if (!Number.isFinite(currentHeight)) throw new Error('Could not parse explorer scanned height from /explorer/scannedheight');

        const out = {
          ok: scannedHeightRes.ok,
          status: scannedHeightRes.status,
          currentHeight,
          secondsPerBlock,
          approxBlocksPerHour: Math.floor((60 * 60) / secondsPerBlock),
          approxBlocksPerDay: Math.floor((24 * 60 * 60) / secondsPerBlock),
        };

        return jsonResult(out, { structuredContent: out });
      }

      case 'flux_explorer_status': {
        const secondsPerBlockRaw = asOptionalNumber(args['secondsPerBlock']);
        const secondsPerBlock = secondsPerBlockRaw && secondsPerBlockRaw > 0 ? secondsPerBlockRaw : 30;

        const [scannedHeightRes, isSyncedRes] = await Promise.all([
          client.request('/explorer/scannedheight'),
          client.request('/explorer/issynced'),
        ]);

        const scanned = unwrapFluxEnvelope<Record<string, unknown>>(scannedHeightRes.data);
        const currentHeightRaw = scanned?.['generalScannedHeight'];
        const currentHeight = typeof currentHeightRaw === 'number' ? currentHeightRaw : Number(currentHeightRaw);

        const isSyncedPayload = unwrapFluxEnvelope<unknown>(isSyncedRes.data);
         const isSynced = typeof isSyncedPayload === 'boolean'
           ? isSyncedPayload
           : typeof isSyncedPayload === 'string'
             ? isSyncedPayload.toLowerCase() === 'true'
             : Boolean(isSyncedPayload);

         const approxSecondsBehind = isSynced === true ? 0 : null;

         const rows: string[][] = [

          ['isSynced', isSyncedRes.ok ? String(isSynced) : 'unknown'],
          ['scannedHeight', Number.isFinite(currentHeight) ? String(Math.trunc(currentHeight)) : 'unknown'],
          ['secondsPerBlock', String(secondsPerBlock)],
          ['approxBlocksPerDay', String(Math.floor((24 * 60 * 60) / secondsPerBlock))],
          ['approxBlocksPerHour', String(Math.floor((60 * 60) / secondsPerBlock))],
          ['approxBehind', approxSecondsBehind === null ? 'unknown' : formatDurationSeconds(approxSecondsBehind)],
        ];


        const link = resourceStore.putJson({
          kind: 'explorer/status',
          name: 'Explorer status',
          description: 'Explorer status payloads',
          value: {
            secondsPerBlock,
            raw: {
              scannedheight: scannedHeightRes,
              issynced: isSyncedRes,
            },
          },
        });

         const summary = {
           ok: scannedHeightRes.ok && isSyncedRes.ok,
           status: scannedHeightRes.ok && isSyncedRes.ok ? 'ok' : 'partial',
           currentHeight: Number.isFinite(currentHeight) ? Math.trunc(currentHeight) : null,
           isSynced,
           approxSecondsBehind,
           secondsPerBlock,
           approxBlocksPerHour: Math.floor((60 * 60) / secondsPerBlock),
           approxBlocksPerDay: Math.floor((24 * 60 * 60) / secondsPerBlock),
         };

         return buildTableResult({
           headers: ['Metric', 'Value'],
           rows,
           maxRows: 50,
           summary: { ...summary, resourceUri: link.uri },
           resource: link,
         });
      }

      case 'flux_explorer_balance_summary': {
        const address = mustBeString(args['address'], 'address');

        const balanceRes = await client.request(`/explorer/balance/${encodeURIComponent(address)}`);
        const raw = unwrapFluxEnvelope<unknown>(balanceRes.data);

        const parsed = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
        const confirmed = typeof parsed.confirmed === 'number' ? parsed.confirmed : Number(parsed.confirmed);
        const unconfirmed = typeof parsed.unconfirmed === 'number' ? parsed.unconfirmed : Number(parsed.unconfirmed);
        const total = typeof parsed.balance === 'number' ? parsed.balance : Number(parsed.balance);

        const rows: string[][] = [
          ['address', address],
          ['confirmed', Number.isFinite(confirmed) ? String(confirmed) : '-'],
          ['unconfirmed', Number.isFinite(unconfirmed) ? String(unconfirmed) : '-'],
          ['balance', Number.isFinite(total) ? String(total) : '-'],
        ];

        const link = resourceStore.putJson({
          kind: 'explorer/balance_summary',
          name: `Balance summary ${address}`,
          description: 'Explorer balance payload',
          value: {
            address,
            raw: {
              balance: balanceRes,
            },
          },
        });

        const ok = isFluxEnvelopeOk(balanceRes);

        const summary = {
          ok,
          httpStatus: balanceRes.status,
          address,
          confirmed: Number.isFinite(confirmed) ? confirmed : null,
          unconfirmed: Number.isFinite(unconfirmed) ? unconfirmed : null,
          balance: Number.isFinite(total) ? total : null,
        };

        return buildTableResult({
          headers: ['Metric', 'Value'],
          rows,
          maxRows: 50,
          summary: { ...summary, resourceUri: link.uri },
          resource: link,
        });
      }

      case 'flux_daemon_call': {
        if (asOptionalBoolean(args['allowMutation']) === true) {
          throw new Error('flux_daemon_call only supports read-only methods; allowMutation must remain false');
        }

        const method = validateDaemonMethod(mustBeString(args['method'], 'method'));
        if (!isAllowedDaemonReadOnlyMethod(method)) {
          throw new Error(`Daemon method "${method}" is not in the read-only allowlist`);
        }

        const params = validateDaemonParams(args['params']);
        const redactTxHex = (asOptionalBoolean(args['redactTxHex']) ?? true) === true;

        const path = params.length > 0 ? `/daemon/${method}/${params.map((p) => encodeURIComponent(String(p))).join('/')}` : `/daemon/${method}`;
        const res = await client.request(path);
        const rawData = unwrapFluxEnvelope<unknown>(res.data);

        const redacted = redactSensitive(rawData, {
          maxDepth: 8,
          maxArrayLength: 100,
          maxStringLength: 512,
          redactTxHex,
        });

        const link = resourceStore.putJson({
          kind: `daemon/${method}`,
          name: `Daemon ${method}`,
          description: `Response from /daemon/${method}`,
          value: { method, params, redacted, raw: rawData },
        });

        if (method === 'getpeerinfo' && Array.isArray(redacted)) {
          const peers = redacted as Record<string, unknown>[];
          const rows: string[][] = peers.map((p) => [
            String(p['addr'] ?? '-'),
            String(p['subver'] ?? '-'),
            String(p['inbound'] ?? '-'),
            String(p['conntime'] ?? '-'),
          ]);

          const ok = isFluxEnvelopeOk(res);

          return buildTableResult({
            headers: ['addr', 'subver', 'inbound', 'conntime'],
            rows,
            maxRows: 50,
            summary: { ok, httpStatus: res.status, method, peerCount: peers.length, resourceUri: link.uri },
            resource: link,
          });
        }

        const rows: string[][] = Object.entries(typeof redacted === 'object' && redacted !== null && !Array.isArray(redacted) ? (redacted as Record<string, unknown>) : { result: redacted }).map(([k, v]) => [k, typeof v === 'object' ? JSON.stringify(v) : String(v)]);

        const ok = isFluxEnvelopeOk(res);

        return buildTableResult({
          headers: ['Key', 'Value'],
          rows,
          maxRows: 50,
          summary: { ok, httpStatus: res.status, method, resourceUri: link.uri },
          resource: link,
        });
      }

      case 'flux_daemon_get_info': {
        return callTool('flux_daemon_call', { method: 'getinfo' });
      }

      case 'flux_daemon_get_blockchain_info': {
        return callTool('flux_daemon_call', { method: 'getblockchaininfo' });
      }

      case 'flux_daemon_get_network_info': {
        return callTool('flux_daemon_call', { method: 'getnetworkinfo' });
      }

      case 'flux_daemon_get_peer_info': {
        return callTool('flux_daemon_call', { method: 'getpeerinfo' });
      }

      case 'flux_daemon_get_mempool_info': {
        return callTool('flux_daemon_call', { method: 'getmempoolinfo' });
      }

      case 'flux_daemon_get_raw_mempool': {
        const verbose = (asOptionalBoolean(args['verbose']) ?? false) === true;
        return callTool('flux_daemon_call', { method: 'getrawmempool', params: verbose ? [true] : [] });
      }

      case 'flux_daemon_get_block_count': {
        return callTool('flux_daemon_call', { method: 'getblockcount' });
      }

      case 'flux_daemon_get_connection_count': {
        return callTool('flux_daemon_call', { method: 'getconnectioncount' });
      }

      case 'flux_daemon_get_difficulty': {
        return callTool('flux_daemon_call', { method: 'getdifficulty' });
      }

      case 'flux_explorer_restart': {
        requireConfirm(args, 'explorer/restart');
        return jsonResult(await client.request('/explorer/restart', { allowMutation: true }));
      }

      case 'flux_explorer_stop': {
        requireConfirm(args, 'explorer/stop');
        return jsonResult(await client.request('/explorer/stop', { allowMutation: true }));
      }

      case 'flux_explorer_reindex': {
        requireConfirm(args, 'explorer/reindex');
        const reindexapps = (asOptionalBoolean(args['reindexapps']) ?? false) === true;
        const path = reindexapps ? '/explorer/reindex/true' : '/explorer/reindex';
        return jsonResult(await client.request(path, { allowMutation: true }));
      }

      case 'flux_explorer_rescan': {
        requireConfirm(args, 'explorer/rescan');
        const blockheight = asOptionalNumber(args['blockheight']);
        const rescanapps = (asOptionalBoolean(args['rescanapps']) ?? false) === true;

        const parts: string[] = ['/explorer/rescan'];
        if (blockheight !== undefined) parts.push(String(Math.floor(blockheight)));
        if (rescanapps) {
          if (blockheight === undefined) parts.push('');
          parts.push('true');
        }
        const path = parts.join('/');

        return jsonResult(await client.request(path, { allowMutation: true }));
      }

      case 'flux_backup_get_volume_data': {
        const appname = asOptionalString(args['appname']);
        const component = asOptionalString(args['component']);
        const multiplier = asOptionalNumber(args['multiplier']);
        const decimal = asOptionalNumber(args['decimal']);
        const fields = asOptionalString(args['fields']);

        const parts: string[] = ['/backup/getvolumedataofcomponent'];
        if (appname !== undefined) parts.push(encodeURIComponent(appname));
        if (component !== undefined) {
          if (appname === undefined) parts.push('');
          parts.push(encodeURIComponent(component));
        }
        if (multiplier !== undefined) {
          while (parts.length < 4) parts.push('');
          parts.push(String(multiplier));
        }
        if (decimal !== undefined) {
          while (parts.length < 5) parts.push('');
          parts.push(String(decimal));
        }
        if (fields !== undefined) {
          while (parts.length < 6) parts.push('');
          parts.push(encodeURIComponent(fields));
        }

        return jsonResult(await client.request(parts.join('/')));
      }

      case 'flux_backup_get_remote_file_size': {
        const fileurl = mustBeString(args['fileurl'], 'fileurl');
        const appname = asOptionalString(args['appname']);
        const multiplier = asOptionalNumber(args['multiplier']);
        const decimal = asOptionalNumber(args['decimal']);
        const number = asOptionalNumber(args['number']);

        const parts: string[] = ['/backup/getremotefilesize', encodeURIComponent(fileurl)];
        if (multiplier !== undefined) parts.push(String(multiplier));
        if (decimal !== undefined) {
          while (parts.length < 4) parts.push('');
          parts.push(String(decimal));
        }
        if (number !== undefined) {
          while (parts.length < 5) parts.push('');
          parts.push(String(number));
        }
        if (appname !== undefined) {
          while (parts.length < 6) parts.push('');
          parts.push(encodeURIComponent(appname));
        }

        return jsonResult(await client.request(parts.join('/')));
      }

      case 'flux_backup_list_local': {
        const backupPath = asOptionalString(args['path']);
        const appname = asOptionalString(args['appname']);
        const multiplier = asOptionalNumber(args['multiplier']);
        const decimal = asOptionalNumber(args['decimal']);
        const number = asOptionalNumber(args['number']);

        const parts: string[] = ['/backup/getlocalbackuplist'];
        if (backupPath !== undefined) parts.push(encodeURIComponent(backupPath));
        if (multiplier !== undefined) {
          if (backupPath === undefined) parts.push('');
          parts.push(String(multiplier));
        }
        if (decimal !== undefined) {
          while (parts.length < 3) parts.push('');
          parts.push(String(decimal));
        }
        if (number !== undefined) {
          while (parts.length < 4) parts.push('');
          parts.push(String(number));
        }
        if (appname !== undefined) {
          while (parts.length < 5) parts.push('');
          parts.push(encodeURIComponent(appname));
        }

        return jsonResult(await client.request(parts.join('/')));
      }

      case 'flux_backup_remove_file': {
        requireConfirm(args, 'backup/removebackupfile');
        const filepath = mustBeString(args['filepath'], 'filepath');
        const appname = asOptionalString(args['appname']);
        const path = appname
          ? `/backup/removebackupfile/${encodeURIComponent(filepath)}/${encodeURIComponent(appname)}`
          : `/backup/removebackupfile/${encodeURIComponent(filepath)}`;
        return jsonResult(await client.request(path, { allowMutation: true }));
      }

      case 'flux_backup_download_local_file': {
        requireConfirm(args, 'backup/downloadlocalfile');
        const filepath = mustBeString(args['filepath'], 'filepath');
        const appname = asOptionalString(args['appname']);
        const maxBytes = asOptionalNumber(args['maxBytes']);

        const path = appname
          ? `/backup/downloadlocalfile/${encodeURIComponent(filepath)}/${encodeURIComponent(appname)}`
          : `/backup/downloadlocalfile/${encodeURIComponent(filepath)}`;

        return jsonResult(await client.request(path, { responseType: 'base64', maxBytes, allowMutation: true }));
      }

      case 'flux_ioutils_file_upload_from_url': {
        requireConfirm(args, 'ioutils/fileupload');
        const type = mustBeString(args['type'], 'type');
        const appname = mustBeString(args['appname'], 'appname');
        const component = mustBeString(args['component'], 'component');
        const filename = mustBeString(args['filename'], 'filename');
        const folder = asOptionalString(args['folder']) ?? 'null';
        const fileurl = mustBeString(args['fileurl'], 'fileurl');

        const timeoutMsRaw = asOptionalNumber(args['timeoutMs']);
        const timeoutMs = timeoutMsRaw === undefined ? 15 * 60 * 1000 : Math.floor(timeoutMsRaw);
        if (timeoutMs <= 0) throw new Error('timeoutMs must be a positive number');

        const maxDownloadBytesRaw = asOptionalNumber(args['maxDownloadBytes']);
        const maxDownloadBytes = maxDownloadBytesRaw === undefined ? 1024 * 1024 * 1024 : Math.floor(maxDownloadBytesRaw);
        if (maxDownloadBytes <= 0) throw new Error('maxDownloadBytes must be a positive number');

        const allowProxy = asOptionalBoolean(args['allowProxy']) ?? false;
        const baseUrl = client.getBaseUrl();
        if (!allowProxy && baseUrl) {
          const u = new URL(baseUrl);
          const host = u.hostname.toLowerCase();
          const isProxyHost = host === 'api.runonflux.io' || host.endsWith('.node.api.runonflux.io');
          if (isProxyHost) {
            throw new Error(
              'Refusing to call /ioutils/fileupload via gateway/proxy baseUrl. Use a direct node URL like http://<node-ip>:<port> (set allowProxy=true to override).'
            );
          }
        }

        const dl = await fetch(fileurl);
        if (!dl.ok) throw new Error(`Failed to download fileurl (HTTP ${dl.status})`);

        const contentLengthHeader = dl.headers.get('content-length');
        if (contentLengthHeader) {
          const contentLength = Number(contentLengthHeader);
          if (Number.isFinite(contentLength) && contentLength > maxDownloadBytes) {
            throw new Error(`Remote file too large (${contentLength} bytes) for maxDownloadBytes=${maxDownloadBytes}`);
          }
        }

        const bytes = Buffer.from(await dl.arrayBuffer());
        if (bytes.length > maxDownloadBytes) {
          throw new Error(`Remote file too large (${bytes.length} bytes) for maxDownloadBytes=${maxDownloadBytes}`);
        }

        const apiPath = `/ioutils/fileupload/${encodeURIComponent(type)}/${encodeURIComponent(appname)}/${encodeURIComponent(
          component
        )}/${encodeURIComponent(folder)}/${encodeURIComponent(filename)}`;

        const form = new FormData();
        form.set(filename, new Blob([bytes]), filename);

        return jsonResult(
          await client.request(apiPath, {
            method: 'POST',
            allowMutation: true,
            bodyType: 'multipart',
            body: form,
            responseType: 'text',
            timeoutMs,
          })
        );
      }

      case 'flux_apps_append_backup_task': {
        requireConfirm(args, 'apps/appendbackuptask');
        const appname = mustBeString(args['appname'], 'appname');

        const timeoutMsRaw = asOptionalNumber(args['timeoutMs']);
        const timeoutMs = timeoutMsRaw === undefined ? 10 * 60 * 1000 : Math.floor(timeoutMsRaw);
        if (timeoutMs <= 0) throw new Error('timeoutMs must be a positive number');

        let backup = args['backup'];
        if (backup === undefined || backup === null) {
          const specRes = await client.request(`/apps/appspecifications/${encodeURIComponent(appname)}`);
          const spec = unwrapFluxEnvelope<Record<string, unknown> | null>(specRes.data);
          const compose = spec && typeof spec === 'object' && Array.isArray(spec.compose) ? spec.compose : [];
          backup = compose
            .map((c) => ({ component: typeof c.name === 'string' ? c.name : undefined, backup: true }))
            .filter((x) => typeof x.component === 'string');
        }

        if (!Array.isArray(backup)) throw new Error('backup must be an array when provided');

        const payload = { appname, backup };
        const res = await client.request('/apps/appendbackuptask', {
          method: 'POST',
          body: payload,
          allowMutation: true,
          responseType: 'text',
          timeoutMs,
        });

        const text = typeof res.data === 'string' ? res.data : JSON.stringify(res.data, null, 2);
        const parsed = parseProgressOutput(text);

        const link = resourceStore.putJson({
          kind: 'apps/appendbackuptask',
          name: `${appname} backup task`,
          description: 'Parsed /apps/appendbackuptask output',
          value: { request: payload, response: res, parsed },
        });

        const summary = {
          ok: res.ok,
          status: res.status,
          appname,
          requested: payload,
          eventCount: parsed.events.length,
          resourceUri: link.uri,
          events: parsed.events.slice(0, 25),
          nextActions: [
            { tool: 'flux_resource_read', arguments: { uri: link.uri } },
            { tool: 'flux_apps_logs', arguments: { appname } },
          ],
        };

        return {
          content: [
            { type: 'text', text: JSON.stringify(summary, null, 2) },
            { type: 'resource_link', ...link },
          ],
          structuredContent: summary,
          isError: !res.ok,
        };
      }

      case 'flux_apps_append_restore_task': {
        requireConfirm(args, 'apps/appendrestoretask');
        const appname = mustBeString(args['appname'], 'appname');
        const type = mustBeString(args['type'], 'type');

        const timeoutMsRaw = asOptionalNumber(args['timeoutMs']);
        const timeoutMs = timeoutMsRaw === undefined ? 10 * 60 * 1000 : Math.floor(timeoutMsRaw);
        if (timeoutMs <= 0) throw new Error('timeoutMs must be a positive number');
        if (type !== 'local' && type !== 'remote' && type !== 'upload') {
          throw new Error('type must be one of: local, remote, upload');
        }

        let restore = args['restore'];
        if (restore === undefined || restore === null) {
          const specRes = await client.request(`/apps/appspecifications/${encodeURIComponent(appname)}`);
          const spec = unwrapFluxEnvelope<Record<string, unknown> | null>(specRes.data);
          const compose = spec && typeof spec === 'object' && Array.isArray(spec.compose) ? spec.compose : [];
          restore = compose
            .map((c) => ({ component: typeof c.name === 'string' ? c.name : undefined, restore: true, url: '' }))
            .filter((x) => typeof x.component === 'string');
        }

        if (!Array.isArray(restore)) throw new Error('restore must be an array when provided');

        const payload = { appname, restore, type };
        const res = await client.request('/apps/appendrestoretask', {
          method: 'POST',
          body: payload,
          allowMutation: true,
          responseType: 'text',
          timeoutMs,
        });

        const text = typeof res.data === 'string' ? res.data : JSON.stringify(res.data, null, 2);
        const parsed = parseProgressOutput(text);

        const link = resourceStore.putJson({
          kind: 'apps/appendrestoretask',
          name: `${appname} restore task`,
          description: 'Parsed /apps/appendrestoretask output',
          value: { request: payload, response: res, parsed },
        });

        const summary = {
          ok: res.ok,
          status: res.status,
          appname,
          type,
          requested: payload,
          eventCount: parsed.events.length,
          resourceUri: link.uri,
          events: parsed.events.slice(0, 25),
          nextActions: [
            { tool: 'flux_resource_read', arguments: { uri: link.uri } },
            { tool: 'flux_apps_logs', arguments: { appname } },
          ],
        };

        return {
          content: [
            { type: 'text', text: JSON.stringify(summary, null, 2) },
            { type: 'resource_link', ...link },
          ],
          structuredContent: summary,
          isError: !res.ok,
        };
      }

      case 'flux_maintenance_checklist': {
        const items = [
          {
            title: 'Confirm baseUrl points to a healthy node',
            safe: true,
            nextActions: [
              { tool: 'flux_node_health', arguments: {} },
              { tool: 'flux_get_state', arguments: {} },
            ],
          },
          {
            title: 'Check explorer sync + height',
            safe: true,
            nextActions: [
              { tool: 'flux_explorer_status', arguments: {} },
              { tool: 'flux_explorer_height_info', arguments: {} },
            ],
          },
          {
            title: 'Check Syncthing health',
            safe: true,
            nextActions: [
              { tool: 'flux_syncthing_metrics_health', arguments: {} },
              { tool: 'flux_syncthing_system_status', arguments: {} },
            ],
          },
          {
            title: 'Check running apps on this node',
            safe: true,
            nextActions: [{ tool: 'flux_apps_list_running', arguments: {} }],
          },
          {
            title: 'Investigate an app globally',
            safe: true,
            nextActions: [
              { tool: 'flux_apps_global_status', arguments: { limit: 50 } },
              { tool: 'flux_apps_troubleshoot', arguments: { appname: '<appname>' } },
            ],
          },
          {
            title: 'Restart Syncthing (requires confirm)',
            safe: false,
            nextActions: [{ tool: 'flux_syncthing_restart', arguments: { confirm: true } }],
          },
          {
            title: 'Restart explorer (requires confirm)',
            safe: false,
            nextActions: [{ tool: 'flux_explorer_restart', arguments: { confirm: true } }],
          },
          {
            title: 'Rescan explorer (requires confirm)',
            safe: false,
            nextActions: [
              { tool: 'flux_explorer_rescan', arguments: { confirm: true } },
              { tool: 'flux_explorer_rescan', arguments: { blockheight: 0, rescanapps: true, confirm: true } },
            ],
          },
          {
            title: 'Reindex explorer (requires confirm)',
            safe: false,
            nextActions: [
              { tool: 'flux_explorer_reindex', arguments: { confirm: true } },
              { tool: 'flux_explorer_reindex', arguments: { reindexapps: true, confirm: true } },
            ],
          },
        ];

        const summary = {
          ok: true,
          count: items.length,
          checklist: items,
        };

        return jsonResult(summary, { structuredContent: summary });
      }

      case 'flux_request': {
        const method = asOptionalString(args['method']);
        const pathname = mustBeString(args['path'], 'path');
        const queryRaw = args['query'];
        const body = args['body'];
        const zelidauth = args['zelidauth'];
        const useStoredZelidauth = asOptionalBoolean(args['useStoredZelidauth']);
        const enterpriseKey = args['enterpriseKey'];
        const useStoredEnterpriseKey = asOptionalBoolean(args['useStoredEnterpriseKey']);
        const timeoutMs = asOptionalNumber(args['timeoutMs']);
        const allowMutation = (asOptionalBoolean(args['allowMutation']) ?? false) === true;
        const responseType = asResponseType(args['responseType']);
        const maxBytes = asOptionalNumber(args['maxBytes']);
        const includeBody = (asOptionalBoolean(args['includeBody']) ?? false) === true;

        let query: Record<string, unknown> | undefined;
        if (queryRaw !== undefined) {
          if (!queryRaw || typeof queryRaw !== 'object' || Array.isArray(queryRaw)) {
            throw new Error('query must be an object when provided (e.g. {"appname":"myapp"})');
          }
          query = queryRaw as Record<string, unknown>;
        }

        const res = await client.request(pathname, {
          method,
          query,
          body,
          zelidauth,
          useStoredZelidauth,
          enterpriseKey,
          useStoredEnterpriseKey,
          timeoutMs,
          allowMutation,
          responseType,
          maxBytes,
        });

        const link = resourceStore.putJson({
          kind: 'flux/request',
          name: `${(method ?? (body === undefined ? 'GET' : 'POST')).toUpperCase()} ${pathname}`,
          description: 'Raw flux_request response + request params',
          value: {
            request: {
              method: method ?? null,
              path: pathname,
              query: query ?? null,
              allowMutation,
              responseType: responseType ?? 'auto',
              maxBytes: maxBytes ?? null,
              timeoutMs: timeoutMs ?? null,
              usedStoredZelidauth: useStoredZelidauth !== false,
              usedStoredEnterpriseKey: useStoredEnterpriseKey !== false,
            },
            response: res,
          },
        });

        const summary = {
          ok: res.ok,
          status: res.status,
          method: (method ?? (body === undefined ? 'GET' : 'POST')).toUpperCase(),
          path: pathname,
          fluxOk: res.ok ? isFluxSuccess(res.data) : false,
          error: res.ok ? (extractFluxErrorMessage(res.data) ?? null) : (extractFluxErrorMessage(res.data) ?? String(res.data)),
          resourceUri: link.uri,
        };

        const content: Array<
          | { type: 'text'; text: string }
          | { type: 'resource_link'; uri: string; name: string; description?: string; mimeType?: string }
        > = [{ type: 'text', text: JSON.stringify(summary, null, 2) }, { type: 'resource_link', ...link }];

        if (includeBody) {
          content.push({ type: 'text', text: `\n\n${JSON.stringify(res, null, 2)}` });
        }

        return {
          content,
          structuredContent: summary,
          isError: summary.ok !== true || summary.fluxOk !== true,
        };
      }

      case 'flux_node_health': {
        const [versionRes, infoRes, isArcaneRes] = await Promise.all([
          client.request('/flux/version'),
          client.request('/flux/info'),
          client.request('/flux/isarcaneos'),
        ]);

        const link = resourceStore.putJson({
          kind: 'flux/node_health',
          name: 'Node health',
          description: 'Raw /flux/version + /flux/info + /flux/isarcaneos responses',
          value: { version: versionRes, info: infoRes, isarcaneos: isArcaneRes },
        });

        const versionPayload = unwrapFluxEnvelope<unknown>(versionRes.data);
        const versionObj = versionPayload && typeof versionPayload === 'object' && !Array.isArray(versionPayload) ? (versionPayload as Record<string, unknown>) : null;
        const fluxVersion =
          typeof versionObj?.version === 'string'
            ? versionObj.version
            : typeof versionPayload === 'string'
              ? versionPayload
              : null;

        const infoPayload = unwrapFluxEnvelope<unknown>(infoRes.data);
        const infoObj = infoPayload && typeof infoPayload === 'object' && !Array.isArray(infoPayload) ? (infoPayload as Record<string, unknown>) : null;
        const fluxObj = infoObj && infoObj.flux && typeof infoObj.flux === 'object' && !Array.isArray(infoObj.flux) ? (infoObj.flux as Record<string, unknown>) : null;

        const ip = typeof fluxObj?.ip === 'string' ? fluxObj.ip : null;
        const zelid = typeof fluxObj?.zelid === 'string' ? fluxObj.zelid : null;
        const nodeJsVersion = typeof fluxObj?.nodeJsVersion === 'string' ? fluxObj.nodeJsVersion : null;
        const dockerVersion = typeof fluxObj?.dockerVersion === 'string' ? fluxObj.dockerVersion : null;
        const syncthingVersion = typeof fluxObj?.syncthingVersion === 'string' ? fluxObj.syncthingVersion : null;
        const osPrettyName = typeof fluxObj?.osPrettyName === 'string' ? fluxObj.osPrettyName : null;
        const arcaneVersion = typeof fluxObj?.arcaneVersion === 'string' ? fluxObj.arcaneVersion : null;
        const arcaneHumanVersion = typeof fluxObj?.arcaneHumanVersion === 'string' ? fluxObj.arcaneHumanVersion : null;

        const isArcanePayload = unwrapFluxEnvelope<unknown>(isArcaneRes.data);
        const isArcane = typeof isArcanePayload === 'boolean'
          ? isArcanePayload
          : typeof isArcanePayload === 'string'
            ? isArcanePayload.trim().toLowerCase() === 'true'
            : null;

        const ok = isFluxEnvelopeOk(versionRes) && isFluxEnvelopeOk(infoRes) && isFluxEnvelopeOk(isArcaneRes);
        const summary = {
          ok,
          baseUrl: client.getBaseUrl(),
          fluxVersion,
          ip,
          zelid,
          isArcane,
          nodeJsVersion,
          syncthingVersion,
          dockerVersion,
          osPrettyName,
          arcaneVersion,
          arcaneHumanVersion,
          resourceUri: link.uri,
        };

        const rows: string[][] = [
          ['baseUrl', summary.baseUrl ?? '-'],
          ['ip', ip ?? '-'],
          ['zelid', zelid ?? '-'],
          ['fluxVersion', fluxVersion ?? (typeof fluxObj?.version === 'string' ? fluxObj.version : '-')],
          ['isArcane', isArcane === null ? '-' : String(isArcane)],
          ['arcaneHumanVersion', arcaneHumanVersion ?? '-'],
          ['arcaneVersion', arcaneVersion ?? '-'],
          ['nodeJsVersion', nodeJsVersion ?? '-'],
          ['syncthingVersion', syncthingVersion ?? '-'],
          ['dockerVersion', dockerVersion ?? '-'],
          ['os', osPrettyName ?? '-'],
        ];

        return buildTableResult({
          headers: ['Metric', 'Value'],
          rows,
          maxRows: 50,
          summary,
          resource: link,
        });
      }

      case 'flux_apps_list_running': {
        const res = await client.request('/apps/listrunningapps');
        const link = resourceStore.putJson({
          kind: 'apps/list_running',
          name: 'Running apps',
          description: 'Raw /apps/listrunningapps response',
          value: res,
        });

        const data = unwrapFluxEnvelope<unknown>(res.data);
        const items = Array.isArray(data)
          ? data.filter((x): x is Record<string, unknown> => !!x && typeof x === 'object' && !Array.isArray(x))
          : [];

        const headers = ['App', 'Component', 'Status', 'IP', 'Port'];
        const rows = items.map((x) => {
          const app = typeof x.app === 'string' ? x.app : typeof x.name === 'string' ? x.name : '-';
          const component = typeof x.component === 'string' ? x.component : '-';
          const status = typeof x.status === 'string' ? x.status : '-';
          const ip = typeof x.ip === 'string' ? x.ip : '-';
          const port = typeof x.port === 'number' ? String(x.port) : typeof x.port === 'string' ? x.port : '-';
          return [app, component, status, ip, port];
        });

        const summary = {
          ok: isFluxEnvelopeOk(res),
          status: res.status,
          count: items.length,
        };
        return buildTableResult({
          headers,
          rows,
          maxRows: 50,
          summary,
          resource: link,
        });
      }

      case 'flux_apps_list_all': {
        const res = await client.request('/apps/listallapps');
        const link = resourceStore.putJson({
          kind: 'apps/list_all',
          name: 'All apps',
          description: 'Raw /apps/listallapps response',
          value: res,
        });

        const data = unwrapFluxEnvelope<unknown>(res.data);
        const names: string[] = Array.isArray(data)
          ? data.filter((x): x is string => typeof x === 'string')
          : [];

        const headers = ['App'];
        const rows = names.map((n) => [n]);

        const summary = {
          ok: isFluxEnvelopeOk(res),
          status: res.status,
          count: names.length,
        };
        return buildTableResult({
          headers,
          rows,
          maxRows: 100,
          summary,
          resource: link,
        });
      }

      case 'flux_apps_list_global_specs': {
        const hash = asOptionalString(args['hash']);
        const owner = asOptionalString(args['owner']);
        const appname = asOptionalString(args['appname']);

        const res = await client.request('/apps/globalappsspecifications', {
          query: {
            hash,
            owner,
            appname,
          },
        });

        const link = resourceStore.putJson({
          kind: 'apps/global_specs',
          name: 'Global app specifications',
          description: 'Raw /apps/globalappsspecifications response',
          value: res,
        });

        const data = unwrapFluxEnvelope<unknown>(res.data);
        const items = Array.isArray(data)
          ? data.filter((x): x is Record<string, unknown> => !!x && typeof x === 'object' && !Array.isArray(x))
          : [];

        const headers = ['App', 'Owner', 'Instances', 'Updated (height)', 'Expire (blocks)', 'Hash'];
        const rows = items.map((x) => {
          const name = typeof x.name === 'string' ? x.name : '-';
          const owner = typeof x.owner === 'string' ? x.owner : '-';
          const instances = typeof x.instances === 'number' ? String(x.instances) : typeof x.instances === 'string' ? x.instances : '-';
          const height = typeof x.height === 'number' ? String(x.height) : typeof x.height === 'string' ? x.height : '-';
          const expire = typeof x.expire === 'number' ? String(x.expire) : typeof x.expire === 'string' ? x.expire : '-';
          const hash = typeof x.hash === 'string' ? x.hash : '-';
          return [name, owner, instances, height, expire, hash];
        });

        const summary = {
          ok: isFluxEnvelopeOk(res),
          status: res.status,
          hash: hash ?? null,
          owner: owner ?? null,
          appname: appname ?? null,
          count: items.length,
        };

        return buildTableResult({
          headers,
          rows,
          maxRows: 50,
          summary,
          resource: link,
        });
      }

      case 'flux_apps_list_by_zelid_with_expiry': {
        const requestedZelid = asOptionalString(args['zelid']);
        const includeExpired = (asOptionalBoolean(args['includeExpired']) ?? false) === true;
        const estimateTimeRemaining = (asOptionalBoolean(args['estimateTimeRemaining']) ?? false) === true;
        const secondsPerBlockRaw = asOptionalNumber(args['secondsPerBlock']);
        const secondsPerBlock = secondsPerBlockRaw && secondsPerBlockRaw > 0 ? secondsPerBlockRaw : 30;

        const limitRaw = asOptionalNumber(args['limit']) ?? 50;
        const limit = Math.max(1, Math.min(200, Math.floor(limitRaw)));

        const stored = client.getZelidauthSummary();
        const zelid = requestedZelid ?? stored.zelid;
        if (!zelid) throw new Error('zelid is required (or set FLUX_ZELIDAUTH / flux_set_zelidauth first).');

        const globalSpecsRes = await client.request('/apps/globalappsspecifications', { query: { owner: zelid } });
        const scannedHeightRes = await client.request('/explorer/scannedheight');
        const registrationInfoRes = await client.request('/apps/registrationinformation');

        const globalSpecs = unwrapFluxEnvelope<unknown[]>(globalSpecsRes.data);
        const scanned = unwrapFluxEnvelope<Record<string, unknown>>(scannedHeightRes.data);
        const regInfo = unwrapFluxEnvelope<Record<string, unknown>>(registrationInfoRes.data);

        const currentHeightRaw = scanned?.['generalScannedHeight'];
        const currentHeight = typeof currentHeightRaw === 'number' ? currentHeightRaw : Number(currentHeightRaw);
        if (!Number.isFinite(currentHeight)) throw new Error('Could not parse explorer scanned height from /explorer/scannedheight');

        const blocksLastingRaw = regInfo?.['blocksLasting'];
        const daemonPONForkRaw = regInfo?.['daemonPONFork'];
        const blocksLasting = typeof blocksLastingRaw === 'number' ? blocksLastingRaw : Number(blocksLastingRaw);
        const daemonPONFork = typeof daemonPONForkRaw === 'number' ? daemonPONForkRaw : Number(daemonPONForkRaw);

        if (!Number.isFinite(blocksLasting) || !Number.isFinite(daemonPONFork)) {
          throw new Error('Could not parse blocksLasting/daemonPONFork from /apps/registrationinformation');
        }

        const apps = Array.isArray(globalSpecs)
          ? globalSpecs.filter((x): x is Record<string, unknown> => !!x && typeof x === 'object' && !Array.isArray(x))
          : [];

        const computed = apps
          .map((app) => {
            const name = typeof app['name'] === 'string' ? (app['name'] as string) : null;
            const owner = typeof app['owner'] === 'string' ? (app['owner'] as string) : null;

            const heightRaw = app['height'];
            const height = typeof heightRaw === 'number' ? heightRaw : Number(heightRaw);

            const expireRaw = app['expire'];
            const expire = expireRaw === undefined || expireRaw === null
              ? null
              : (typeof expireRaw === 'number' ? expireRaw : Number(expireRaw));

            const defaultExpire = height >= daemonPONFork ? blocksLasting * 4 : blocksLasting;
            const expireIn = Number.isFinite(expire as number) ? (expire as number) : defaultExpire;

            const originalExpirationHeight = height + expireIn;
            let expirationHeight = originalExpirationHeight;

            if (height < daemonPONFork && currentHeight >= daemonPONFork && originalExpirationHeight > daemonPONFork) {
              const blocksAfterFork = originalExpirationHeight - daemonPONFork;
              expirationHeight = daemonPONFork + blocksAfterFork * 4;
            }

            const blocksRemaining = expirationHeight - currentHeight;

            return {
              name,
              owner,
              height: Number.isFinite(height) ? height : null,
              expire: Number.isFinite(expire as number) ? (expire as number) : null,
              defaultExpire,
              expireIn,
              originalExpirationHeight,
              expirationHeight,
              currentHeight,
              blocksRemaining,
              expired: blocksRemaining < 0,
            };
          })
          .sort((a, b) => {
            const av = typeof a.blocksRemaining === 'number' ? a.blocksRemaining : 0;
            const bv = typeof b.blocksRemaining === 'number' ? b.blocksRemaining : 0;
            return av - bv;
          });

        const filtered = includeExpired ? computed : computed.filter((x) => x.expired !== true);

        const headers = estimateTimeRemaining
          ? ['App', 'Blocks Left', '~Time Left', 'Expired?', 'Expires (height)', 'Updated (height)', 'Expire Blocks']
          : ['App', 'Blocks Left', 'Expired?', 'Expires (height)', 'Updated (height)', 'Expire Blocks'];

        const rows = filtered.map((x) => {
          const name = typeof x.name === 'string' ? x.name : '-';
          const blocksRemaining = typeof x.blocksRemaining === 'number' ? Math.trunc(x.blocksRemaining) : 0;
          const expired = x.expired === true ? 'yes' : 'no';
          const expiresAt = typeof x.expirationHeight === 'number' ? Math.trunc(x.expirationHeight) : '-';
          const updatedAt = typeof x.height === 'number' ? Math.trunc(x.height) : '-';
          const expireIn = typeof x.expireIn === 'number' ? Math.trunc(x.expireIn) : '-';

          if (!estimateTimeRemaining) return [name, blocksRemaining, expired, expiresAt, updatedAt, expireIn];

          const seconds = estimateSecondsFromBlocks(blocksRemaining, secondsPerBlock);
          const timeLeft = formatDurationSeconds(seconds);
          return [name, blocksRemaining, timeLeft, expired, expiresAt, updatedAt, expireIn];
        });

        const link = resourceStore.putJson({
          kind: 'apps/by_zelid_with_expiry',
          name: `Apps for ${zelid} with expiry`,
          description: 'Computed app expiry list with raw inputs',
          value: {
            zelid,
            options: { includeExpired, limit },
            currentHeight,
            blocksLasting,
            daemonPONFork,
            apps: computed,
            filtered,
            raw: {
              globalappsspecifications: globalSpecsRes,
              scannedheight: scannedHeightRes,
              registrationinformation: registrationInfoRes,
            },
          },
        });

        const summary = {
          ok: globalSpecsRes.ok && scannedHeightRes.ok && registrationInfoRes.ok,
          zelid,
          options: { includeExpired, estimateTimeRemaining, secondsPerBlock, limit },
          count: filtered.length,
          total: computed.length,
          currentHeight,
          blocksLasting,
          daemonPONFork,
        };

        return buildTableResult({
          headers,
          rows,
          maxRows: limit,
          summary,
          resource: link,
        });
      }

      case 'flux_apps_global_status': {
        const requestedZelid = asOptionalString(args['zelid']);
        const requestedAppname = asOptionalString(args['appname']);
        const includeExpired = (asOptionalBoolean(args['includeExpired']) ?? false) === true;
        const limitRaw = asOptionalNumber(args['limit']) ?? 50;
        const limit = Math.max(1, Math.min(200, Math.floor(limitRaw)));

        const stored = client.getZelidauthSummary();
        const zelid = requestedZelid ?? stored.zelid;

        const globalSpecsRes = await client.request('/apps/globalappsspecifications', {
          query: {
            owner: zelid,
            appname: requestedAppname,
          },
        });

        const temporaryRes = await client.request('/apps/temporarymessages');
        const permanentRes = await client.request('/apps/permanentmessages', {
          query: {
            owner: zelid,
            appname: requestedAppname,
          },
        });

        const scannedHeightRes = await client.request('/explorer/scannedheight');
        const registrationInfoRes = await client.request('/apps/registrationinformation');

        const globalSpecs = unwrapFluxEnvelope<unknown[]>(globalSpecsRes.data);
        const scanned = unwrapFluxEnvelope<Record<string, unknown>>(scannedHeightRes.data);
        const regInfo = unwrapFluxEnvelope<Record<string, unknown>>(registrationInfoRes.data);

        const currentHeightRaw = scanned?.['generalScannedHeight'];
        const currentHeight = typeof currentHeightRaw === 'number' ? currentHeightRaw : Number(currentHeightRaw);
        if (!Number.isFinite(currentHeight)) throw new Error('Could not parse explorer scanned height from /explorer/scannedheight');

        const blocksLastingRaw = regInfo?.['blocksLasting'];
        const daemonPONForkRaw = regInfo?.['daemonPONFork'];
        const blocksLasting = typeof blocksLastingRaw === 'number' ? blocksLastingRaw : Number(blocksLastingRaw);
        const daemonPONFork = typeof daemonPONForkRaw === 'number' ? daemonPONForkRaw : Number(daemonPONForkRaw);

        if (!Number.isFinite(blocksLasting) || !Number.isFinite(daemonPONFork)) {
          throw new Error('Could not parse blocksLasting/daemonPONFork from /apps/registrationinformation');
        }

        const appnameDetails = typeof requestedAppname === 'string' && requestedAppname.length > 0 ? requestedAppname : null;

        let locationsRes: Awaited<ReturnType<typeof client.request>> | null = null;
        let runningRes: Awaited<ReturnType<typeof client.request>> | null = null;

        let locationsCount: number | null = null;
        let localRunningCount: number | null = null;

        if (appnameDetails) {
          [locationsRes, runningRes] = await Promise.all([
            client.request(`/apps/location/${encodeURIComponent(appnameDetails)}`),
            client.request('/apps/listrunningapps'),
          ]);

          const locations = unwrapFluxEnvelope<unknown>(locationsRes.data);
          locationsCount = Array.isArray(locations) ? locations.length : null;

          const running = unwrapFluxEnvelope<unknown>(runningRes.data);
          const runningApps = Array.isArray(running) ? running : [];

          localRunningCount = runningApps.filter((x) => {
            if (!x || typeof x !== 'object' || Array.isArray(x)) return false;
            const rec = x as Record<string, unknown>;
            const name = typeof rec['name'] === 'string' ? rec['name'] : undefined;
            const app = typeof rec['app'] === 'string' ? rec['app'] : undefined;
            return name === appnameDetails || app === appnameDetails;
          }).length;
        }

        const apps = Array.isArray(globalSpecs)
          ? globalSpecs.filter((x): x is Record<string, unknown> => !!x && typeof x === 'object' && !Array.isArray(x))
          : [];

        const temporary = unwrapFluxEnvelope<unknown>(temporaryRes.data);
        const permanent = unwrapFluxEnvelope<unknown>(permanentRes.data);

        const temporaryCount = Array.isArray(temporary) ? temporary.length : null;
        const permanentCount = Array.isArray(permanent) ? permanent.length : null;

        const temporaryByHash = new Map<string, Record<string, unknown>>();
        if (Array.isArray(temporary)) {
          for (const x of temporary) {
            if (!x || typeof x !== 'object' || Array.isArray(x)) continue;
            const rec = x as Record<string, unknown>;
            const hash = rec['hash'];
            if (typeof hash !== 'string' || !hash) continue;
            temporaryByHash.set(hash, rec);
          }
        }

        const permanentByHash = new Map<string, Record<string, unknown>>();
        if (Array.isArray(permanent)) {
          for (const x of permanent) {
            if (!x || typeof x !== 'object' || Array.isArray(x)) continue;
            const rec = x as Record<string, unknown>;
            const hash = rec['hash'];
            if (typeof hash !== 'string' || !hash) continue;
            permanentByHash.set(hash, rec);
          }
        }

        const computed = apps
          .map((app) => {
            const name = typeof app['name'] === 'string' ? (app['name'] as string) : null;
            const owner = typeof app['owner'] === 'string' ? (app['owner'] as string) : null;
            const hash = typeof app['hash'] === 'string' ? (app['hash'] as string) : null;

            const instancesRaw = app['instances'];
            const instances = typeof instancesRaw === 'number' ? instancesRaw : Number(instancesRaw);

            const heightRaw = app['height'];
            const height = typeof heightRaw === 'number' ? heightRaw : Number(heightRaw);

            const expireRaw = app['expire'];
            const expire = expireRaw === undefined || expireRaw === null
              ? null
              : (typeof expireRaw === 'number' ? expireRaw : Number(expireRaw));

            const defaultExpire = height >= daemonPONFork ? blocksLasting * 4 : blocksLasting;
            const expireIn = Number.isFinite(expire as number) ? (expire as number) : defaultExpire;

            const originalExpirationHeight = height + expireIn;
            let expirationHeight = originalExpirationHeight;

            if (height < daemonPONFork && currentHeight >= daemonPONFork && originalExpirationHeight > daemonPONFork) {
              const blocksAfterFork = originalExpirationHeight - daemonPONFork;
              expirationHeight = daemonPONFork + blocksAfterFork * 4;
            }

            const blocksRemaining = expirationHeight - currentHeight;

            const tmpHash = typeof hash === 'string' ? hash : '';
            const temporaryMsg = tmpHash ? (temporaryByHash.get(tmpHash) ?? null) : null;
            const permanentMsg = tmpHash ? (permanentByHash.get(tmpHash) ?? null) : null;

            const hasTemporary = temporaryMsg !== null;
            const hasPermanent = permanentMsg !== null;

            return {
              name,
              owner,
              hash,
              instances: Number.isFinite(instances) ? Math.trunc(instances) : null,
              height: Number.isFinite(height) ? height : null,
              expirationHeight,
              blocksRemaining,
              expired: blocksRemaining < 0,
              hasTemporary,
              hasPermanent,
            };
          })
          .sort((a, b) => {
            const av = typeof a.blocksRemaining === 'number' ? a.blocksRemaining : 0;
            const bv = typeof b.blocksRemaining === 'number' ? b.blocksRemaining : 0;
            return av - bv;
          });

        const filtered = includeExpired ? computed : computed.filter((x) => x.expired !== true);

        const headers = appnameDetails
          ? ['App', 'Owner', 'Instances', 'Locations', 'Local running', 'Blocks Left', 'Expired?', 'Expires (height)', 'Updated (height)', 'Temp?', 'Perm?']
          : ['App', 'Owner', 'Instances', 'Blocks Left', 'Expired?', 'Expires (height)', 'Updated (height)', 'Temp?', 'Perm?'];

        const rows = filtered.map((x) => {
          const name = typeof x.name === 'string' ? x.name : '-';
          const owner = typeof x.owner === 'string' ? x.owner : '-';
          const instances = typeof x.instances === 'number' ? x.instances : '-';

          const blocksRemaining = typeof x.blocksRemaining === 'number' ? Math.trunc(x.blocksRemaining) : 0;
          const expired = x.expired === true ? 'yes' : 'no';
          const expiresAt = typeof x.expirationHeight === 'number' ? Math.trunc(x.expirationHeight) : '-';
          const updatedAt = typeof x.height === 'number' ? Math.trunc(x.height) : '-';

          const tmp = x.hasTemporary === true ? 'yes' : 'no';
          const perm = x.hasPermanent === true ? 'yes' : 'no';

          if (!appnameDetails) {
            return [name, owner, instances, blocksRemaining, expired, expiresAt, updatedAt, tmp, perm];
          }

          const locations = typeof locationsCount === 'number' ? locationsCount : '-';
          const running = typeof localRunningCount === 'number' ? localRunningCount : '-';

          return [name, owner, instances, locations, running, blocksRemaining, expired, expiresAt, updatedAt, tmp, perm];
        });

        const { table, shown } = renderMarkdownTable({ headers, rows, maxRows: limit });

        const link = resourceStore.putJson({
          kind: 'apps/global_status',
          name: 'Global app status',
          description: 'Global app specs + message propagation payloads',
          value: {
            zelid: zelid ?? null,
            appname: requestedAppname ?? null,
            includeExpired,
            currentHeight,
            apps: computed.map((x) => ({
              name: x.name,
              owner: x.owner,
              hash: x.hash,
              instances: x.instances,
              height: x.height,
              expirationHeight: x.expirationHeight,
              blocksRemaining: x.blocksRemaining,
              expired: x.expired,
              hasTemporary: x.hasTemporary,
              hasPermanent: x.hasPermanent,
            })),
            computed,
            location: appnameDetails ? { appname: appnameDetails, count: locationsCount } : null,
            localRuntime: appnameDetails ? { appname: appnameDetails, runningCount: localRunningCount } : null,
            raw: {
              globalappsspecifications: globalSpecsRes,
              temporarymessages: temporaryRes,
              permanentmessages: permanentRes,
              scannedheight: scannedHeightRes,
              registrationinformation: registrationInfoRes,
              location: locationsRes,
              listrunningapps: runningRes,
            },
          },
        });

        const ok = globalSpecsRes.ok
          && temporaryRes.ok
          && permanentRes.ok
          && scannedHeightRes.ok
          && registrationInfoRes.ok
          && (locationsRes?.ok ?? true)
          && (runningRes?.ok ?? true);

        let tempYes = 0;
        let permYes = 0;
        let both = 0;
        let neither = 0;

        for (const x of computed) {
          const tmp = x.hasTemporary === true;
          const perm = x.hasPermanent === true;

          if (tmp) tempYes += 1;
          if (perm) permYes += 1;
          if (tmp && perm) both += 1;
          if (!tmp && !perm) neither += 1;
        }

        const propagationLine = `Propagation: temp=${tempYes}, perm=${permYes}, both=${both}, neither=${neither}`;

        const summary = {
          ok,
          zelid: zelid ?? null,
          appname: requestedAppname ?? null,
          count: computed.length,
          shown,
          temporaryCount,
          permanentCount,
          locationsCount,
          localRunningCount,
          propagation: {
            tempYes,
            permYes,
            both,
            neither,
          },
          resourceUri: link.uri,
        };

        const truncated = computed.length > shown;
        const footer = truncated ? `\n(shown ${shown}/${computed.length})` : '';

        return {
          content: [
            { type: 'text', text: `${table}\n\n${propagationLine}${footer}` },
            { type: 'resource_link', ...link },
          ],
          structuredContent: summary,
          isError: !summary.ok,
        };
      }

      case 'flux_apps_troubleshoot': {
        const appname = mustBeString(args['appname'], 'appname');
        const deep = (asOptionalBoolean(args['deep']) ?? false) === true;

        const global = await client.request('/apps/globalappsspecifications', { query: { appname } });
        const location = await client.request(`/apps/location/${encodeURIComponent(appname)}`);
        const installing = await client.request(`/apps/installinglocation/${encodeURIComponent(appname)}`);
        const errors = await client.request(`/apps/installingerrorslocation/${encodeURIComponent(appname)}`);

        const runningLocal = await client.request('/apps/listrunningapps');

        let health: unknown = null;
        if (deep) {
          const inspect = await client.request(`/apps/appinspect/${encodeURIComponent(appname)}`);
          const stats = await client.request(`/apps/appstats/${encodeURIComponent(appname)}`);
          const top = await client.request(`/apps/apptop/${encodeURIComponent(appname)}`);
          const monitor = await client.request(`/apps/appmonitor/${encodeURIComponent(appname)}/600000`);
          health = { inspect, stats, top, monitor };
        }

        const runningPayload = unwrapFluxEnvelope<unknown>(runningLocal.data);
        const running = Array.isArray(runningPayload)
          ? runningPayload.filter((x): x is Record<string, unknown> => !!x && typeof x === 'object' && !Array.isArray(x))
          : [];

        const matching = running.filter((x) => x.app === appname || x.name === appname);

        const globalValue = global.ok ? unwrapFluxEnvelope<unknown>(global.data) : null;
        const globalExists = Array.isArray(globalValue)
          ? globalValue.some((x) => !!x && typeof x === 'object' && !Array.isArray(x) && (x as Record<string, unknown>).name === appname)
          : hasNonEmptyValue(globalValue);

        const locationValue = location.ok ? unwrapFluxEnvelope<unknown>(location.data) : null;
        const installingValue = installing.ok ? unwrapFluxEnvelope<unknown>(installing.data) : null;
        const errorsValue = errors.ok ? unwrapFluxEnvelope<unknown>(errors.data) : null;

        const locationCount = Array.isArray(locationValue) ? locationValue.length : hasNonEmptyValue(locationValue) ? 1 : 0;
        const installingCount = Array.isArray(installingValue) ? installingValue.length : hasNonEmptyValue(installingValue) ? 1 : 0;
        const errorsCount = Array.isArray(errorsValue) ? errorsValue.length : hasNonEmptyValue(errorsValue) ? 1 : 0;

        const suspects: { code: string; title: string; severity: 'high' | 'medium' | 'low'; evidence: Record<string, unknown> }[] = [];

        if (!global.ok) {
          suspects.push({
            code: 'global_registry_unreachable',
            title: 'Global registry query failed',
            severity: 'high',
            evidence: { status: global.status },
          });
        } else if (!globalExists) {
          suspects.push({
            code: 'not_in_global_registry',
            title: 'App not found in global registry',
            severity: 'high',
            evidence: {},
          });
        }

        if (errorsCount > 0) {
          suspects.push({
            code: 'install_errors',
            title: 'Install errors reported by locations endpoint',
            severity: 'high',
            evidence: { errorsCount },
          });
        }

        if (installingCount > 0) {
          suspects.push({
            code: 'installing_in_progress',
            title: 'App appears to be installing',
            severity: 'medium',
            evidence: { installingCount },
          });
        }

        if (locationCount === 0 && globalExists) {
          suspects.push({
            code: 'no_locations',
            title: 'No locations reported for globally registered app',
            severity: 'high',
            evidence: {},
          });
        }

        if (matching.length === 0 && locationCount > 0) {
          suspects.push({
            code: 'not_running_on_node',
            title: 'App not running on this node (but has locations)',
            severity: 'low',
            evidence: { locationCount },
          });
        }

        const severityOrder: Record<string, number> = { high: 0, medium: 1, low: 2 };
        suspects.sort((a, b) => severityOrder[a.severity] - severityOrder[b.severity]);

        const nextActions: Array<{ tool: string; arguments: Record<string, unknown> }> = [];

        nextActions.push({ tool: 'flux_apps_get_spec', arguments: { appname } });
        nextActions.push({ tool: 'flux_apps_get_owner', arguments: { appname } });

        if (!globalExists) {
          nextActions.push({ tool: 'flux_apps_global_status', arguments: { appname } });
        }

        if (errorsCount > 0) {
          nextActions.push({ tool: 'flux_apps_global_status', arguments: { appname, includeExpired: true } });
        }

        if (deep !== true) {
          nextActions.push({ tool: 'flux_apps_troubleshoot', arguments: { appname, deep: true } });
        }

        const link = resourceStore.putJson({
          kind: 'apps/troubleshoot',
          name: `Troubleshoot ${appname}`,
          description: 'App troubleshooting snapshot',
          value: {
            appname,
            global,
            location,
            installing,
            errors,
            runningLocal,
            health,
            derived: {
              globalExists,
              locationCount,
              installingCount,
              errorsCount,
              localRunningCount: matching.length,
              suspects,
              nextActions,
            },
          },
        });

        const ok = global.ok && location.ok && installing.ok && errors.ok && runningLocal.ok;

        const summary = {
          ok,
          status: suspects.length ? suspects[0]?.code ?? 'unknown' : ok ? 'ok' : 'unknown',
          appname,
          globalOk: global.ok,
          globalExists,
          locationOk: location.ok,
          locationsCount: locationCount,
          installingOk: installing.ok,
          installingCount,
          errorsOk: errors.ok,
          errorsCount,
          localRunningCount: matching.length,
          suspects,
          nextActions,
          resourceUri: link.uri,
        };

        return {
          content: [
            { type: 'text', text: JSON.stringify(summary, null, 2) },
            { type: 'resource_link', ...link },
          ],
          structuredContent: summary,
          isError: !ok,
        };
      }

      case 'flux_apps_get_spec': {
        const appname = mustBeString(args['appname'], 'appname');
        const decrypt = asOptionalBoolean(args['decrypt']);
        const path = decrypt === undefined
          ? `/apps/appspecifications/${encodeURIComponent(appname)}`
          : `/apps/appspecifications/${encodeURIComponent(appname)}/${decrypt ? 'true' : 'false'}`;

        const res = await client.request(path);

        const link = resourceStore.putJson({
          kind: 'apps/spec',
          name: `${appname} spec`,
          description: 'Raw /apps/appspecifications response',
          value: res,
        });

        const logicalOk = res.ok && isFluxSuccess(res.data);
        const error = extractFluxErrorMessage(res.data);

        const summary = {
          ok: logicalOk,
          status: res.status,
          appname,
          decrypt: decrypt ?? null,
          error,
          resourceUri: link.uri,
        };

        return {
          content: [
            { type: 'text', text: JSON.stringify(summary, null, 2) },
            { type: 'resource_link', ...link },
          ],
          structuredContent: summary,
          isError: !logicalOk,
        };
      }

      case 'flux_apps_get_spec_full': {
        const appname = mustBeString(args['appname'], 'appname');
        const ownerArg = asOptionalString(args['owner']);
        const baseUrlsRaw = args['baseUrls'];
        const timeoutMs = asOptionalNumber(args['timeoutMs']);
        const setBaseUrlOnSuccess = (asOptionalBoolean(args['setBaseUrlOnSuccess']) ?? true) === true;

        const baseUrls = Array.isArray(baseUrlsRaw)
          ? baseUrlsRaw.filter((x): x is string => typeof x === 'string').map((x) => x.trim()).filter(Boolean)
          : [];

        const currentBase = client.getBaseUrl();
        if (baseUrls.length === 0 && currentBase) baseUrls.push(currentBase);

        const normalized = Array.from(new Set(baseUrls.map((u) => normalizeHttpBaseUrl(u))));
        if (normalized.length === 0) throw new Error('No baseUrl available (set FLUX_API_BASE_URL or pass baseUrls).');

        const withBaseUrl = async <T>(baseUrl: string, fn: () => Promise<T>) => {
          const restoreBase = client.getBaseUrl();
          client.setBaseUrl(baseUrl);
          try {
            return await fn();
          } finally {
            if (restoreBase) client.setBaseUrl(restoreBase);
          }
        };

        // 1) Always fetch the base spec first (lets us detect non-enterprise apps without needing auth).
        const baseSpecAttempt = await attemptOnBaseUrls(normalized, (baseUrl) =>
          withBaseUrl(baseUrl, async () => {
            const res = await client.request(`/apps/appspecifications/${encodeURIComponent(appname)}`, { timeoutMs });
            if (!res.ok || !isFluxSuccess(res.data)) {
              throw new Error(extractFluxErrorMessage(res.data) ?? 'Failed to fetch app spec');
            }
            const payload = unwrapFluxEnvelope<unknown>(res.data);
            if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
              throw new Error('Invalid app spec response');
            }
            return { res, spec: payload as Record<string, unknown> };
          })
        );

        if (!baseSpecAttempt.ok) {
          return jsonResult(
            {
              ok: false,
              appname,
              enterprise: null,
              error: 'Unable to fetch app spec.',
              failures: baseSpecAttempt.failures,
            },
            { isError: true }
          );
        }

        const baseSpecRes = baseSpecAttempt.value.res;
        const baseSpec = baseSpecAttempt.value.spec;
        const baseUrlUsed = baseSpecAttempt.used;

        const baseLink = resourceStore.putJson({
          kind: 'apps/spec',
          name: `${appname} spec (base)`,
          description: 'Raw /apps/appspecifications response (non-decrypt)',
          value: baseSpecRes,
        });

        const versionRaw = baseSpec['version'];
        const version =
          typeof versionRaw === 'number'
            ? versionRaw
            : typeof versionRaw === 'string'
              ? Number(versionRaw)
              : NaN;

        const enterpriseRaw = baseSpec['enterprise'];
        const enterprisePresent = typeof enterpriseRaw === 'string' && enterpriseRaw.trim().length > 0;
        const isEnterprise = Number.isFinite(version) && version >= 8 && enterprisePresent;

        if (!isEnterprise) {
          const summary = {
            ok: true,
            appname,
            enterprise: false,
            baseUrlUsed,
            resourceUri: baseLink.uri,
          };

          return {
            content: [
              { type: 'text', text: JSON.stringify(summary, null, 2) },
              { type: 'resource_link', ...baseLink },
            ],
            structuredContent: summary,
            isError: false,
          };
        }

        // 2) Enterprise apps require an authenticated Arcane node for the decrypt flow.
        if (!client.getZelidauthSummary().present) {
          const summary = {
            ok: false,
            appname,
            enterprise: true,
            error: 'zelidauth is required for enterprise spec decryption (use flux_auth_flow + flux_set_zelidauth).',
            baseUrlUsed,
            resourceUri: baseLink.uri,
          };

          return {
            content: [
              { type: 'text', text: JSON.stringify(summary, null, 2) },
              { type: 'resource_link', ...baseLink },
            ],
            structuredContent: summary,
            isError: true,
          };
        }

        const preferred = [baseUrlUsed, ...normalized.filter((u) => u !== baseUrlUsed)];

        // 2a) Resolve original owner (needed for /apps/getpublickey).
        let owner = ownerArg ?? null;
        if (!owner) {
          const ownerAttempt = await attemptOnBaseUrls(preferred, (baseUrl) =>
            withBaseUrl(baseUrl, async () => {
              const res = await client.request(`/apps/apporiginalowner/${encodeURIComponent(appname)}`, { timeoutMs });
              if (!res.ok || !isFluxSuccess(res.data)) {
                throw new Error(extractFluxErrorMessage(res.data) ?? 'Failed to fetch app original owner');
              }
              const payload = unwrapFluxEnvelope<unknown>(res.data);
              if (typeof payload !== 'string' || !payload.trim()) throw new Error('Invalid owner response');
              return payload.trim();
            })
          );

          if (!ownerAttempt.ok) {
            const summary = {
              ok: false,
              appname,
              enterprise: true,
              error: 'Unable to resolve app original owner.',
              failures: ownerAttempt.failures,
              resourceUri: baseLink.uri,
            };

            return {
              content: [
                { type: 'text', text: JSON.stringify(summary, null, 2) },
                { type: 'resource_link', ...baseLink },
              ],
              structuredContent: summary,
              isError: true,
            };
          }

          owner = ownerAttempt.value;
        }

        // 2b) Fetch RSA public key from an Arcane node.
        const publicKeyAttempt = await attemptOnBaseUrls(preferred, (baseUrl) =>
          withBaseUrl(baseUrl, async () => {
            const res = await client.request('/apps/getpublickey', {
              method: 'POST',
              bodyType: 'json',
              body: { owner, name: appname },
              timeoutMs,
            });
            if (!res.ok || !isFluxSuccess(res.data)) {
              throw new Error(extractFluxErrorMessage(res.data) ?? 'Failed to fetch public key');
            }
            const payload = unwrapFluxEnvelope<unknown>(res.data);
            if (typeof payload !== 'string' || !payload.trim()) throw new Error('Invalid public key response');
            return payload.trim();
          })
        );

        if (!publicKeyAttempt.ok) {
          const summary = {
            ok: false,
            appname,
            enterprise: true,
            owner,
            error: 'Unable to fetch enterprise public key (Arcane node + zelidauth required).',
            failures: publicKeyAttempt.failures,
            resourceUri: baseLink.uri,
          };

          return {
            content: [
              { type: 'text', text: JSON.stringify(summary, null, 2) },
              { type: 'resource_link', ...baseLink },
            ],
            structuredContent: summary,
            isError: true,
          };
        }

        const publicKey = publicKeyAttempt.value;
        const arcaneBaseUrlUsed = publicKeyAttempt.used;
        const { enterpriseKey, aesKeyBase64 } = generateEnterpriseKey(publicKey);

        // 2c) Fetch session-encrypted enterprise payload from the Arcane node.
        const encryptedRes = await (async () => {
          if (setBaseUrlOnSuccess) {
            client.setBaseUrl(arcaneBaseUrlUsed);
            return await client.request(`/apps/appspecifications/${encodeURIComponent(appname)}/true`, {
              enterpriseKey,
              timeoutMs,
            });
          }

          return await withBaseUrl(arcaneBaseUrlUsed, async () =>
            client.request(`/apps/appspecifications/${encodeURIComponent(appname)}/true`, {
              enterpriseKey,
              timeoutMs,
            })
          );
        })();

        const encryptedLink = resourceStore.putJson({
          kind: 'apps/spec/enterprise_encrypted',
          name: `${appname} spec (enterprise encrypted)`,
          description: 'Raw /apps/appspecifications/<app>/true response (enterprise session ciphertext)',
          value: encryptedRes,
        });

        if (!encryptedRes.ok || !isFluxSuccess(encryptedRes.data)) {
          const summary = {
            ok: false,
            appname,
            enterprise: true,
            owner,
            baseUrlUsed: arcaneBaseUrlUsed,
            error: extractFluxErrorMessage(encryptedRes.data) ?? 'Failed to fetch enterprise encrypted spec',
            resources: {
              baseSpec: baseLink.uri,
              encryptedSpec: encryptedLink.uri,
            },
          };

          return {
            content: [
              { type: 'text', text: JSON.stringify(summary, null, 2) },
              { type: 'resource_link', ...baseLink },
              { type: 'resource_link', ...encryptedLink },
            ],
            structuredContent: summary,
            isError: true,
          };
        }

        const encryptedPayload = unwrapFluxEnvelope<unknown>(encryptedRes.data);
        if (!encryptedPayload || typeof encryptedPayload !== 'object' || Array.isArray(encryptedPayload)) {
          throw new Error('Invalid encrypted spec response');
        }

        const encryptedSpec = encryptedPayload as Record<string, unknown>;
        const enterpriseCiphertext = encryptedSpec['enterprise'];
        if (typeof enterpriseCiphertext !== 'string' || !enterpriseCiphertext.trim()) {
          throw new Error('Encrypted response missing enterprise payload');
        }

        // 3) Decrypt the enterprise payload locally (AES-256-GCM) and merge into an inspection-friendly spec.
        const decryptedText = decryptEnterprisePayload(enterpriseCiphertext, aesKeyBase64);
        let decryptedEnterprise: unknown = null;
        try {
          decryptedEnterprise = JSON.parse(decryptedText);
        } catch (error) {
          throw new Error('Enterprise payload decrypted but was not valid JSON');
        }

        if (!decryptedEnterprise || typeof decryptedEnterprise !== 'object' || Array.isArray(decryptedEnterprise)) {
          throw new Error('Enterprise payload JSON must be an object');
        }

        const enterpriseObj = decryptedEnterprise as Record<string, unknown>;

        const mergedSpec: Record<string, unknown> = { ...encryptedSpec };
        if ('compose' in enterpriseObj) mergedSpec.compose = enterpriseObj.compose;
        if ('contacts' in enterpriseObj) mergedSpec.contacts = enterpriseObj.contacts;

        const enterpriseLink = resourceStore.putJson({
          kind: 'enterprise/decrypted/json',
          name: `${appname} enterprise decrypted`,
          description: 'Decrypted enterprise payload (parsed JSON)',
          value: enterpriseObj,
        });

        const mergedLink = resourceStore.putJson({
          kind: 'apps/spec/full',
          name: `${appname} spec (full)`,
          description: 'Inspection-friendly spec with decrypted enterprise compose/contacts merged in',
          value: mergedSpec,
        });

        const summary = {
          ok: true,
          appname,
          enterprise: true,
          owner,
          baseUrlUsed: arcaneBaseUrlUsed,
          baseUrlSet: setBaseUrlOnSuccess,
          warning:
            'This tool returns decrypted compose/contacts for inspection. Do not submit decrypted specs as a registration/update payload; enterprise apps require encrypted enterprise content.',
          resources: {
            baseSpec: baseLink.uri,
            encryptedSpec: encryptedLink.uri,
            enterpriseDecrypted: enterpriseLink.uri,
            mergedSpec: mergedLink.uri,
          },
        };

        return {
          content: [
            { type: 'text', text: JSON.stringify(summary, null, 2) },
            { type: 'resource_link', ...baseLink },
            { type: 'resource_link', ...encryptedLink },
            { type: 'resource_link', ...enterpriseLink },
            { type: 'resource_link', ...mergedLink },
          ],
          structuredContent: summary,
          isError: false,
        };
      }

      case 'flux_apps_get_public_key': {
        const owner = mustBeString(args['owner'], 'owner');
        const name = mustBeString(args['name'], 'name');
        return jsonResult(
          await client.request('/apps/getpublickey', {
            method: 'POST',
            bodyType: 'json',
            body: { owner, name },
          })
        );
      }

      case 'flux_apps_get_owner': {
        const appname = mustBeString(args['appname'], 'appname');
        return jsonResult(await client.request(`/apps/appowner/${encodeURIComponent(appname)}`));
      }

      case 'flux_apps_registration_information': {
        const res = await client.request('/apps/registrationinformation');
        const link = resourceStore.putJson({
          kind: 'apps/registration_information',
          name: 'Registration information',
          description: 'Raw /apps/registrationinformation response',
          value: res,
        });
        const ok = isFluxEnvelopeOk(res);
        const summary = { ok, status: res.status, resourceUri: link.uri };
        return {
          content: [{ type: 'text', text: JSON.stringify(summary, null, 2) }, { type: 'resource_link', ...link }],
          structuredContent: summary,
          isError: !ok,
        };
      }

      case 'flux_apps_deployment_information': {
        const res = await client.request('/apps/deploymentinformation');
        const link = resourceStore.putJson({
          kind: 'apps/deployment_information',
          name: 'Deployment information',
          description: 'Raw /apps/deploymentinformation response',
          value: res,
        });
        const ok = isFluxEnvelopeOk(res);
        const summary = { ok, status: res.status, resourceUri: link.uri };
        return {
          content: [{ type: 'text', text: JSON.stringify(summary, null, 2) }, { type: 'resource_link', ...link }],
          structuredContent: summary,
          isError: !ok,
        };
      }

      case 'flux_generate_app_spec_v8': {
        const appName = mustBeString(args['name'], 'name');
        const owner = mustBeString(args['owner'], 'owner');
        const repotag = mustBeString(args['repotag'], 'repotag');

        const appDescription = asOptionalString(args['appDescription']) ?? '';
        const componentName = asOptionalString(args['componentName']) ?? 'web';
        const componentDescription = asOptionalString(args['componentDescription']) ?? componentName;

        const portsRaw = args['ports'];
        const containerPortsRaw = args['containerPorts'];
        const domainsRaw = args['domains'];

        const ports = Array.isArray(portsRaw) ? portsRaw.map((p) => Number(p)).filter(Number.isFinite) : [];
        const containerPorts = Array.isArray(containerPortsRaw)
          ? containerPortsRaw.map((p) => Number(p)).filter(Number.isFinite)
          : ports.slice();

        const domains = Array.isArray(domainsRaw)
          ? domainsRaw.map((d) => String(d))
          : ports.map(() => '');

        if (ports.length !== containerPorts.length || ports.length !== domains.length) {
          throw new Error('ports, containerPorts, and domains must have the same length');
        }

        const environmentParameters = normalizeEnvParams(args['environment']);
        const commands = normalizeCommands(args['commands']);

        const containerData = asOptionalString(args['containerData']) ?? '/data';

        const cpu = asOptionalNumber(args['cpu']) ?? 1;
        const ram = asOptionalNumber(args['ram']) ?? 2000;
        const hdd = asOptionalNumber(args['hdd']) ?? 10;
        const instances = asOptionalNumber(args['instances']) ?? 3;
        const staticip = asOptionalBoolean(args['staticip']) ?? false;
        const enterprise = asOptionalString(args['enterprise']) ?? '';

        const spec = {
          version: 8,
          name: appName,
          description: appDescription,
          owner,
          compose: [
            {
              name: componentName,
              description: componentDescription,
              repotag,
              ports,
              domains,
              environmentParameters,
              commands,
              containerPorts,
              containerData,
              cpu,
              ram,
              hdd,
              repoauth: '',
            },
          ],
          instances,
          contacts: [],
          geolocation: [],
          expire: 22000,
          nodes: [],
          staticip,
          enterprise,
        };

        return jsonResult({ spec });
      }

      case 'flux_git_deploy_generate_spec_v8': {
        const repoToken = asOptionalString(args['repoToken']);
        if (repoToken) requireConfirm(args, 'git deploy: repoToken provided (sensitive)');

        const built = await buildGitDeploySpecV8({ client, args });

        const link = resourceStore.putJson({
          kind: 'git_deploy/spec_v8',
          name: `Git deploy spec ${built.meta.appname}`,
          description: 'Generated v8 app spec for Flux Git Deployments (Orbit)',
          value: built.spec,
        });

        const summary = {
          ok: true,
          ...built.meta,
          resourceUri: link.uri,
          nextActions: [
            { tool: 'flux_resource_read', arguments: { uri: link.uri } },
            { tool: 'flux_git_deploy_plan_registration', note: 'Plan registration without pasting the full spec into chat.' },
          ],
        };

        return {
          content: [{ type: 'text', text: JSON.stringify(summary, null, 2) }, { type: 'resource_link', ...link }],
          structuredContent: summary,
          isError: false,
        };
      }

      case 'flux_git_deploy_plan_registration': {
        const repoToken = asOptionalString(args['repoToken']);
        if (repoToken) requireConfirm(args, 'git deploy: repoToken provided (sensitive)');

        const requiresAuth = !client.getZelidauthSummary().present;
        const timestamp = asOptionalNumber(args['timestamp']) ?? Date.now();
        const typeVersion = asOptionalNumber(args['typeVersion']) ?? 1;

        const built = await buildGitDeploySpecV8({ client, args });

        const verified = await client.request('/apps/verifyappregistrationspecifications', {
          method: 'POST',
          body: built.spec,
          allowMutation: true,
          timeoutMs: 5 * 60 * 1000,
        });
        if (!verified.ok || !isFluxSuccess(verified.data)) {
          throw new Error(extractFluxErrorMessage(verified.data) ?? 'Spec verification failed');
        }
        const verifiedSpec = unwrapFluxEnvelope<Record<string, unknown>>(verified.data);

        const price = await client.request('/apps/calculateprice', {
          method: 'POST',
          body: verifiedSpec,
          allowMutation: true,
          timeoutMs: 5 * 60 * 1000,
        });
        if (!price.ok || !isFluxSuccess(price.data)) {
          throw new Error(extractFluxErrorMessage(price.data) ?? 'Price calculation failed');
        }

        const [registrationInformation, deploymentInformation] = await Promise.all([
          client.request('/apps/registrationinformation'),
          client.request('/apps/deploymentinformation'),
        ]);
        if (!registrationInformation.ok || !isFluxSuccess(registrationInformation.data)) {
          throw new Error(extractFluxErrorMessage(registrationInformation.data) ?? 'Failed to fetch registration information');
        }
        if (!deploymentInformation.ok || !isFluxSuccess(deploymentInformation.data)) {
          throw new Error(extractFluxErrorMessage(deploymentInformation.data) ?? 'Failed to fetch deployment information');
        }

        const type = 'fluxappregister' as const;
        const messageToSign = buildMessageToSign({ type, version: typeVersion, spec: verifiedSpec, timestamp });
        const messageToSignSha256 = createHash('sha256').update(messageToSign, 'utf8').digest('hex');
        const messageToSignBytes = Buffer.byteLength(messageToSign, 'utf8');

        const messageLink = resourceStore.putText({
          kind: 'message_to_sign',
          name: `messageToSign ${type} (git deploy)`,
          description: 'Raw messageToSign bytes (exact data to sign)',
          mimeType: 'text/plain',
          text: messageToSign,
        });

        const payload = buildSignedPayload({ type, version: typeVersion, spec: verifiedSpec, timestamp });
        const fluxPrice = extractFluxAmountFromPrice(price);

        const deploymentInfo = unwrapFluxEnvelope<unknown>(deploymentInformation.data);
        const paymentAddress =
          deploymentInfo && typeof deploymentInfo === 'object' && !Array.isArray(deploymentInfo)
            ? (deploymentInfo as Record<string, unknown>)['address']
            : undefined;

        const payment = {
          address: typeof paymentAddress === 'string' && paymentAddress.trim() ? paymentAddress : null,
          amountFlux: fluxPrice,
          memo: '<REGISTRATION_HASH>',
          note: 'After flux_apps_register returns a hash, pay the amount to address with memo=hash.',
        };

        const authNote = requiresAuth
          ? 'Before submitting registration, you must authenticate (zelidauth). This requires a separate signature over the login phrase (distinct from the app registration signature).'
          : null;

        const full = {
          requiresAuth,
          authNote,
          git: built.meta,
          spec: verifiedSpec,
          verified,
          price,
          registrationInformation,
          deploymentInformation,
          payment,
          timestamp,
          type,
          typeVersion,
          messageToSignSha256,
          messageToSignBytes,
          messageToSignResourceUri: messageLink.uri,
          payload,
        };

        const fullLink = resourceStore.putJson({
          kind: 'git_deploy/plan_registration',
          name: `Git deploy plan registration ${built.meta.appname}`,
          description: 'Full output from flux_git_deploy_plan_registration',
          value: full,
        });

        const summary = {
          ok: true,
          requiresAuth,
          authNote,
          ...built.meta,
          timestamp,
          type,
          typeVersion,
          payment,
          messageToSignSha256,
          messageToSignBytes,
          messageToSignResourceUri: messageLink.uri,
          resourceUri: fullLink.uri,
          nextActions: [
            { tool: 'flux_build_zelcore_sign_link', note: 'Pass the raw message from messageToSignResourceUri.' },
            { tool: 'flux_write_message_to_sign', note: 'Write messageToSign to disk for manual signing (confirm required).' },
            { tool: 'flux_apps_register', note: 'Submit registration after signing (requires zelidauth).' },
          ],
        };

        return {
          content: [
            { type: 'text', text: JSON.stringify(summary, null, 2) },
            { type: 'resource_link', ...fullLink },
            { type: 'resource_link', ...messageLink },
          ],
          structuredContent: summary,
          isError: false,
        };
      }

      case 'flux_apps_verify_registration_spec': {
        const spec = mustBeObject(args['spec'], 'spec');
        return jsonResult(
          await client.request('/apps/verifyappregistrationspecifications', {
            method: 'POST',
            body: spec,
            allowMutation: true,
          })
        );
      }

      case 'flux_apps_verify_update_spec': {
        const spec = mustBeObject(args['spec'], 'spec');
        return jsonResult(
          await client.request('/apps/verifyappupdatespecifications', {
            method: 'POST',
            body: spec,
            allowMutation: true,
          })
        );
      }

      case 'flux_apps_calculate_price': {
        const spec = mustBeObject(args['spec'], 'spec');
        return jsonResult(
          await client.request('/apps/calculateprice', {
            method: 'POST',
            body: spec,
            allowMutation: true,
          })
        );
      }

       case 'flux_apps_plan_registration': {
          const requiresAuth = !client.getZelidauthSummary().present;

          const specInput = mustBeObject(args['spec'], 'spec');

          const identity = extractAppIdentity(specInput);
          const missing: string[] = [];
          if (!identity.appname) missing.push('name');

          const descriptionRaw = specInput['description'];
          const description = typeof descriptionRaw === 'string' ? descriptionRaw.trim() : '';
          if (!description) missing.push('description');

          if (!identity.owner || /placeholder|replace_me|<.*>|your_?zelid/i.test(identity.owner)) missing.push('owner');

          if (missing.length > 0) {
            throw new Error(
              `Spec is missing required field(s): ${missing.join(', ')}. Set a real Flux/ZelID address in spec.owner before planning registration.`
            );
          }
         const timestamp = asOptionalNumber(args['timestamp']) ?? Date.now();
         const typeVersion = asOptionalNumber(args['typeVersion']) ?? 1;
 
         const verified = await client.request('/apps/verifyappregistrationspecifications', {
           method: 'POST',
           body: specInput,
           allowMutation: true,
           timeoutMs: 5 * 60 * 1000,
         });
 
         const verifiedSpec = unwrapFluxEnvelope<Record<string, unknown>>(verified.data);
 
         const price = await client.request('/apps/calculateprice', {
           method: 'POST',
           body: verifiedSpec,
           allowMutation: true,
           timeoutMs: 5 * 60 * 1000,
         });


        const [registrationInformation, deploymentInformation] = await Promise.all([
          client.request('/apps/registrationinformation'),
          client.request('/apps/deploymentinformation'),
        ]);

        const type = 'fluxappregister' as const;
        const messageToSign = buildMessageToSign({ type, version: typeVersion, spec: verifiedSpec, timestamp });
        const messageToSignSha256 = createHash('sha256').update(messageToSign, 'utf8').digest('hex');
        const messageToSignBytes = Buffer.byteLength(messageToSign, 'utf8');
        const messageLink = resourceStore.putText({
          kind: 'message_to_sign',
          name: `messageToSign ${type}`,
          description: 'Raw messageToSign bytes (exact data to sign)',
          mimeType: 'text/plain',
          text: messageToSign,
        });
        const payload = buildSignedPayload({ type, version: typeVersion, spec: verifiedSpec, timestamp });

        const fluxPrice = extractFluxAmountFromPrice(price);

        const deploymentInfo = unwrapFluxEnvelope<unknown>(deploymentInformation.data);
        const paymentAddress =
          deploymentInfo && typeof deploymentInfo === 'object' && !Array.isArray(deploymentInfo)
            ? (deploymentInfo as Record<string, unknown>)['address']
            : undefined;

        const payment = {
          address: typeof paymentAddress === 'string' && paymentAddress.trim() ? paymentAddress : null,
          amountFlux: fluxPrice,
          memo: '<REGISTRATION_HASH>',
          note: 'After flux_apps_register returns a hash, pay the amount to address with memo=hash.',
        };

        const authNote = requiresAuth
          ? 'Before submitting registration, you must authenticate (zelidauth). This requires a separate signature over the login phrase (distinct from the app registration signature). You can sign both in one wallet session: first the login phrase (for zelidauth), then messageToSign (for app registration).'
          : null;

        const full = {
          requiresAuth,
          authNote,
          verified,
          price,
          registrationInformation,
          deploymentInformation,
          payment,
          timestamp,
          type,
          typeVersion,
          messageToSignSha256,
          messageToSignBytes,
          messageToSignResourceUri: messageLink.uri,
          payload,
          signatureNotes: {
            loginSignature: 'Sign loginPhrase for zelidauth (auth).',
            appSignature: 'Sign messageToSign for registration.',
          },
          next: 'Sign messageToSign with the OWNER ZelID (distinct from login phrase signature), then call flux_apps_register with signature + same timestamp. After registration returns a hash, run flux_apps_test_install (or flux_apps_test_install_pin if you are using a gateway), then pay with memo=hash.',
        };

        const fullLink = resourceStore.putJson({
          kind: 'apps/plan_registration',
          name: `Plan registration ${identity.appname}`,
          description: 'Full output from flux_apps_plan_registration',
          value: full,
        });

        const summary = {
          ok: true,
          requiresAuth,
          authNote,
          appname: identity.appname ?? null,
          owner: identity.owner ?? null,
          timestamp,
          type,
          typeVersion,
          payment,
          messageToSignSha256,
          messageToSignBytes,
          messageToSignResourceUri: messageLink.uri,
          resourceUri: fullLink.uri,
          signatureNotes: full.signatureNotes,
          nextActions: [
            { tool: 'flux_build_zelcore_sign_link', note: 'Pass the raw message from messageToSignResourceUri.' },
            { tool: 'flux_write_message_to_sign', note: 'Write messageToSign to disk for manual signing (confirm required).' },
            { tool: 'flux_apps_register', note: 'Submit registration after signing (requires zelidauth).' },
          ],
        };

        return {
          content: [
            { type: 'text', text: JSON.stringify(summary, null, 2) },
            { type: 'resource_link', ...fullLink },
            { type: 'resource_link', ...messageLink },
          ],
          structuredContent: summary,
          isError: false,
        };
      }

        case 'flux_apps_register': {
         assertAuthenticatedFor('apps/appregister');

         const specInput = mustBeObject(args['spec'], 'spec');
         const signature = mustBeString(args['signature'], 'signature');
         const timestamp = mustBeNumber(args['timestamp'], 'timestamp');
         const verifyFirstRaw = args['verifyFirst'];
         const verifyFirst = verifyFirstRaw === undefined ? true : mustBeBoolean(verifyFirstRaw, 'verifyFirst');
         const typeVersion = asOptionalNumber(args['typeVersion']) ?? 1;
 
         const verified = verifyFirst
           ? await client.request('/apps/verifyappregistrationspecifications', {
               method: 'POST',
               body: specInput,
               allowMutation: true,
               timeoutMs: 5 * 60 * 1000,
             })
           : null;

 
        const spec = verified ? unwrapFluxEnvelope<Record<string, unknown>>(verified.data) : specInput;
        const { appname, owner } = extractAppIdentity(spec);
 
        const type = 'fluxappregister' as const;
        const messageToSign = buildMessageToSign({ type, version: typeVersion, spec, timestamp });
        const messageToSignSha256 = createHash('sha256').update(messageToSign, 'utf8').digest('hex');
        const messageToSignBytes = Buffer.byteLength(messageToSign, 'utf8');
        const messageLink = resourceStore.putText({
          kind: 'message_to_sign',
          name: `messageToSign ${type}`,
          description: 'Raw messageToSign bytes (exact data to sign)',
          mimeType: 'text/plain',
          text: messageToSign,
        });
        const payload = buildSignedPayload({ type, version: typeVersion, spec, timestamp, signature });
 
        const submit = await client.request('/apps/appregister', {
          method: 'POST',
          body: payload,
          allowMutation: true,
        });
 
        const submittedOk = submit.ok && isFluxSuccess(submit.data);
        const submitError = submittedOk ? null : (extractFluxErrorMessage(submit.data) ?? null);

        const hash = extractHashFromAppMessageResponse(submit.data);

        const paymentInfo = submittedOk ? await buildPaymentInfo(spec, hash ?? null) : null;

         const full = {
           verified,
           submit,
           appname: appname ?? null,
           owner: owner ?? null,
           hash: hash ?? null,
           messageToSignSha256,
           messageToSignBytes,
           messageToSignResourceUri: messageLink.uri,
           payload,
           payment: paymentInfo?.payment ?? null,
           paymentSources: paymentInfo
             ? { deploymentInformation: paymentInfo.deploymentInformation, price: paymentInfo.price }
             : null,
           error: submitError,
           signatureNotes: {
             loginSignature: 'Sign loginPhrase for zelidauth (auth).',
             appSignature: 'Sign messageToSign for registration.',
           },
         };

         const fullLink = resourceStore.putJson({
           kind: 'apps/register',
           name: `Register ${appname ?? hash ?? 'app'}`,
           description: 'Full output from flux_apps_register',
           value: full,
         });

         const summary = {
           ok: submittedOk,
           status: submittedOk ? 'submitted' : 'error',
           appname: appname ?? null,
           owner: owner ?? null,
           hash: hash ?? null,
           error: submitError,
           payment: paymentInfo?.payment ?? null,
           messageToSignSha256,
           messageToSignBytes,
           messageToSignResourceUri: messageLink.uri,
           resourceUri: fullLink.uri,
           signatureNotes: full.signatureNotes,
           nextActions: hash
             ? [
                 { tool: 'flux_apps_get_messages', arguments: { hash, kind: 'both' } },
                 { tool: 'flux_apps_test_install', arguments: { hash, confirm: true } },
               ]
             : [],
         };

         return {
           content: [
             { type: 'text', text: JSON.stringify(summary, null, 2) },
             { type: 'resource_link', ...fullLink },
             { type: 'resource_link', ...messageLink },
           ],
           structuredContent: summary,
           isError: !submittedOk,
         };
       }

        case 'flux_apps_register_and_verify': {
          requireConfirm(args, 'apps/appregister');
          assertAuthenticatedFor('apps/appregister');

          const specInput = mustBeObject(args['spec'], 'spec');
         const signature = mustBeString(args['signature'], 'signature');
         const timestamp = mustBeNumber(args['timestamp'], 'timestamp');
         const verifyFirstRaw = args['verifyFirst'];
         const verifyFirst = verifyFirstRaw === undefined ? true : mustBeBoolean(verifyFirstRaw, 'verifyFirst');
         const typeVersion = asOptionalNumber(args['typeVersion']) ?? 1;
 
         const attempts = asOptionalNumber(args['attempts']) ?? 10;
         const intervalMs = asOptionalNumber(args['intervalMs']) ?? 3000;
         const poll = (asOptionalBoolean(args['poll']) ?? true) === true;
         const pollTimeoutMs = asOptionalNumber(args['pollTimeoutMs']);
         const verifyGlobal = (asOptionalBoolean(args['verifyGlobal']) ?? true) === true;
 
         const verified = verifyFirst
           ? await client.request('/apps/verifyappregistrationspecifications', {
               method: 'POST',
               body: specInput,
               allowMutation: true,
             })
           : null;
 
         const spec = verified ? unwrapFluxEnvelope<Record<string, unknown>>(verified.data) : specInput;
         const { appname, owner } = extractAppIdentity(spec);
 
         const type = 'fluxappregister' as const;
         const messageToSign = buildMessageToSign({ type, version: typeVersion, spec, timestamp });
         const messageToSignSha256 = createHash('sha256').update(messageToSign, 'utf8').digest('hex');
         const messageToSignBytes = Buffer.byteLength(messageToSign, 'utf8');
         const messageLink = resourceStore.putText({
           kind: 'message_to_sign',
           name: `messageToSign ${type}`,
           description: 'Raw messageToSign bytes (exact data to sign)',
           mimeType: 'text/plain',
           text: messageToSign,
         });
         const payload = buildSignedPayload({ type, version: typeVersion, spec, timestamp, signature });
 
          const submit = await client.request('/apps/appregister', {
            method: 'POST',
            body: payload,
            allowMutation: true,
          });

          const hash = extractHashFromAppMessageResponse(submit.data);
          if (!hash) {
            const error = extractFluxErrorMessage(submit.data);
            const hint = error ? ` Flux error: ${error}` : '';
            throw new Error(`Could not extract message hash from registration response.${hint}`);
          }
 
         const propagation = poll
           ? await pollMessagePropagation({ hash, attempts, intervalMs, timeoutMs: pollTimeoutMs })
           : null;

         let globalCheck: FluxRequestResult | null = null;
         let globalPresent: boolean | null = null;
         if (verifyGlobal && appname) {
           globalCheck = await client.request('/apps/globalappsspecifications', {
             query: { appname, owner: owner ?? undefined },
           });
           if (globalCheck.ok && isFluxSuccess(globalCheck.data)) {
             const globalSpecs = unwrapFluxEnvelope<unknown>(globalCheck.data);
             if (Array.isArray(globalSpecs)) {
               globalPresent = globalSpecs.some((x) => {
                 if (!x || typeof x !== 'object' || Array.isArray(x)) return false;
                 const n = (x as Record<string, unknown>).name;
                 const o = (x as Record<string, unknown>).owner;
                 const nameOk = typeof n === 'string' && n === appname;
                 const ownerOk = !owner || (typeof o === 'string' && o === owner);
                 return nameOk && ownerOk;
               });
             } else {
               globalPresent = hasNonEmptyValue(globalSpecs);
             }
           }
         }

          const registered = submit.ok;
          const status = !registered
            ? 'error'
            : !poll
              ? 'submitted'
              : propagation?.permanentPresent !== true
                ? 'awaiting_payment'
                : globalPresent === false
                  ? 'verifying_global'
                  : 'verified';

          const done = status === 'verified';
          const ok = registered;

          const link = resourceStore.putJson({
            kind: 'apps/register_and_verify',
            name: `Register and verify ${appname ?? hash}`,
            description: 'Registration submission + propagation checks',
            value: {
              appname: appname ?? null,
              owner: owner ?? null,
              hash,
              attempts,
              intervalMs,
              poll,
              verified,
              submit,
              propagation,
              globalCheck,
              globalPresent,
            },
          });

          const nextActions = status === 'verified'
            ? []
            : [
                { tool: 'flux_apps_get_messages', arguments: { hash, kind: 'both' } },
                { tool: 'flux_apps_wait_for_propagation', arguments: { hash, attempts, intervalMs } },
                appname ? { tool: 'flux_apps_global_status', arguments: { appname, zelid: owner } } : null,
              ].filter(Boolean);

          const deploymentInfoRes = await client.request('/apps/deploymentinformation');
          const deploymentInfo = unwrapFluxEnvelope<unknown>(deploymentInfoRes.data);
          const paymentAddress =
            deploymentInfo && typeof deploymentInfo === 'object' && !Array.isArray(deploymentInfo)
              ? (deploymentInfo as Record<string, unknown>)['address']
              : undefined;

          const priceRes = await client.request('/apps/calculateprice', {
          method: 'POST',
          body: spec,
          allowMutation: true,
          timeoutMs: 5 * 60 * 1000,
        });

        const priceData = unwrapFluxEnvelope<unknown>(priceRes.data);
        const fluxAmount =
          priceData && typeof priceData === 'object' && !Array.isArray(priceData)
            ? Number((priceData as Record<string, unknown>)['flux'])
            : NaN;

        const payment = {
            address: typeof paymentAddress === 'string' && paymentAddress.trim() ? paymentAddress : null,
            amountFlux: Number.isFinite(fluxAmount) ? Number(fluxAmount.toFixed(2)) : null,
            memo: hash,
            note: 'Pay to address with memo=hash (after optional test install).',
          };

          const message = status === 'submitted'
            ? 'Registration submitted. Poll for propagation with flux_apps_wait_for_propagation.'
            : status === 'awaiting_payment'
              ? 'Registration broadcasted. Next: (recommended) flux_apps_test_install with this hash, then pay with memo=hash.'
              : status === 'verifying_global'
                ? 'Registration appears permanent, but global app spec not visible yet. Re-check shortly.'
                : status === 'error'
                  ? 'Registration submission failed.'
                  : 'Registration verified.';

          const summary = {
            ok,
            status,
            done,
            registered,
            appname: appname ?? null,
            owner: owner ?? null,
            hash,
            attemptsUsed: propagation?.attemptsUsed ?? 0,
            temporaryPresent: propagation?.temporaryPresent ?? null,
            permanentPresent: propagation?.permanentPresent ?? null,
            globalPresent,
            messageToSignSha256,
            messageToSignBytes,
            messageToSignResourceUri: messageLink.uri,
            message,
            payment,
            resourceUri: link.uri,
            nextActions,
            signatureNotes: {
              loginSignature: 'Sign loginPhrase for zelidauth (auth).',
              appSignature: 'Sign messageToSign for registration.',
            },
          };

          return {
            content: [
              { type: 'text', text: JSON.stringify(summary, null, 2) },
              { type: 'resource_link', ...link },
              { type: 'resource_link', ...messageLink },
            ],
            structuredContent: summary,
            isError: status === 'error',
          };
       }


       case 'flux_apps_plan_update': {
         const requiresAuth = !client.getZelidauthSummary().present;

         const specInput = mustBeObject(args['spec'], 'spec');
        const timestamp = asOptionalNumber(args['timestamp']) ?? Date.now();
        const typeVersion = asOptionalNumber(args['typeVersion']) ?? 1;

        const verified = await client.request('/apps/verifyappupdatespecifications', {
          method: 'POST',
          body: specInput,
          allowMutation: true,
          timeoutMs: 5 * 60 * 1000,
        });

        const verifiedSpec = unwrapFluxEnvelope<Record<string, unknown>>(verified.data);

       const price = await client.request('/apps/calculateprice', {
         method: 'POST',
         body: verifiedSpec,
         allowMutation: true,
         timeoutMs: 5 * 60 * 1000,
       });

       const type = 'fluxappupdate' as const;
       const messageToSign = buildMessageToSign({ type, version: typeVersion, spec: verifiedSpec, timestamp });
       const messageLink = resourceStore.putText({
         kind: 'message_to_sign',
         name: `messageToSign ${type}`,
         description: 'Raw messageToSign bytes (exact data to sign)',
         mimeType: 'text/plain',
         text: messageToSign,
       });
       const payload = buildSignedPayload({ type, version: typeVersion, spec: verifiedSpec, timestamp });

       const authNote = requiresAuth
         ? 'Before submitting update, you must authenticate (zelidauth). This requires a separate signature over the login phrase (distinct from the app update signature).'
         : null;

       const paymentInfo = await buildPaymentInfoFromPrice(price, '<UPDATE_HASH>');

         const identity = extractAppIdentity(specInput);

         const messageToSignSha256 = createHash('sha256').update(messageToSign, 'utf8').digest('hex');
         const messageToSignBytes = Buffer.byteLength(messageToSign, 'utf8');

         const full = {
           requiresAuth,
           authNote,
           verified,
           price,
           timestamp,
           type,
           typeVersion,
           messageToSignSha256,
           messageToSignBytes,
           messageToSignResourceUri: messageLink.uri,
           payload,
           payment: paymentInfo.payment,
           paymentSources: {
             deploymentInformation: paymentInfo.deploymentInformation,
             price: paymentInfo.price,
           },
           signatureNotes: {
             loginSignature: 'Sign loginPhrase for zelidauth (auth).',
             appSignature: 'Sign messageToSign for update.',
           },
           next: 'Sign messageToSign with the OWNER ZelID (distinct from login phrase signature), then call flux_apps_update with signature + same timestamp.',
         };

         const fullLink = resourceStore.putJson({
           kind: 'apps/plan_update',
           name: `Plan update ${identity.appname ?? 'app'}`,
           description: 'Full output from flux_apps_plan_update',
           value: full,
         });

         const summary = {
           ok: true,
           requiresAuth,
           authNote,
           appname: identity.appname ?? null,
           owner: identity.owner ?? null,
           timestamp,
           type,
           typeVersion,
           payment: paymentInfo.payment,
           messageToSignSha256,
           messageToSignBytes,
           messageToSignResourceUri: messageLink.uri,
           resourceUri: fullLink.uri,
           signatureNotes: full.signatureNotes,
           nextActions: [
             { tool: 'flux_build_zelcore_sign_link', note: 'Pass the raw message from messageToSignResourceUri.' },
             { tool: 'flux_write_message_to_sign', note: 'Write messageToSign to disk for manual signing (confirm required).' },
             { tool: 'flux_apps_update', note: 'Submit update after signing (requires zelidauth).' },
           ],
         };

         return {
           content: [
             { type: 'text', text: JSON.stringify(summary, null, 2) },
             { type: 'resource_link', ...fullLink },
             { type: 'resource_link', ...messageLink },
           ],
           structuredContent: summary,
           isError: false,
         };
      }

       case 'flux_apps_plan_renew': {
         const requiresAuth = !client.getZelidauthSummary().present;

         const appname = mustBeString(args['appname'], 'appname');
         const ownerFilter = asOptionalString(args['owner']);
         const specArg = args['spec'];
         const specInput = specArg === undefined ? null : mustBeObject(specArg, 'spec');

         const weeks = asOptionalNumber(args['weeks']) ?? 1;
         const blocksToAddOverride = asOptionalNumber(args['blocksToAdd']);
         const blocksPerWeek = asOptionalNumber(args['blocksPerWeek']) ?? 22000;
         const secondsPerBlock = asOptionalNumber(args['secondsPerBlock']) ?? 30;
         const mode = (asOptionalString(args['mode']) ?? 'add_to_remaining') as 'from_now' | 'add_to_remaining';
         if (mode !== 'from_now' && mode !== 'add_to_remaining') {
           throw new Error('mode must be one of: from_now, add_to_remaining');
         }

         const timestamp = asOptionalNumber(args['timestamp']) ?? Date.now();
         const typeVersion = asOptionalNumber(args['typeVersion']) ?? 1;

         const [globalSpecsRes, scannedHeightRes, regInfoRes] = await Promise.all([
           client.request('/apps/globalappsspecifications', { query: { appname } }),
           client.request('/explorer/scannedheight'),
           client.request('/apps/registrationinformation'),
         ]);

         const globalSpecs = unwrapFluxEnvelope<unknown[]>(globalSpecsRes.data);
         const scanned = unwrapFluxEnvelope<Record<string, unknown>>(scannedHeightRes.data);
         const regInfo = unwrapFluxEnvelope<Record<string, unknown>>(regInfoRes.data);

         const currentHeightRaw = scanned?.['generalScannedHeight'];
         const currentHeight = typeof currentHeightRaw === 'number' ? currentHeightRaw : Number(currentHeightRaw);
         if (!Number.isFinite(currentHeight)) throw new Error('Could not parse explorer scanned height from /explorer/scannedheight');

         const blocksLastingRaw = regInfo?.['blocksLasting'];
         const daemonPONForkRaw = regInfo?.['daemonPONFork'];
         const blocksLasting = typeof blocksLastingRaw === 'number' ? blocksLastingRaw : Number(blocksLastingRaw);
         const daemonPONFork = typeof daemonPONForkRaw === 'number' ? daemonPONForkRaw : Number(daemonPONForkRaw);
         if (!Number.isFinite(blocksLasting) || !Number.isFinite(daemonPONFork)) {
           throw new Error('Could not parse blocksLasting/daemonPONFork from /apps/registrationinformation');
         }

         const apps = Array.isArray(globalSpecs)
           ? globalSpecs.filter((x): x is Record<string, unknown> => !!x && typeof x === 'object' && !Array.isArray(x))
           : [];
         const appEntry = pickLatestGlobalSpec(apps, appname, ownerFilter ?? undefined);
         if (!appEntry) {
           throw new Error(`App ${appname} not found in /apps/globalappsspecifications`);
         }

         const expiration = computeAppExpiration({
           app: appEntry,
           currentHeight,
           blocksLasting,
           daemonPONFork,
         });

         const blocksRemaining = expiration.blocksRemaining;
         const blocksToAdd = blocksToAddOverride === undefined
           ? Math.max(0, Math.floor(weeks * blocksPerWeek))
           : Math.floor(blocksToAddOverride);
         const baseRemaining = Number.isFinite(blocksRemaining) ? Math.max(0, Math.floor(blocksRemaining)) : 0;
         const expireComputed = mode === 'from_now' ? blocksToAdd : baseRemaining + blocksToAdd;

         let workingSpec: Record<string, unknown> | null = specInput;
         let specSource: 'provided' | 'appspecifications' | null = specInput ? 'provided' : null;
         let specWarning: string | null = null;
         let isEnterprise = false;

         if (!workingSpec) {
           const specRes = await client.request(`/apps/appspecifications/${encodeURIComponent(appname)}`);
           if (!specRes.ok || !isFluxSuccess(specRes.data)) {
             throw new Error(extractFluxErrorMessage(specRes.data) ?? 'Failed to fetch app spec');
           }
           workingSpec = unwrapFluxEnvelope<Record<string, unknown>>(specRes.data);
           specSource = 'appspecifications';
         }

         if (workingSpec) {
           const version = workingSpec['version'];
           const enterpriseField = workingSpec['enterprise'];
           isEnterprise = typeof version === 'number'
             ? version >= 8 && !!enterpriseField
             : Number(version) >= 8 && !!enterpriseField;

           if (isEnterprise && specSource === 'appspecifications') {
             const compose = workingSpec['compose'];
             if (Array.isArray(compose) && compose.length === 0) {
               specWarning =
                 'Enterprise app detected. appspecifications without decrypt omits compose/contacts; provide full spec or use enterprise decrypt flow before renewing.';
             }
           }
         }

         const updatedSpec = workingSpec && !specWarning
           ? { ...workingSpec, expire: expireComputed }
           : null;

         let verified: FluxRequestResult | null = null;
         let price: FluxRequestResult | null = null;
         let messageToSign: string | null = null;
         let messageLink: ReturnType<typeof resourceStore.putText> | null = null;
         let payload: Record<string, unknown> | null = null;
         let paymentInfo: Awaited<ReturnType<typeof buildPaymentInfo>> | null = null;

         if (updatedSpec) {
           verified = await client.request('/apps/verifyappupdatespecifications', {
             method: 'POST',
             body: updatedSpec,
             allowMutation: true,
             timeoutMs: 5 * 60 * 1000,
           });

           const verifiedSpec = unwrapFluxEnvelope<Record<string, unknown>>(verified.data);
           price = await client.request('/apps/calculateprice', {
             method: 'POST',
             body: verifiedSpec,
             allowMutation: true,
             timeoutMs: 5 * 60 * 1000,
           });

           const type = 'fluxappupdate' as const;
           messageToSign = buildMessageToSign({ type, version: typeVersion, spec: verifiedSpec, timestamp });
           messageLink = resourceStore.putText({
             kind: 'message_to_sign',
             name: `messageToSign ${type}`,
             description: 'Raw messageToSign bytes (exact data to sign)',
             mimeType: 'text/plain',
             text: messageToSign,
           });
           payload = buildSignedPayload({ type, version: typeVersion, spec: verifiedSpec, timestamp });
           paymentInfo = await buildPaymentInfoFromPrice(price, '<UPDATE_HASH>');
         }

         const secondsRemaining = estimateSecondsFromBlocks(baseRemaining, secondsPerBlock);
         const timeRemaining = formatDurationSeconds(secondsRemaining);

         const ok = updatedSpec !== null;

         const messageToSignSha256 = messageToSign
           ? createHash('sha256').update(messageToSign, 'utf8').digest('hex')
           : null;
         const messageToSignBytes = messageToSign ? Buffer.byteLength(messageToSign, 'utf8') : null;

         const full = {
           ok,
           requiresAuth,
           appname,
           ownerFilter: ownerFilter ?? null,
           reference: {
             currentHeight,
             blocksRemainingAtReference: blocksRemaining,
             timeRemaining,
             blocksLasting,
             daemonPONFork,
           },
           policy: {
             mode,
             weeks,
             blocksPerWeek,
             blocksToAdd,
           },
           expireComputed,
           specSource,
           specWarning,
           isEnterprise,
           updatedSpec,
           verified,
           price,
           timestamp,
           type: ok ? 'fluxappupdate' : null,
           typeVersion: ok ? typeVersion : null,
           messageToSignSha256,
           messageToSignBytes,
           messageToSignResourceUri: messageLink?.uri ?? null,
           payload,
           payment: paymentInfo?.payment ?? null,
           paymentSources: paymentInfo
             ? { deploymentInformation: paymentInfo.deploymentInformation, price: paymentInfo.price }
             : null,
           signatureNotes: {
             loginSignature: 'Sign loginPhrase for zelidauth (auth).',
             appSignature: 'Sign messageToSign for update.',
           },
           next: ok
             ? 'Sign messageToSign with the OWNER ZelID (distinct from login phrase signature), then call flux_apps_update with signature + same timestamp.'
             : 'Provide a full spec (especially for enterprise apps) to proceed with renewal.',
         };

         const fullLink = resourceStore.putJson({
           kind: 'apps/plan_renew',
           name: `Plan renew ${appname}`,
           description: 'Full output from flux_apps_plan_renew',
           value: full,
         });

         const nextActions = ok
           ? [
               { tool: 'flux_build_zelcore_sign_link', note: 'Pass the raw message from messageToSignResourceUri.' },
               { tool: 'flux_write_message_to_sign', note: 'Write messageToSign to disk for manual signing (confirm required).' },
               { tool: 'flux_apps_update', note: 'Submit update after signing (requires zelidauth).' },
             ]
           : [
               isEnterprise
                 ? {
                     tool: 'flux_apps_get_spec_full',
                     note: 'For enterprise apps: fetch the decrypted spec first (requires zelidauth + Arcane node).',
                   }
                 : null,
               {
                 tool: 'flux_apps_plan_renew',
                 note: 'Re-run with a full spec in the spec argument (especially for enterprise apps).',
               },
             ].filter(Boolean);

         const summary = {
           ok,
           requiresAuth,
           appname,
           ownerFilter: ownerFilter ?? null,
           reference: full.reference,
           policy: full.policy,
           expireComputed,
           specSource,
           specWarning,
           isEnterprise,
           timestamp,
           type: full.type,
           typeVersion: full.typeVersion,
           payment: full.payment,
           messageToSignSha256,
           messageToSignBytes,
           messageToSignResourceUri: full.messageToSignResourceUri,
           resourceUri: fullLink.uri,
           signatureNotes: full.signatureNotes,
           next: full.next,
           nextActions,
         };

         const content: Array<
           | { type: 'text'; text: string }
           | { type: 'resource_link'; uri: string; name: string; description?: string; mimeType?: string }
         > = [
           { type: 'text', text: JSON.stringify(summary, null, 2) },
           { type: 'resource_link', ...fullLink },
         ];
         if (messageLink) content.push({ type: 'resource_link', ...messageLink });

         return {
           content,
           structuredContent: summary,
           isError: !summary.ok,
         };
      }

        case 'flux_apps_update': {
         assertAuthenticatedFor('apps/appupdate');

         const specInput = mustBeObject(args['spec'], 'spec');
         const signature = mustBeString(args['signature'], 'signature');
         const timestamp = mustBeNumber(args['timestamp'], 'timestamp');
         const verifyFirstRaw = args['verifyFirst'];
         const verifyFirst = verifyFirstRaw === undefined ? true : mustBeBoolean(verifyFirstRaw, 'verifyFirst');
         const typeVersion = asOptionalNumber(args['typeVersion']) ?? 1;
         const includePayment = (asOptionalBoolean(args['includePayment']) ?? true) === true;
 
         const verified = verifyFirst
           ? await client.request('/apps/verifyappupdatespecifications', {
               method: 'POST',
               body: specInput,
               allowMutation: true,
               timeoutMs: 5 * 60 * 1000,
             })
           : null;
 
         const spec = verified ? unwrapFluxEnvelope<Record<string, unknown>>(verified.data) : specInput;
         const { appname, owner } = extractAppIdentity(spec);
 
         const type = 'fluxappupdate' as const;
         const messageToSign = buildMessageToSign({ type, version: typeVersion, spec, timestamp });
         const messageToSignSha256 = createHash('sha256').update(messageToSign, 'utf8').digest('hex');
         const messageToSignBytes = Buffer.byteLength(messageToSign, 'utf8');
         const messageLink = resourceStore.putText({
           kind: 'message_to_sign',
           name: `messageToSign ${type}`,
           description: 'Raw messageToSign bytes (exact data to sign)',
           mimeType: 'text/plain',
           text: messageToSign,
         });
         const payload = buildSignedPayload({ type, version: typeVersion, spec, timestamp, signature });
 
         const submit = await client.request('/apps/appupdate', {
           method: 'POST',
           body: payload,
           allowMutation: true,
         });
 
         const hash = extractHashFromAppMessageResponse(submit.data);

         const updatedOk = submit.ok && isFluxSuccess(submit.data);
         const submitError = updatedOk ? null : (extractFluxErrorMessage(submit.data) ?? null);

         const paymentInfo =
           includePayment && updatedOk ? await buildPaymentInfo(spec, hash ?? null) : null;

         const full = {
           verified,
           submit,
           appname: appname ?? null,
           owner: owner ?? null,
           hash: hash ?? null,
           messageToSignSha256,
           messageToSignBytes,
           messageToSignResourceUri: messageLink.uri,
           payload,
           payment: paymentInfo?.payment ?? null,
           paymentSources: paymentInfo
             ? { deploymentInformation: paymentInfo.deploymentInformation, price: paymentInfo.price }
             : null,
           error: submitError,
           signatureNotes: {
             loginSignature: 'Sign loginPhrase for zelidauth (auth).',
             appSignature: 'Sign messageToSign for update.',
           },
         };

         const fullLink = resourceStore.putJson({
           kind: 'apps/update',
           name: `Update ${appname ?? hash ?? 'app'}`,
           description: 'Full output from flux_apps_update',
           value: full,
         });

         const summary = {
           ok: updatedOk,
           status: updatedOk ? 'submitted' : 'error',
           appname: appname ?? null,
           owner: owner ?? null,
           hash: hash ?? null,
           error: submitError,
           payment: paymentInfo?.payment ?? null,
           messageToSignSha256,
           messageToSignBytes,
           messageToSignResourceUri: messageLink.uri,
           resourceUri: fullLink.uri,
           signatureNotes: full.signatureNotes,
           nextActions: hash ? [{ tool: 'flux_apps_get_messages', arguments: { hash, kind: 'both' } }] : [],
         };

         return {
           content: [
             { type: 'text', text: JSON.stringify(summary, null, 2) },
             { type: 'resource_link', ...fullLink },
             { type: 'resource_link', ...messageLink },
           ],
           structuredContent: summary,
           isError: !updatedOk,
         };
       }

        case 'flux_apps_update_and_verify': {
         requireConfirm(args, 'apps/appupdate');
         assertAuthenticatedFor('apps/appupdate');

         const specInput = mustBeObject(args['spec'], 'spec');
         const signature = mustBeString(args['signature'], 'signature');
         const timestamp = mustBeNumber(args['timestamp'], 'timestamp');
         const verifyFirstRaw = args['verifyFirst'];
         const verifyFirst = verifyFirstRaw === undefined ? true : mustBeBoolean(verifyFirstRaw, 'verifyFirst');
         const typeVersion = asOptionalNumber(args['typeVersion']) ?? 1;
 
         const attempts = asOptionalNumber(args['attempts']) ?? 10;
         const intervalMs = asOptionalNumber(args['intervalMs']) ?? 3000;
         const poll = (asOptionalBoolean(args['poll']) ?? true) === true;
         const pollTimeoutMs = asOptionalNumber(args['pollTimeoutMs']);
         const verifyGlobal = (asOptionalBoolean(args['verifyGlobal']) ?? true) === true;
         const includePayment = (asOptionalBoolean(args['includePayment']) ?? true) === true;
 
         const verified = verifyFirst
           ? await client.request('/apps/verifyappupdatespecifications', {
               method: 'POST',
               body: specInput,
               allowMutation: true,
             })
           : null;
 
         const spec = verified ? unwrapFluxEnvelope<Record<string, unknown>>(verified.data) : specInput;
         const { appname, owner } = extractAppIdentity(spec);
 
         const type = 'fluxappupdate' as const;
         const messageToSign = buildMessageToSign({ type, version: typeVersion, spec, timestamp });
         const messageToSignSha256 = createHash('sha256').update(messageToSign, 'utf8').digest('hex');
         const messageToSignBytes = Buffer.byteLength(messageToSign, 'utf8');
         const messageLink = resourceStore.putText({
           kind: 'message_to_sign',
           name: `messageToSign ${type}`,
           description: 'Raw messageToSign bytes (exact data to sign)',
           mimeType: 'text/plain',
           text: messageToSign,
         });
         const payload = buildSignedPayload({ type, version: typeVersion, spec, timestamp, signature });
 
         const submit = await client.request('/apps/appupdate', {
           method: 'POST',
           body: payload,
           allowMutation: true,
         });
 
          const hash = extractHashFromAppMessageResponse(submit.data);
          if (!hash) {
            const error = extractFluxErrorMessage(submit.data);
            const hint = error ? ` Flux error: ${error}` : '';
            throw new Error(`Could not extract message hash from update response.${hint}`);
          }
 
         const propagation = poll
           ? await pollMessagePropagation({ hash, attempts, intervalMs, timeoutMs: pollTimeoutMs })
           : null;

         let globalCheck: FluxRequestResult | null = null;
         let globalPresent: boolean | null = null;
         if (verifyGlobal && appname) {
           globalCheck = await client.request('/apps/globalappsspecifications', {
             query: { appname, owner: owner ?? undefined },
           });
           if (globalCheck.ok && isFluxSuccess(globalCheck.data)) {
             const globalSpecs = unwrapFluxEnvelope<unknown>(globalCheck.data);
             if (Array.isArray(globalSpecs)) {
               globalPresent = globalSpecs.some((x) => {
                 if (!x || typeof x !== 'object' || Array.isArray(x)) return false;
                 const n = (x as Record<string, unknown>).name;
                 const o = (x as Record<string, unknown>).owner;
                 const nameOk = typeof n === 'string' && n === appname;
                 const ownerOk = !owner || (typeof o === 'string' && o === owner);
                 return nameOk && ownerOk;
               });
             } else {
               globalPresent = hasNonEmptyValue(globalSpecs);
             }
           }
         }

          const updated = submit.ok;
          const status = !updated
            ? 'error'
            : !poll
              ? 'submitted'
              : propagation?.permanentPresent !== true
                ? 'pending'
                : globalPresent === false
                  ? 'verifying_global'
                  : 'verified';

          const done = status === 'verified';
          const ok = updated;

          const link = resourceStore.putJson({
            kind: 'apps/update_and_verify',
            name: `Update and verify ${appname ?? hash}`,
            description: 'Update submission + propagation checks',
            value: {
              appname: appname ?? null,
              owner: owner ?? null,
              hash,
              attempts,
              intervalMs,
              poll,
              verified,
              submit,
              propagation,
              globalCheck,
              globalPresent,
            },
          });

          const nextActions = status === 'verified'
            ? []
            : [
                { tool: 'flux_apps_get_messages', arguments: { hash, kind: 'both' } },
                { tool: 'flux_apps_wait_for_propagation', arguments: { hash, attempts, intervalMs } },
                appname ? { tool: 'flux_apps_global_status', arguments: { appname, zelid: owner } } : null,
              ].filter(Boolean);

          const message = status === 'submitted'
            ? 'Update submitted. Poll for propagation with flux_apps_wait_for_propagation.'
            : status === 'pending'
              ? 'Update broadcasted. Wait for propagation to permanent messages.'
              : status === 'verifying_global'
                ? 'Update appears permanent, but global app spec not visible yet. Re-check shortly.'
                : status === 'error'
                  ? 'Update submission failed.'
                  : 'Update verified.';

          const paymentInfo = includePayment ? await buildPaymentInfo(spec, hash ?? null) : null;

          const summary = {
            ok,
            status,
            done,
            updated,
            appname: appname ?? null,
            owner: owner ?? null,
            hash,
            attemptsUsed: propagation?.attemptsUsed ?? 0,
            temporaryPresent: propagation?.temporaryPresent ?? null,
            permanentPresent: propagation?.permanentPresent ?? null,
            globalPresent,
            messageToSignSha256,
            messageToSignBytes,
            messageToSignResourceUri: messageLink.uri,
            message,
            payment: paymentInfo?.payment ?? null,
            paymentSources: paymentInfo
              ? { deploymentInformation: paymentInfo.deploymentInformation, price: paymentInfo.price }
              : null,
            resourceUri: link.uri,
            nextActions,
            signatureNotes: {
              loginSignature: 'Sign loginPhrase for zelidauth (auth).',
              appSignature: 'Sign messageToSign for update.',
            },
          };

          return {
            content: [
              { type: 'text', text: JSON.stringify(summary, null, 2) },
              { type: 'resource_link', ...link },
              { type: 'resource_link', ...messageLink },
            ],
            structuredContent: summary,
            isError: status === 'error',
          };
       }


      case 'flux_apps_get_messages': {
        const hash = mustBeString(args['hash'], 'hash');
        const kind = asOptionalString(args['kind']) ?? 'both';

        if (kind === 'temporary') {
          const res = await client.request(`/apps/temporarymessages/${encodeURIComponent(hash)}`);
          const link = resourceStore.putJson({
            kind: 'apps/messages/temporary',
            name: `Temporary messages ${hash}`,
            description: 'Raw /apps/temporarymessages response',
            value: res,
          });
          const ok = isFluxEnvelopeOk(res);
          const summary = { ok, status: res.status, kind, hash, resourceUri: link.uri };
          return {
            content: [{ type: 'text', text: JSON.stringify(summary, null, 2) }, { type: 'resource_link', ...link }],
            structuredContent: summary,
            isError: !ok,
          };
        }

        if (kind === 'permanent') {
          const res = await client.request(`/apps/permanentmessages/${encodeURIComponent(hash)}`);
          const link = resourceStore.putJson({
            kind: 'apps/messages/permanent',
            name: `Permanent messages ${hash}`,
            description: 'Raw /apps/permanentmessages response',
            value: res,
          });
          const ok = isFluxEnvelopeOk(res);
          const summary = { ok, status: res.status, kind, hash, resourceUri: link.uri };
          return {
            content: [{ type: 'text', text: JSON.stringify(summary, null, 2) }, { type: 'resource_link', ...link }],
            structuredContent: summary,
            isError: !ok,
          };
        }

        const [temporary, permanent] = await Promise.all([
          client.request(`/apps/temporarymessages/${encodeURIComponent(hash)}`),
          client.request(`/apps/permanentmessages/${encodeURIComponent(hash)}`),
        ]);

        const link = resourceStore.putJson({
          kind: 'apps/messages/both',
          name: `Messages ${hash}`,
          description: 'Raw temporary+permanent message responses',
          value: { temporary, permanent },
        });

        const tempOk = isFluxEnvelopeOk(temporary);
        const permOk = isFluxEnvelopeOk(permanent);

        const summary = {
          ok: tempOk && permOk,
          hash,
          kind,
          resourceUri: link.uri,
          temporary: { ok: tempOk, status: temporary.status },
          permanent: { ok: permOk, status: permanent.status },
        };

        return {
          content: [{ type: 'text', text: JSON.stringify(summary, null, 2) }, { type: 'resource_link', ...link }],
          structuredContent: summary,
          isError: !summary.ok,
        };
      }

      case 'flux_apps_wait_for_propagation': {
        const hash = mustBeString(args['hash'], 'hash');
        const attempts = asOptionalNumber(args['attempts']) ?? 10;
        const intervalMs = asOptionalNumber(args['intervalMs']) ?? 3000;
        const timeoutMs = asOptionalNumber(args['timeoutMs']);

        const propagation = await pollMessagePropagation({ hash, attempts, intervalMs, timeoutMs });
        const status = propagation.permanentPresent ? 'permanent' : propagation.temporaryPresent ? 'temporary' : 'pending';

        const link = resourceStore.putJson({
          kind: 'apps/propagation',
          name: `Propagation ${hash}`,
          description: 'Polling result for temporary/permanent messages',
          value: propagation,
        });

        const summary = {
          ok: true,
          hash,
          status,
          attemptsUsed: propagation.attemptsUsed,
          temporaryPresent: propagation.temporaryPresent,
          permanentPresent: propagation.permanentPresent,
          resourceUri: link.uri,
        };

        return {
          content: [{ type: 'text', text: JSON.stringify(summary, null, 2) }, { type: 'resource_link', ...link }],
          structuredContent: summary,
          isError: false,
        };
      }

      case 'flux_apps_start': {
        requireConfirm(args, 'apps/appstart');
        const appname = mustBeString(args['appname'], 'appname');
        const global = asOptionalBoolean(args['global']);

        return jsonResult(
          await client.request('/apps/appstart', {
            method: 'GET',
            query: { appname, global },
            allowMutation: true,
          })
        );
      }

      case 'flux_apps_stop': {
        requireConfirm(args, 'apps/appstop');
        const appname = mustBeString(args['appname'], 'appname');
        const global = asOptionalBoolean(args['global']);

        return jsonResult(
          await client.request('/apps/appstop', {
            method: 'GET',
            query: { appname, global },
            allowMutation: true,
          })
        );
      }

      case 'flux_apps_restart': {
        requireConfirm(args, 'apps/apprestart');
        const appname = mustBeString(args['appname'], 'appname');
        const global = asOptionalBoolean(args['global']);

        return jsonResult(
          await client.request('/apps/apprestart', {
            method: 'GET',
            query: { appname, global },
            allowMutation: true,
          })
        );
      }

      case 'flux_apps_test_install': {
        requireConfirm(args, 'apps/testappinstall');
        const hash = mustBeString(args['hash'], 'hash');
        const timeoutMsRaw = asOptionalNumber(args['timeoutMs']);
        const timeoutMs = timeoutMsRaw === undefined ? 120_000 : timeoutMsRaw;

        const res = await client.request(`/apps/testappinstall/${encodeURIComponent(hash)}`, {
          method: 'GET',
          allowMutation: true,
          responseType: 'text',
          timeoutMs,
        });

        const text = typeof res.data === 'string' ? res.data : JSON.stringify(res.data, null, 2);
        const parsed = parseProgressOutput(text);

        const link = resourceStore.putJson({
          kind: 'apps/test_install',
          name: `Test install ${hash}`,
          description: 'Parsed /apps/testappinstall output',
          value: { request: { hash, timeoutMs }, response: res, parsed },
        });

        const lastJson = parsed.jsonObjects.length > 0 ? parsed.jsonObjects[parsed.jsonObjects.length - 1] : null;
        const success =
          lastJson && typeof lastJson === 'object' && !Array.isArray(lastJson)
            ? (() => {
                const obj = lastJson as Record<string, unknown>;
                const status = obj.status;
                return typeof status === 'string' ? status.toLowerCase() === 'success' : false;
              })()
            : false;

        const summary = {
          ok: res.ok && success,
          httpStatus: res.status,
          hash,
          timeoutMs,
          eventCount: parsed.events.length,
          events: parsed.events.slice(0, 50),
          resourceUri: link.uri,
          nextActions: [
            { tool: 'flux_resource_read', arguments: { uri: link.uri } },
            { tool: 'flux_apps_get_messages', arguments: { hash, kind: 'both' } },
          ],
        };

        return {
          content: [{ type: 'text', text: JSON.stringify(summary, null, 2) }, { type: 'resource_link', ...link }],
          structuredContent: summary,
          isError: !summary.ok,
        };
      }

      case 'flux_apps_redeploy': {
        requireConfirm(args, 'apps/redeploy');
        const appname = mustBeString(args['appname'], 'appname');
        const force = asOptionalBoolean(args['force']);
        const global = asOptionalBoolean(args['global']);
        const timeoutMs = asOptionalNumber(args['timeoutMs']);

        const res = await client.request('/apps/redeploy', {
          method: 'GET',
          query: { appname, force, global },
          allowMutation: true,
          responseType: 'text',
          timeoutMs,
        });

        const text = typeof res.data === 'string' ? res.data : JSON.stringify(res.data, null, 2);
        const parsed = parseProgressOutput(text);

        const link = resourceStore.putJson({
          kind: 'apps/redeploy',
          name: `${appname} redeploy`,
          description: 'Parsed /apps/redeploy output',
          value: { request: { appname, force: force ?? null, global: global ?? null }, response: res, parsed },
        });

        const summary = {
          ok: res.ok,
          status: res.status,
          appname,
          force: force ?? null,
          global: global ?? null,
          eventCount: parsed.events.length,
          resourceUri: link.uri,
          events: parsed.events.slice(0, 25),
          nextActions: [
            { tool: 'flux_resource_read', arguments: { uri: link.uri } },
            { tool: 'flux_apps_logs', arguments: { appname } },
            { tool: 'flux_apps_stats', arguments: { appname } },
          ],
        };

        return {
          content: [
            { type: 'text', text: JSON.stringify(summary, null, 2) },
            { type: 'resource_link', ...link },
          ],
          structuredContent: summary,
          isError: !res.ok,
        };
      }

      case 'flux_apps_redeploy_component': {
        requireConfirm(args, 'apps/redeploycomponent');
        const appname = mustBeString(args['appname'], 'appname');
        const component = mustBeString(args['component'], 'component');
        const force = asOptionalBoolean(args['force']);
        const timeoutMs = asOptionalNumber(args['timeoutMs']);

        const res = await client.request('/apps/redeploycomponent', {
          method: 'GET',
          query: { appname, component, force },
          allowMutation: true,
          responseType: 'text',
          timeoutMs,
        });

        const text = typeof res.data === 'string' ? res.data : JSON.stringify(res.data, null, 2);
        const parsed = parseProgressOutput(text);

        const link = resourceStore.putJson({
          kind: 'apps/redeploycomponent',
          name: `${appname}/${component} redeploy`,
          description: 'Parsed /apps/redeploycomponent output',
          value: { request: { appname, component, force: force ?? null }, response: res, parsed },
        });

        const summary = {
          ok: res.ok,
          status: res.status,
          appname,
          component,
          force: force ?? null,
          eventCount: parsed.events.length,
          resourceUri: link.uri,
          events: parsed.events.slice(0, 25),
          nextActions: [
            { tool: 'flux_resource_read', arguments: { uri: link.uri } },
            { tool: 'flux_apps_logs', arguments: { appname } },
          ],
        };

        return {
          content: [
            { type: 'text', text: JSON.stringify(summary, null, 2) },
            { type: 'resource_link', ...link },
          ],
          structuredContent: summary,
          isError: !res.ok,
        };
      }

      case 'flux_apps_logs': {
        const appname = mustBeString(args['appname'], 'appname');
        const lines = asOptionalString(args['lines']) ?? 'all';

        const resolved = await resolveContainerOnCorrectNode({ client, appname, requireRunning: true });
        const attemptedBaseUrl = client.getBaseUrl() ?? null;

        const targets = resolved
          ? [resolved.containerName, ...resolved.containerNames.filter((n) => n !== resolved.containerName)]
          : [appname, `fluxserver_${appname}`];

        const attempt = resolved
          ? await attemptOnCandidates(
              resolved.candidates.map((c) => ({ baseUrl: c.baseUrl, host: c.host, apiPort: c.apiPort })),
              async (baseUrl) => {
                client.setBaseUrl(baseUrl);

                for (const t of targets) {
                  const r = await client.request('/apps/applog', { query: { appname: t, lines } });
                  if (r.ok && isFluxSuccess(r.data)) return { res: r, target: t };
                }

                return { res: await client.request('/apps/applog', { query: { appname: targets[0], lines } }), target: targets[0] };
              }
            )
          : null;

        let res: FluxRequestResult;
        let target: string;

        if (resolved && attempt && attempt.ok) {
          res = attempt.value.res;
          target = attempt.value.target;
        } else {
          res = await client.request('/apps/applog', { query: { appname: appname, lines } });
          target = appname;
          if (!isFluxEnvelopeOk(res)) {
            const fallback = `fluxserver_${appname}`;
            const r2 = await client.request('/apps/applog', { query: { appname: fallback, lines } });
            if (isFluxEnvelopeOk(r2)) {
              res = r2;
              target = fallback;
            }
          }
        }

        let knownError = extractFluxErrorMessage(res.data);

         const link = resourceStore.putJson({
           kind: 'apps/applog',
           name: `${appname} applog`,
           description: 'Raw /apps/applog response',
           value: res,
         });

        const payload = unwrapFluxEnvelope<unknown>(res.data);
        const logText = typeof payload === 'string' ? payload : JSON.stringify(payload, null, 2);
        const logLines = logText.split(/\r?\n/).filter((l) => l.length);
        const preview = logLines.slice(-Math.min(logLines.length, 50));

        const ok = isFluxEnvelopeOk(res);

        const summary = {
          ok,
          status: res.status,
          appname,
          resolved: resolved
            ? { baseUrl: resolved.baseUrl, host: resolved.host, apiPort: resolved.apiPort, containerName: resolved.containerName, previousBaseUrl: attemptedBaseUrl }
            : null,
          target,
          lines,
          preview: ok ? preview : null,
          error: ok ? null : knownError,
          resourceUri: link.uri,
          nextActions: ok
            ? []
            : [
                { tool: 'flux_apps_resolve_runtime_target', arguments: { appname } },
                { tool: 'flux_apps_inspect', arguments: { appname } },
                { tool: 'flux_logs_tail', arguments: { appname } },
              ],
        };

        return {
          content: [
            { type: 'text', text: JSON.stringify(summary, null, 2) },
            { type: 'resource_link', ...link },
          ],
          structuredContent: summary,
          isError: !ok,
        };
      }

      case 'flux_apps_inspect': {
        const appname = mustBeString(args['appname'], 'appname');

        const attemptedBaseUrl = client.getBaseUrl() ?? null;

        let target = appname;
        let res = await client.request('/apps/appinspect', { query: { appname: target } });
        let knownError = extractFluxErrorMessage(res.data);

        let resolvedInfo: {
          baseUrl: string;
          host: string;
          apiPort: number;
          containerName: string;
          previousBaseUrl: string | null;
        } | null = null;

        if (knownError && knownError.startsWith('Container not found on this node.')) {
          const resolved = await resolveContainerOnCorrectNode({ client, appname, requireRunning: true });
          if (resolved) {
            client.setBaseUrl(resolved.baseUrl);
            target = resolved.containerName;
            resolvedInfo = {
              baseUrl: resolved.baseUrl,
              host: resolved.host,
              apiPort: resolved.apiPort,
              containerName: resolved.containerName,
              previousBaseUrl: attemptedBaseUrl,
            };
            res = await client.request('/apps/appinspect', { query: { appname: target } });
            knownError = extractFluxErrorMessage(res.data);
          }
        }

        const link = resourceStore.putJson({
          kind: 'apps/inspect',
          name: `${appname} inspect`,
          description: 'Raw /apps/appinspect response',
          value: res,
        });

        const ok = res.ok && isFluxSuccess(res.data);

        const summary = {
          ok,
          status: res.status,
          appname,
          target,
          resolved: resolvedInfo,
          error: ok ? null : knownError,
          resourceUri: link.uri,
        };

        return {
          content: [
            { type: 'text', text: JSON.stringify(summary, null, 2) },
            { type: 'resource_link', ...link },
          ],
          structuredContent: summary,
          isError: !ok,
        };
      }

      case 'flux_apps_stats': {
        const appname = mustBeString(args['appname'], 'appname');

        const attemptedBaseUrl = client.getBaseUrl() ?? null;

        let target = appname;
        let res = await client.request('/apps/appstats', { query: { appname: target } });
        let knownError = extractFluxErrorMessage(res.data);

        let resolvedInfo: {
          baseUrl: string;
          host: string;
          apiPort: number;
          containerName: string;
          previousBaseUrl: string | null;
        } | null = null;

        if (knownError && knownError.startsWith('Container not found on this node.')) {
          const resolved = await resolveContainerOnCorrectNode({ client, appname, requireRunning: true });
          if (resolved) {
            client.setBaseUrl(resolved.baseUrl);
            target = resolved.containerName;
            resolvedInfo = {
              baseUrl: resolved.baseUrl,
              host: resolved.host,
              apiPort: resolved.apiPort,
              containerName: resolved.containerName,
              previousBaseUrl: attemptedBaseUrl,
            };
            res = await client.request('/apps/appstats', { query: { appname: target } });
            knownError = extractFluxErrorMessage(res.data);
          }
        }

        const link = resourceStore.putJson({
          kind: 'apps/stats',
          name: `${appname} stats`,
          description: 'Raw /apps/appstats response',
          value: res,
        });

        const ok = res.ok && isFluxSuccess(res.data);

        const summary = {
          ok,
          status: res.status,
          appname,
          target,
          resolved: resolvedInfo,
          error: ok ? null : knownError,
          resourceUri: link.uri,
        };

        return {
          content: [
            { type: 'text', text: JSON.stringify(summary, null, 2) },
            { type: 'resource_link', ...link },
          ],
          structuredContent: summary,
          isError: !ok,
        };
      }

      case 'flux_apps_top': {
        const appname = mustBeString(args['appname'], 'appname');

        const attemptedBaseUrl = client.getBaseUrl() ?? null;

        let target = appname;
        let res = await client.request('/apps/apptop', { query: { appname: target } });
        let knownError = extractFluxErrorMessage(res.data);

        let resolvedInfo: {
          baseUrl: string;
          host: string;
          apiPort: number;
          containerName: string;
          previousBaseUrl: string | null;
        } | null = null;

        if (knownError && knownError.startsWith('Container not found on this node.')) {
          const resolved = await resolveContainerOnCorrectNode({ client, appname, requireRunning: true });
          if (resolved) {
            client.setBaseUrl(resolved.baseUrl);
            target = resolved.containerName;
            resolvedInfo = {
              baseUrl: resolved.baseUrl,
              host: resolved.host,
              apiPort: resolved.apiPort,
              containerName: resolved.containerName,
              previousBaseUrl: attemptedBaseUrl,
            };
            res = await client.request('/apps/apptop', { query: { appname: target } });
            knownError = extractFluxErrorMessage(res.data);
          }
        }

        const link = resourceStore.putJson({
          kind: 'apps/top',
          name: `${appname} top`,
          description: 'Raw /apps/apptop response',
          value: res,
        });

        const ok = res.ok && isFluxSuccess(res.data);

        const summary = {
          ok,
          status: res.status,
          appname,
          target,
          resolved: resolvedInfo,
          error: ok ? null : knownError,
          resourceUri: link.uri,
        };

        return {
          content: [
            { type: 'text', text: JSON.stringify(summary, null, 2) },
            { type: 'resource_link', ...link },
          ],
          structuredContent: summary,
          isError: !ok,
        };
      }

      case 'flux_apps_monitor': {
        const appname = mustBeString(args['appname'], 'appname');
        const range = asOptionalNumber(args['range']);

        const attemptedBaseUrl = client.getBaseUrl() ?? null;

        let target = appname;
        let res = await client.request('/apps/appmonitor', { query: { appname: target, range } });
        let knownError = extractFluxErrorMessage(res.data);

        let resolvedInfo: {
          baseUrl: string;
          host: string;
          apiPort: number;
          containerName: string;
          previousBaseUrl: string | null;
        } | null = null;

        if (knownError && knownError.startsWith('Container not found on this node.')) {
          const resolved = await resolveContainerOnCorrectNode({ client, appname, requireRunning: true });
          if (resolved) {
            client.setBaseUrl(resolved.baseUrl);
            target = resolved.containerName;
            resolvedInfo = {
              baseUrl: resolved.baseUrl,
              host: resolved.host,
              apiPort: resolved.apiPort,
              containerName: resolved.containerName,
              previousBaseUrl: attemptedBaseUrl,
            };
            res = await client.request('/apps/appmonitor', { query: { appname: target, range } });
            knownError = extractFluxErrorMessage(res.data);
          }
        }

        const link = resourceStore.putJson({
          kind: 'apps/monitor',
          name: `${appname} monitor`,
          description: 'Raw /apps/appmonitor response',
          value: res,
        });

        const ok = res.ok && isFluxSuccess(res.data);

        const summary = {
          ok,
          status: res.status,
          appname,
          target,
          resolved: resolvedInfo,
          range: range ?? null,
          error: ok ? null : knownError,
          resourceUri: link.uri,
        };

        return {
          content: [
            { type: 'text', text: JSON.stringify(summary, null, 2) },
            { type: 'resource_link', ...link },
          ],
          structuredContent: summary,
          isError: !ok,
        };
      }

      case 'flux_apps_exec': {
        requireConfirm(args, 'apps/appexec');
        const appname = mustBeString(args['appname'], 'appname');
        const cmd = args['cmd'];
        if (!Array.isArray(cmd) || cmd.some((c) => typeof c !== 'string')) {
          throw new Error('cmd must be an array of strings');
        }
        const env = normalizeEnvParams(args['env']);

        const attemptedBaseUrl = client.getBaseUrl() ?? null;

        const parseTextAsJson = (text: string): unknown | null => {
          const trimmed = (text ?? '').trim();
          if (!trimmed) return null;
          try {
            return JSON.parse(trimmed);
          } catch {
            return null;
          }
        };

        const execOnce = async (target: string) =>
          client.request('/apps/appexec', {
            method: 'POST',
            body: { appname: target, cmd, env },
            allowMutation: true,
            responseType: 'text',
          });

        let target = appname;
        let res = await execOnce(target);
        let text = typeof res.data === 'string' ? res.data : JSON.stringify(res.data, null, 2);
        let parsed = typeof res.data === 'string' ? parseTextAsJson(res.data) : res.data;
        let knownError = parsed ? extractFluxErrorMessage(parsed) : null;
        let fluxOk = parsed ? isFluxSuccess(parsed) : null;

        let resolvedInfo: {
          baseUrl: string;
          host: string;
          apiPort: number;
          containerName: string;
          previousBaseUrl: string | null;
        } | null = null;

        if (knownError && knownError.startsWith('Container not found on this node.')) {
          const resolved = await resolveContainerOnCorrectNode({ client, appname, requireRunning: true });
          if (resolved) {
            client.setBaseUrl(resolved.baseUrl);
            target = resolved.containerName;
            resolvedInfo = {
              baseUrl: resolved.baseUrl,
              host: resolved.host,
              apiPort: resolved.apiPort,
              containerName: resolved.containerName,
              previousBaseUrl: attemptedBaseUrl,
            };

            res = await execOnce(target);
            text = typeof res.data === 'string' ? res.data : JSON.stringify(res.data, null, 2);
            parsed = typeof res.data === 'string' ? parseTextAsJson(res.data) : res.data;
            knownError = parsed ? extractFluxErrorMessage(parsed) : null;
            fluxOk = parsed ? isFluxSuccess(parsed) : null;
          }
        }

        const ok = res.ok && fluxOk !== false;

        const link = resourceStore.putText({
          kind: 'apps/appexec',
          name: `${appname} exec`,
          description: 'Raw /apps/appexec output',
          mimeType: 'text/plain',
          text,
        });

        const summary = {
          ok,
          status: res.status,
          appname,
          target,
          resolved: resolvedInfo,
          cmd,
          envCount: env.length,
          fluxOk,
          error: ok ? null : knownError,
          resourceUri: link.uri,
        };

        return {
          content: [
            { type: 'text', text: JSON.stringify(summary, null, 2) },
            { type: 'resource_link', ...link },
          ],
          structuredContent: summary,
          isError: !ok,
        };
      }

      case 'flux_apps_list_folder': {
        const appname = mustBeString(args['appname'], 'appname');
        const component = mustBeString(args['component'], 'component');
        const folder = asOptionalString(args['folder']) ?? '';

        const attemptedBaseUrl = client.getBaseUrl() ?? null;

        let res = await client.request('/apps/getfolderinfo', { query: { appname, component, folder } });
        let fluxOk = res.ok ? isFluxSuccess(res.data) : false;
        let knownError = extractFluxErrorMessage(res.data);

        let resolvedInfo: { baseUrl: string; host: string; apiPort: number; previousBaseUrl: string | null } | null = null;
        let failures: Array<{ baseUrl: string; error: string; hint?: FluxRequestErrorHint }> = [];
        let locationCandidates: Array<{ host: string; apiPort: number; baseUrl: string }> = [];
        let locationRaw: unknown = null;

        if (res.ok && !fluxOk && isVolumeNotFoundError(knownError)) {
          const located = await getLocationCandidates({ client, appname });
          locationCandidates = located.candidates;
          locationRaw = located.locations;

          if (located.ok && located.candidates.length > 0) {
            const attempt = await attemptOnCandidates(located.candidates, async (baseUrl) => {
              const tmp = new FluxClient({
                baseUrl,
                zelidauth: client.getZelidauthValueForBaseUrl(baseUrl) ?? undefined,
                enterpriseKey: client.getEnterpriseKeyValueForBaseUrl(baseUrl) ?? undefined,
              });
              tmp.setHttpDefaults(client.getHttpDefaults());

              const r = await tmp.request('/apps/getfolderinfo', { query: { appname, component, folder } });
              if (!r.ok || !isFluxSuccess(r.data)) {
                throw new Error(extractFluxErrorMessage(r.data) ?? 'getfolderinfo failed');
              }
              return r;
            });

            failures = attempt.failures;

            if (attempt.ok) {
              res = attempt.value;
              fluxOk = true;
              knownError = null;
              client.cacheZelidauthForBaseUrl(attempt.used.baseUrl, client.getZelidauthValueForBaseUrl(attempt.used.baseUrl));
              client.cacheEnterpriseKeyForBaseUrl(attempt.used.baseUrl, client.getEnterpriseKeyValueForBaseUrl(attempt.used.baseUrl));
              client.setBaseUrl(attempt.used.baseUrl);
              resolvedInfo = {
                baseUrl: attempt.used.baseUrl,
                host: attempt.used.host,
                apiPort: attempt.used.apiPort,
                previousBaseUrl: attemptedBaseUrl,
              };
            }
          }
        }

        const ok = res.ok && fluxOk;

        const payload = unwrapFluxEnvelope<unknown>(res.data);
        const items = Array.isArray(payload)
          ? payload.filter((x): x is Record<string, unknown> => !!x && typeof x === 'object' && !Array.isArray(x))
          : [];

        const formatTime = (value: unknown): string => {
          if (typeof value !== 'string' || !value.trim()) return '-';
          return value.length > 19 ? value.slice(0, 19).replace('T', ' ') : value;
        };

        const headers = ['Name', 'Type', 'Size (bytes)', 'Modified'];
        const rows = items.map((x) => {
          const name = typeof x['name'] === 'string' ? x['name'] : '-';
          const isDirectory = x['isDirectory'] === true;
          const isFile = x['isFile'] === true;
          const isSymbolicLink = x['isSymbolicLink'] === true;

          const type = isDirectory ? 'dir' : isFile ? 'file' : isSymbolicLink ? 'link' : '-';

          const sizeRaw = x['size'];
          const size = typeof sizeRaw === 'number' ? sizeRaw : Number(sizeRaw);

          const modifiedAt = formatTime(x['modifiedAt']);

          return [
            String(name),
            type,
            Number.isFinite(size) ? String(Math.trunc(size)) : '-',
            modifiedAt,
          ];
        });

        const link = resourceStore.putJson({
          kind: 'apps/getfolderinfo',
          name: `${appname} folder listing`,
          description: 'Raw /apps/getfolderinfo response',
          value: {
            request: { appname, component, folder },
            response: res,
            resolved: resolvedInfo,
            locationCandidates,
            locationRaw,
            failures,
          },
        });

        const summary = {
          ok,
          status: res.status,
          appname,
          component,
          folder,
          count: items.length,
          resolved: resolvedInfo,
          error: ok ? null : knownError,
          resourceUri: link.uri,
          nextActions: ok
            ? []
            : [
                ...(locationCandidates.length > 0
                  ? [{ tool: 'flux_set_base_url', arguments: { baseUrl: locationCandidates[0].baseUrl } }]
                  : []),
                { tool: 'flux_auth_flow', arguments: {} },
                { tool: 'flux_apps_resolve_runtime_target', arguments: { appname, requireRunning: false } },
              ],
        };

        if (!ok) {
          return {
            content: [{ type: 'text', text: JSON.stringify(summary, null, 2) }, { type: 'resource_link', ...link }],
            structuredContent: summary,
            isError: true,
          };
        }

        return buildTableResult({
          headers,
          rows,
          maxRows: 50,
          summary,
          resource: link,
        });
      }

      case 'flux_apps_download_file': {
        const appname = mustBeString(args['appname'], 'appname');
        const component = mustBeString(args['component'], 'component');
        const file = mustBeString(args['file'], 'file');
        const maxBytes = asOptionalNumber(args['maxBytes']);

        if (isSensitivePath(file)) {
          requireConfirm(args, `apps/downloadfile sensitive path: ${file}`);
        }

        const attemptedBaseUrl = client.getBaseUrl() ?? null;

        const downloadOnce = async (baseUrl: string | null): Promise<FluxRequestResult> => {
          if (baseUrl) {
            const tmp = new FluxClient({
              baseUrl,
              zelidauth: client.getZelidauthValueForBaseUrl(baseUrl) ?? undefined,
              enterpriseKey: client.getEnterpriseKeyValueForBaseUrl(baseUrl) ?? undefined,
            });
            tmp.setHttpDefaults(client.getHttpDefaults());
            return tmp.request('/apps/downloadfile', { query: { appname, component, file }, responseType: 'base64', maxBytes });
          }
          return client.request('/apps/downloadfile', { query: { appname, component, file }, responseType: 'base64', maxBytes });
        };

        let res = await downloadOnce(null);
        let blob = res.data && typeof res.data === 'object' && !Array.isArray(res.data) ? (res.data as Record<string, unknown>) : null;
        let parsedError = blob ? parseFluxErrorFromBase64Download(blob) : null;
        let knownError = parsedError?.error ?? (res.ok ? null : String(res.data));

        let resolvedInfo: { baseUrl: string; host: string; apiPort: number; previousBaseUrl: string | null } | null = null;
        let failures: Array<{ baseUrl: string; error: string; hint?: FluxRequestErrorHint }> = [];
        let locationCandidates: Array<{ host: string; apiPort: number; baseUrl: string }> = [];
        let locationRaw: unknown = null;

        if (parsedError && isVolumeNotFoundError(parsedError.error)) {
          const located = await getLocationCandidates({ client, appname });
          locationCandidates = located.candidates;
          locationRaw = located.locations;

          if (located.ok && located.candidates.length > 0) {
            const attempt = await attemptOnCandidates(located.candidates, async (baseUrl) => {
              const r = await downloadOnce(baseUrl);
              const b = r.data && typeof r.data === 'object' && !Array.isArray(r.data) ? (r.data as Record<string, unknown>) : null;
              const err = b ? parseFluxErrorFromBase64Download(b) : null;
              if (!r.ok) throw new Error(`downloadfile failed: http ${r.status}`);
              if (err) throw new Error(err.error ?? 'downloadfile returned an error envelope');
              return r;
            });

            failures = attempt.failures;

            if (attempt.ok) {
              res = attempt.value;
              blob = res.data && typeof res.data === 'object' && !Array.isArray(res.data) ? (res.data as Record<string, unknown>) : null;
              parsedError = blob ? parseFluxErrorFromBase64Download(blob) : null;
              knownError = parsedError?.error ?? null;
              client.cacheZelidauthForBaseUrl(attempt.used.baseUrl, client.getZelidauthValueForBaseUrl(attempt.used.baseUrl));
              client.cacheEnterpriseKeyForBaseUrl(attempt.used.baseUrl, client.getEnterpriseKeyValueForBaseUrl(attempt.used.baseUrl));
              client.setBaseUrl(attempt.used.baseUrl);
              resolvedInfo = {
                baseUrl: attempt.used.baseUrl,
                host: attempt.used.host,
                apiPort: attempt.used.apiPort,
                previousBaseUrl: attemptedBaseUrl,
              };
            }
          }
        }

        if (!res.ok || parsedError) {
          const link = resourceStore.putJson({
            kind: 'apps/downloadfile_error',
            name: `${appname}/${component}/${file} download error`,
            description: 'Error response from /apps/downloadfile',
            value: {
              request: { appname, component, file, maxBytes: maxBytes ?? null },
              response: res,
              parsedError: parsedError?.parsed ?? null,
              resolved: resolvedInfo,
              locationCandidates,
              locationRaw,
              failures,
            },
          });

          const out = {
            ok: false,
            status: res.status,
            appname,
            component,
            file,
            resolved: resolvedInfo,
            error: knownError ?? (res.ok ? 'downloadfile returned an error envelope' : String(res.data)),
            resourceUri: link.uri,
          };

          return {
            content: [{ type: 'text', text: JSON.stringify(out, null, 2) }, { type: 'resource_link', ...link }],
            structuredContent: out,
            isError: true,
          };
        }

        const base64 = blob && typeof blob.base64 === 'string' ? blob.base64 : null;
        const bytes = blob && typeof blob.bytes === 'number' ? blob.bytes : null;
        const contentType = blob && typeof blob.contentType === 'string' ? blob.contentType : 'application/octet-stream';

        const link = resourceStore.putText({
          kind: 'apps/downloadfile',
          name: `${appname}/${component}/${file}`,
          description: 'Downloaded file (base64)',
          mimeType: contentType,
          text: base64 ?? '',
        });

        const out = {
          ok: true,
          status: res.status,
          appname,
          component,
          file,
          bytes,
          mimeType: contentType,
          resolved: resolvedInfo,
          resourceUri: link.uri,
        };

        return {
          content: [{ type: 'text', text: JSON.stringify(out, null, 2) }, { type: 'resource_link', ...link }],
          structuredContent: out,
          isError: false,
        };
      }

      case 'flux_apps_download_folder': {
        requireConfirm(args, 'apps/downloadfolder');
        const appname = mustBeString(args['appname'], 'appname');
        const component = mustBeString(args['component'], 'component');
        const folder = mustBeString(args['folder'], 'folder');
        const maxBytes = asOptionalNumber(args['maxBytes']);

        const attemptedBaseUrl = client.getBaseUrl() ?? null;

        const downloadOnce = async (baseUrl: string | null): Promise<FluxRequestResult> => {
          if (baseUrl) {
            const tmp = new FluxClient({
              baseUrl,
              zelidauth: client.getZelidauthValueForBaseUrl(baseUrl) ?? undefined,
              enterpriseKey: client.getEnterpriseKeyValueForBaseUrl(baseUrl) ?? undefined,
            });
            tmp.setHttpDefaults(client.getHttpDefaults());
            return tmp.request('/apps/downloadfolder', { query: { appname, component, folder }, responseType: 'base64', maxBytes });
          }
          return client.request('/apps/downloadfolder', { query: { appname, component, folder }, responseType: 'base64', maxBytes });
        };

        let res = await downloadOnce(null);
        let blob = res.data && typeof res.data === 'object' && !Array.isArray(res.data) ? (res.data as Record<string, unknown>) : null;
        let parsedError = blob ? parseFluxErrorFromBase64Download(blob) : null;
        let knownError = parsedError?.error ?? (res.ok ? null : String(res.data));

        let resolvedInfo: { baseUrl: string; host: string; apiPort: number; previousBaseUrl: string | null } | null = null;
        let failures: Array<{ baseUrl: string; error: string; hint?: FluxRequestErrorHint }> = [];
        let locationCandidates: Array<{ host: string; apiPort: number; baseUrl: string }> = [];
        let locationRaw: unknown = null;

        if (parsedError && isVolumeNotFoundError(parsedError.error)) {
          const located = await getLocationCandidates({ client, appname });
          locationCandidates = located.candidates;
          locationRaw = located.locations;

          if (located.ok && located.candidates.length > 0) {
            const attempt = await attemptOnCandidates(located.candidates, async (baseUrl) => {
              const r = await downloadOnce(baseUrl);
              const b = r.data && typeof r.data === 'object' && !Array.isArray(r.data) ? (r.data as Record<string, unknown>) : null;
              const err = b ? parseFluxErrorFromBase64Download(b) : null;
              if (!r.ok) throw new Error(`downloadfolder failed: http ${r.status}`);
              if (err) throw new Error(err.error ?? 'downloadfolder returned an error envelope');
              return r;
            });

            failures = attempt.failures;

            if (attempt.ok) {
              res = attempt.value;
              blob = res.data && typeof res.data === 'object' && !Array.isArray(res.data) ? (res.data as Record<string, unknown>) : null;
              parsedError = blob ? parseFluxErrorFromBase64Download(blob) : null;
              knownError = parsedError?.error ?? null;
              client.cacheZelidauthForBaseUrl(attempt.used.baseUrl, client.getZelidauthValueForBaseUrl(attempt.used.baseUrl));
              client.cacheEnterpriseKeyForBaseUrl(attempt.used.baseUrl, client.getEnterpriseKeyValueForBaseUrl(attempt.used.baseUrl));
              client.setBaseUrl(attempt.used.baseUrl);
              resolvedInfo = {
                baseUrl: attempt.used.baseUrl,
                host: attempt.used.host,
                apiPort: attempt.used.apiPort,
                previousBaseUrl: attemptedBaseUrl,
              };
            }
          }
        }

        if (!res.ok || parsedError) {
          const link = resourceStore.putJson({
            kind: 'apps/downloadfolder_error',
            name: `${appname}/${component}/${folder} download error`,
            description: 'Error response from /apps/downloadfolder',
            value: {
              request: { appname, component, folder, maxBytes: maxBytes ?? null },
              response: res,
              parsedError: parsedError?.parsed ?? null,
              resolved: resolvedInfo,
              locationCandidates,
              locationRaw,
              failures,
            },
          });

          const out = {
            ok: false,
            status: res.status,
            appname,
            component,
            folder,
            resolved: resolvedInfo,
            error: knownError ?? (res.ok ? 'downloadfolder returned an error envelope' : String(res.data)),
            resourceUri: link.uri,
          };

          return {
            content: [{ type: 'text', text: JSON.stringify(out, null, 2) }, { type: 'resource_link', ...link }],
            structuredContent: out,
            isError: true,
          };
        }

        const base64 = blob && typeof blob.base64 === 'string' ? blob.base64 : null;
        const bytes = blob && typeof blob.bytes === 'number' ? blob.bytes : null;
        const contentType = blob && typeof blob.contentType === 'string' ? blob.contentType : 'application/zip';

        const link = resourceStore.putText({
          kind: 'apps/downloadfolder',
          name: `${appname}/${component}/${folder}.zip`,
          description: 'Downloaded folder zip (base64)',
          mimeType: contentType,
          text: base64 ?? '',
        });

        const out = {
          ok: true,
          status: res.status,
          appname,
          component,
          folder,
          bytes,
          mimeType: contentType,
          resolved: resolvedInfo,
          resourceUri: link.uri,
        };

        return {
          content: [{ type: 'text', text: JSON.stringify(out, null, 2) }, { type: 'resource_link', ...link }],
          structuredContent: out,
          isError: false,
        };
      }

      case 'flux_apps_create_folder': {
        requireConfirm(args, 'apps/createfolder');
        const appname = mustBeString(args['appname'], 'appname');
        const component = mustBeString(args['component'], 'component');
        const folder = mustBeString(args['folder'], 'folder');

        const attemptedBaseUrl = client.getBaseUrl() ?? null;

        let res = await client.request('/apps/createfolder', {
          method: 'GET',
          query: { appname, component, folder },
          allowMutation: true,
        });

        let fluxOk = res.ok ? isFluxSuccess(res.data) : false;
        let knownError = extractFluxErrorMessage(res.data);

        let resolvedInfo: { baseUrl: string; host: string; apiPort: number; previousBaseUrl: string | null } | null = null;
        let failures: Array<{ baseUrl: string; error: string; hint?: FluxRequestErrorHint }> = [];
        let locationCandidates: Array<{ host: string; apiPort: number; baseUrl: string }> = [];
        let locationRaw: unknown = null;

        if (res.ok && !fluxOk && isVolumeNotFoundError(knownError)) {
          const located = await getLocationCandidates({ client, appname });
          locationCandidates = located.candidates;
          locationRaw = located.locations;

          if (located.ok && located.candidates.length > 0) {
            const attempt = await attemptOnCandidates(located.candidates, async (baseUrl) => {
              const tmp = new FluxClient({
                baseUrl,
                zelidauth: client.getZelidauthValueForBaseUrl(baseUrl) ?? undefined,
                enterpriseKey: client.getEnterpriseKeyValueForBaseUrl(baseUrl) ?? undefined,
              });
              tmp.setHttpDefaults(client.getHttpDefaults());

              const r = await tmp.request('/apps/createfolder', { method: 'GET', query: { appname, component, folder }, allowMutation: true });
              if (!r.ok || !isFluxSuccess(r.data)) {
                throw new Error(extractFluxErrorMessage(r.data) ?? 'createfolder failed');
              }
              return r;
            });

            failures = attempt.failures;

            if (attempt.ok) {
              res = attempt.value;
              fluxOk = true;
              knownError = null;
              client.cacheZelidauthForBaseUrl(attempt.used.baseUrl, client.getZelidauthValueForBaseUrl(attempt.used.baseUrl));
              client.cacheEnterpriseKeyForBaseUrl(attempt.used.baseUrl, client.getEnterpriseKeyValueForBaseUrl(attempt.used.baseUrl));
              client.setBaseUrl(attempt.used.baseUrl);
              resolvedInfo = {
                baseUrl: attempt.used.baseUrl,
                host: attempt.used.host,
                apiPort: attempt.used.apiPort,
                previousBaseUrl: attemptedBaseUrl,
              };
            }
          }
        }

        const ok = res.ok && fluxOk;

        const link = resourceStore.putJson({
          kind: 'apps/createfolder',
          name: `${appname} create folder`,
          description: 'Raw /apps/createfolder response',
          value: {
            request: { appname, component, folder },
            response: res,
            resolved: resolvedInfo,
            locationCandidates,
            locationRaw,
            failures,
          },
        });

        const out = {
          ok,
          status: res.status,
          appname,
          component,
          folder,
          resolved: resolvedInfo,
          error: ok ? null : knownError,
          resourceUri: link.uri,
        };

        return {
          content: [{ type: 'text', text: JSON.stringify(out, null, 2) }, { type: 'resource_link', ...link }],
          structuredContent: out,
          isError: !ok,
        };
      }

      case 'flux_apps_rename_object': {
        requireConfirm(args, 'apps/renameobject');
        const appname = mustBeString(args['appname'], 'appname');
        const component = mustBeString(args['component'], 'component');
        const oldpath = mustBeString(args['oldpath'], 'oldpath');
        const newname = mustBeString(args['newname'], 'newname');

        const attemptedBaseUrl = client.getBaseUrl() ?? null;

        let res = await client.request('/apps/renameobject', {
          method: 'GET',
          query: { appname, component, oldpath, newname },
          allowMutation: true,
        });

        let fluxOk = res.ok ? isFluxSuccess(res.data) : false;
        let knownError = extractFluxErrorMessage(res.data);

        let resolvedInfo: { baseUrl: string; host: string; apiPort: number; previousBaseUrl: string | null } | null = null;
        let failures: Array<{ baseUrl: string; error: string; hint?: FluxRequestErrorHint }> = [];
        let locationCandidates: Array<{ host: string; apiPort: number; baseUrl: string }> = [];
        let locationRaw: unknown = null;

        if (res.ok && !fluxOk && isVolumeNotFoundError(knownError)) {
          const located = await getLocationCandidates({ client, appname });
          locationCandidates = located.candidates;
          locationRaw = located.locations;

          if (located.ok && located.candidates.length > 0) {
            const attempt = await attemptOnCandidates(located.candidates, async (baseUrl) => {
              const tmp = new FluxClient({
                baseUrl,
                zelidauth: client.getZelidauthValueForBaseUrl(baseUrl) ?? undefined,
                enterpriseKey: client.getEnterpriseKeyValueForBaseUrl(baseUrl) ?? undefined,
              });
              tmp.setHttpDefaults(client.getHttpDefaults());

              const r = await tmp.request('/apps/renameobject', { method: 'GET', query: { appname, component, oldpath, newname }, allowMutation: true });
              if (!r.ok || !isFluxSuccess(r.data)) {
                throw new Error(extractFluxErrorMessage(r.data) ?? 'renameobject failed');
              }
              return r;
            });

            failures = attempt.failures;

            if (attempt.ok) {
              res = attempt.value;
              fluxOk = true;
              knownError = null;
              client.cacheZelidauthForBaseUrl(attempt.used.baseUrl, client.getZelidauthValueForBaseUrl(attempt.used.baseUrl));
              client.cacheEnterpriseKeyForBaseUrl(attempt.used.baseUrl, client.getEnterpriseKeyValueForBaseUrl(attempt.used.baseUrl));
              client.setBaseUrl(attempt.used.baseUrl);
              resolvedInfo = {
                baseUrl: attempt.used.baseUrl,
                host: attempt.used.host,
                apiPort: attempt.used.apiPort,
                previousBaseUrl: attemptedBaseUrl,
              };
            }
          }
        }

        const ok = res.ok && fluxOk;

        const link = resourceStore.putJson({
          kind: 'apps/renameobject',
          name: `${appname} rename object`,
          description: 'Raw /apps/renameobject response',
          value: {
            request: { appname, component, oldpath, newname },
            response: res,
            resolved: resolvedInfo,
            locationCandidates,
            locationRaw,
            failures,
          },
        });

        const out = {
          ok,
          status: res.status,
          appname,
          component,
          oldpath,
          newname,
          resolved: resolvedInfo,
          error: ok ? null : knownError,
          resourceUri: link.uri,
        };

        return {
          content: [{ type: 'text', text: JSON.stringify(out, null, 2) }, { type: 'resource_link', ...link }],
          structuredContent: out,
          isError: !ok,
        };
      }

      case 'flux_apps_remove_object': {
        requireConfirm(args, 'apps/removeobject');
        const appname = mustBeString(args['appname'], 'appname');
        const component = mustBeString(args['component'], 'component');
        const object = mustBeString(args['object'], 'object');

        const attemptedBaseUrl = client.getBaseUrl() ?? null;

        let res = await client.request('/apps/removeobject', {
          method: 'GET',
          query: { appname, component, object },
          allowMutation: true,
        });

        let fluxOk = res.ok ? isFluxSuccess(res.data) : false;
        let knownError = extractFluxErrorMessage(res.data);

        let resolvedInfo: { baseUrl: string; host: string; apiPort: number; previousBaseUrl: string | null } | null = null;
        let failures: Array<{ baseUrl: string; error: string; hint?: FluxRequestErrorHint }> = [];
        let locationCandidates: Array<{ host: string; apiPort: number; baseUrl: string }> = [];
        let locationRaw: unknown = null;

        if (res.ok && !fluxOk && isVolumeNotFoundError(knownError)) {
          const located = await getLocationCandidates({ client, appname });
          locationCandidates = located.candidates;
          locationRaw = located.locations;

          if (located.ok && located.candidates.length > 0) {
            const attempt = await attemptOnCandidates(located.candidates, async (baseUrl) => {
              const tmp = new FluxClient({
                baseUrl,
                zelidauth: client.getZelidauthValueForBaseUrl(baseUrl) ?? undefined,
                enterpriseKey: client.getEnterpriseKeyValueForBaseUrl(baseUrl) ?? undefined,
              });
              tmp.setHttpDefaults(client.getHttpDefaults());

              const r = await tmp.request('/apps/removeobject', { method: 'GET', query: { appname, component, object }, allowMutation: true });
              if (!r.ok || !isFluxSuccess(r.data)) {
                throw new Error(extractFluxErrorMessage(r.data) ?? 'removeobject failed');
              }
              return r;
            });

            failures = attempt.failures;

            if (attempt.ok) {
              res = attempt.value;
              fluxOk = true;
              knownError = null;
              client.cacheZelidauthForBaseUrl(attempt.used.baseUrl, client.getZelidauthValueForBaseUrl(attempt.used.baseUrl));
              client.cacheEnterpriseKeyForBaseUrl(attempt.used.baseUrl, client.getEnterpriseKeyValueForBaseUrl(attempt.used.baseUrl));
              client.setBaseUrl(attempt.used.baseUrl);
              resolvedInfo = {
                baseUrl: attempt.used.baseUrl,
                host: attempt.used.host,
                apiPort: attempt.used.apiPort,
                previousBaseUrl: attemptedBaseUrl,
              };
            }
          }
        }

        const ok = res.ok && fluxOk;

        const link = resourceStore.putJson({
          kind: 'apps/removeobject',
          name: `${appname} remove object`,
          description: 'Raw /apps/removeobject response',
          value: {
            request: { appname, component, object },
            response: res,
            resolved: resolvedInfo,
            locationCandidates,
            locationRaw,
            failures,
          },
        });

        const out = {
          ok,
          status: res.status,
          appname,
          component,
          object,
          resolved: resolvedInfo,
          error: ok ? null : knownError,
          resourceUri: link.uri,
        };

        return {
          content: [{ type: 'text', text: JSON.stringify(out, null, 2) }, { type: 'resource_link', ...link }],
          structuredContent: out,
          isError: !ok,
        };
      }

      case 'flux_syncthing_metrics': {
        const res = await client.request('/syncthing/metrics');
        const link = resourceStore.putJson({
          kind: 'syncthing/metrics',
          name: 'Syncthing metrics',
          description: 'Raw /syncthing/metrics response',
          value: res,
        });
        const ok = isFluxEnvelopeOk(res);
        const summary = { ok, status: res.status, resourceUri: link.uri };
        return {
          content: [{ type: 'text', text: JSON.stringify(summary, null, 2) }, { type: 'resource_link', ...link }],
          structuredContent: summary,
          isError: !ok,
        };
      }

      case 'flux_syncthing_metrics_health': {
        const res = await client.request('/syncthing/metrics/health');
        const link = resourceStore.putJson({
          kind: 'syncthing/metrics/health',
          name: 'Syncthing metrics health',
          description: 'Raw /syncthing/metrics/health response',
          value: res,
        });

        const data = unwrapFluxEnvelope<unknown>(res.data);
        const obj = data && typeof data === 'object' && !Array.isArray(data) ? (data as Record<string, unknown>) : {};
        const okValue = obj['ok'];
        const messageValue = obj['message'];

        const headers = ['OK', 'Message'];
        const rows = [[String(okValue ?? '-'), typeof messageValue === 'string' ? messageValue : '-']];
        const summary = { ok: isFluxEnvelopeOk(res), status: res.status };
        return buildTableResult({
          headers,
          rows,
          maxRows: 1,
          summary,
          resource: link,
        });
      }

      case 'flux_syncthing_system_status': {
        const res = await client.request('/syncthing/system/status');
        const link = resourceStore.putJson({
          kind: 'syncthing/system/status',
          name: 'Syncthing system status',
          description: 'Raw /syncthing/system/status response',
          value: res,
        });
        const ok = isFluxEnvelopeOk(res);
        const summary = { ok, status: res.status, resourceUri: link.uri };
        return {
          content: [{ type: 'text', text: JSON.stringify(summary, null, 2) }, { type: 'resource_link', ...link }],
          structuredContent: summary,
          isError: !ok,
        };
      }

      case 'flux_syncthing_list_folders': {
        const res = await client.request('/syncthing/config/folders');
        const link = resourceStore.putJson({
          kind: 'syncthing/config/folders',
          name: 'Syncthing folders',
          description: 'Raw /syncthing/config/folders response',
          value: res,
        });

        const data = unwrapFluxEnvelope<unknown>(res.data);
        const folders = Array.isArray(data)
          ? data.filter((x): x is Record<string, unknown> => !!x && typeof x === 'object' && !Array.isArray(x))
          : [];

        const headers = ['ID', 'Label', 'Path', 'Type', 'Rescan'];
        const rows = folders.map((f) => {
          const id = typeof f.id === 'string' ? f.id : '-';
          const label = typeof f.label === 'string' ? f.label : '-';
          const p = typeof f.path === 'string' ? f.path : '-';
          const type = typeof f.type === 'string' ? f.type : '-';
          const rescan = typeof f.rescanIntervalS === 'number'
            ? String(f.rescanIntervalS)
            : typeof f.rescanIntervalS === 'string'
              ? f.rescanIntervalS
              : '-';
          return [id, label, p, type, rescan];
        });
        const summary = { ok: isFluxEnvelopeOk(res), status: res.status, count: folders.length };
        return buildTableResult({
          headers,
          rows,
          maxRows: 100,
          summary,
          resource: link,
        });
      }

      case 'flux_syncthing_list_devices': {
        const res = await client.request('/syncthing/config/devices');
        const link = resourceStore.putJson({
          kind: 'syncthing/config/devices',
          name: 'Syncthing devices',
          description: 'Raw /syncthing/config/devices response',
          value: res,
        });

        const data = unwrapFluxEnvelope<unknown>(res.data);
        const devices = Array.isArray(data)
          ? data.filter((x): x is Record<string, unknown> => !!x && typeof x === 'object' && !Array.isArray(x))
          : [];

        const headers = ['Name', 'DeviceID', 'Addresses', 'Introducer', 'Paused'];
        const rows = devices.map((d) => {
          const name = typeof d.name === 'string' ? d.name : '-';
          const deviceID = typeof d.deviceID === 'string' ? d.deviceID : '-';
          const addresses = Array.isArray(d.addresses)
            ? d.addresses.filter((x): x is string => typeof x === 'string').join(', ')
            : '-';
          const introducer = d.introducer === true ? 'yes' : 'no';
          const paused = d.paused === true ? 'yes' : 'no';
          return [name, deviceID, addresses, introducer, paused];
        });
        const summary = { ok: isFluxEnvelopeOk(res), status: res.status, count: devices.length };
        return buildTableResult({
          headers,
          rows,
          maxRows: 100,
          summary,
          resource: link,
        });
      }

      case 'flux_syncthing_db_browse': {
        const folder = mustBeString(args['folder'], 'folder');
        const levels = asOptionalNumber(args['levels']);
        const prefix = asOptionalString(args['prefix']);

        const res = await client.request(`/syncthing/db/browse/${encodeURIComponent(folder)}`, {
          query: { levels, prefix },
        });

        const link = resourceStore.putJson({
          kind: 'syncthing/db/browse',
          name: `Syncthing browse ${folder}`,
          description: 'Raw /syncthing/db/browse response',
          value: res,
        });

        const summary = {
          ok: isFluxEnvelopeOk(res),
          status: res.status,
          folder,
          levels: levels ?? null,
          prefix: prefix ?? null,
          resourceUri: link.uri,
        };

        return {
          content: [
            { type: 'text', text: JSON.stringify(summary, null, 2) },
            { type: 'resource_link', ...link },
          ],
          structuredContent: summary,
          isError: summary.ok !== true,
        };
      }

      case 'flux_syncthing_db_scan': {
        requireConfirm(args, 'syncthing/db/scan');
        const folder = mustBeString(args['folder'], 'folder');
        const sub = asOptionalString(args['sub']);

        return jsonResult(
          await client.request('/syncthing/db/scan', {
            method: 'POST',
            body: { folder, sub },
            allowMutation: true,
          })
        );
      }

      case 'flux_syncthing_restart': {
        requireConfirm(args, 'syncthing/system/restart');
        return jsonResult(await client.request('/syncthing/system/restart', { allowMutation: true }));
      }

      default: {
        const out = { error: `Unknown tool: ${name}` };
        return jsonResult(out, { isError: true, structuredContent: out });
      }
    }
  } catch (err: unknown) {
    let hint =
      name === 'flux_request'
        ? 'For mutating endpoints, retry with allowMutation=true. For safer workflows, prefer dedicated flux_apps_* tools that require confirm=true.'
        : undefined;

    if (err instanceof Error && err.name === 'AbortError') {
      hint = hint
        ? `${hint} Also: request timed out; increase timeoutMs (or set flux_set_http_defaults.timeoutMs).`
        : 'Request timed out; increase timeoutMs (or set flux_set_http_defaults.timeoutMs).';
    }

    return errorResult(err, { tool: name, hint });
  }
}

const server = new Server(
  { name: 'flux-mcp', version: '0.4.0' },
  { capabilities: { tools: {}, resources: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools }));

server.setRequestHandler(ListResourcesRequestSchema, async () => {
  const staticResources = [
    {
      uri: 'flux://inventory/endpoints',
      name: 'Flux endpoints inventory',
      description: 'Bundled endpoints inventory (generated from Flux routes.js)',
      mimeType: 'application/json',
    },
  ];

  return {
    resources: [...staticResources, ...resourceStore.list()],
  };
});

server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
  const { uri } = request.params;

  if (uri === 'flux://inventory/endpoints') {
    return {
      contents: [
        {
          uri,
          mimeType: 'application/json',
          text: JSON.stringify(inventory?.routes ?? [], null, 2),
        },
      ],
    };
  }

  const found = resourceStore.read(uri);
  if (found) return { contents: [found] };

  throw new Error(`Resource not found: ${uri}`);
});

server.setRequestHandler(CallToolRequestSchema, async (request: CallToolRequest) => {
  const { name, arguments: rawArgs } = request.params;
  return callTool(name, rawArgs);
});

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

function isDirectInvocation(): boolean {
  const argv1 = process.argv[1];
  if (!argv1) return false;
  try {
    return path.resolve(argv1) === path.resolve(__filename);
  } catch {
    return false;
  }
}

if (isDirectInvocation()) {
  main().catch((err) => {
    const message = err instanceof Error ? err.message : String(err);
    process.stderr.write(`flux-mcp failed to start: ${message}\n`);
    process.exit(1);
  });
}
