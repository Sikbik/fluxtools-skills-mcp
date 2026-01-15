#!/usr/bin/env node

import path from 'node:path';
import { fileURLToPath } from 'node:url';

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
import { isFluxSuccess, unwrapFluxEnvelope } from './fluxEnvelope.js';

type CallToolRequest = { params: { name: string; arguments?: unknown } };

type FluxRequestResult = Awaited<ReturnType<FluxClient['request']>>;

function mustBeString(value: unknown, name: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${name} must be a non-empty string`);
  return value;
}

function asOptionalString(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
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

function buildMessageToSign(opts: {
  type: 'fluxappregister' | 'fluxappupdate' | 'zelappregister' | 'zelappupdate';
  version: number;
  spec: Record<string, unknown>;
  timestamp: number;
}): string {
  const specJson = JSON.stringify(opts.spec);
  return `${opts.type}${opts.version}${specJson}${opts.timestamp}`;
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

async function pollMessagePropagation(opts: {
  hash: string;
  attempts: number;
  intervalMs: number;
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
      client.request(`/apps/temporarymessages/${encodeURIComponent(opts.hash)}`),
      client.request(`/apps/permanentmessages/${encodeURIComponent(opts.hash)}`),
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

const client = new FluxClient({
  baseUrl: process.env.FLUX_API_BASE_URL,
  zelidauth: process.env.FLUX_ZELIDAUTH,
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
    name: 'flux_clear_zelidauth',
    description: 'Clear the stored zelidauth header value for this MCP session.',
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
        secondsPerBlock: { type: 'number', description: 'Override seconds per block (default 120)' },
      },
    },
  },
  {
    name: 'flux_explorer_status',
    description: 'Table-first explorer status summary (sync, height, key signals).',
    inputSchema: {
      type: 'object',
      properties: {
        secondsPerBlock: { type: 'number', description: 'Override seconds per block (default 120)' },
      },
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
        secondsPerBlock: { type: 'number', description: 'Optional override used when estimateTimeRemaining is true (default 120).' },
        limit: { type: 'number', description: 'Max rows in the table preview (default 50, max 200).', minimum: 1, maximum: 200, default: 50 },
      },
    },
  },
  {
    name: 'flux_apps_get_spec',
    description: 'Fetch app specification (GET /apps/appspecifications/<appname>).',
    inputSchema: {
      type: 'object',
      properties: {
        appname: { type: 'string', description: 'Flux app name' },
        decrypt: { type: 'boolean', description: 'Optional decrypt flag for enterprise specs' },
      },
      required: ['appname'],
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
    description: 'Verify spec + calculate price + build message-to-sign + payload scaffold for app registration.',
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
    description: 'Verify update spec + calculate price + build message-to-sign + payload scaffold for app update.',
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
     name: 'flux_apps_register_and_verify',
     description: 'Submit app registration and poll for message propagation to permanent messages.',
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
         verifyGlobal: { type: 'boolean', description: 'If true, also verify /apps/globalappsspecifications contains the app', default: true },
         confirm: { type: 'boolean', description: 'Required to submit registration' },
       },
       required: ['spec', 'signature', 'timestamp', 'confirm'],
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
         verifyGlobal: { type: 'boolean', description: 'If true, also verify /apps/globalappsspecifications contains the app', default: true },
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
        force: { type: 'boolean' },
        confirm: { type: 'boolean' },
      },
      required: ['appname', 'component', 'confirm'],
    },
  },

  // App observability
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
    description: 'Download a file from an app volume (GET /apps/downloadfile) as base64.',
    inputSchema: {
      type: 'object',
      properties: {
        appname: { type: 'string' },
        component: { type: 'string' },
        file: { type: 'string', description: 'Relative file path' },
        maxBytes: { type: 'number', description: 'Max bytes to download (default 1048576)' },
      },
      required: ['appname', 'component', 'file'],
    },
  },
  {
    name: 'flux_apps_download_folder',
    description: 'Download a folder from an app volume (GET /apps/downloadfolder) as a zipped base64 blob.',
    inputSchema: {
      type: 'object',
      properties: {
        appname: { type: 'string' },
        component: { type: 'string' },
        folder: { type: 'string', description: 'Relative folder path' },
        maxBytes: { type: 'number', description: 'Max bytes to download (default 1048576)' },
      },
      required: ['appname', 'component', 'folder'],
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
          httpDefaults: client.getHttpDefaults(),
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

      case 'flux_auth_flow': {
        const useEmergencyPhrase = asOptionalBoolean(args['useEmergencyPhrase']) ?? false;
        const gatewayBaseUrl = asOptionalString(args['gatewayBaseUrl']);

        const steps: Array<{ tool: string; arguments?: unknown; note: string }> = [];

        if (gatewayBaseUrl) {
          steps.push({
            tool: 'flux_set_base_url',
            arguments: { baseUrl: gatewayBaseUrl },
            note: 'Use the public gateway as a starting point.',
          });
          steps.push({
            tool: 'flux_resolve_gateway_node',
            arguments: { gatewayBaseUrl },
            note: 'Resolve the node behind the gateway and switch to its direct base URL for login.',
          });
          steps.push({
            tool: 'flux_set_base_url',
            arguments: { baseUrl: 'http://<resolved-node-ip>:16127' },
            note: 'Set baseUrl to the recommended direct node URL from flux_resolve_gateway_node.',
          });
        } else {
          steps.push({
            tool: 'flux_set_base_url',
            arguments: { baseUrl: 'http://<node-ip>:16127' },
            note: 'Set your node API base URL for this session.',
          });
        }

        const phraseTool = useEmergencyPhrase ? 'flux_get_emergency_phrase' : 'flux_get_login_phrase';
        steps.push({ tool: phraseTool, arguments: {}, note: 'Fetch a login phrase to sign with your ZelID.' });
        steps.push({
          tool: 'USER_ACTION',
          note: 'Sign the returned login phrase with your ZelID wallet/tooling to produce a signature.',
        });
        steps.push({
          tool: 'flux_verify_login',
          arguments: { zelid: '<ZELID>', signature: '<SIGNATURE>', loginPhrase: '<PHRASE>' },
          note: 'Establish a session on the node (recommended).',
        });
        steps.push({
          tool: 'flux_build_zelidauth',
          arguments: { zelid: '<ZELID>', signature: '<SIGNATURE>', loginPhrase: '<PHRASE>' },
          note: 'Build the zelidauth header JSON value.',
        });
        steps.push({
          tool: 'flux_set_zelidauth',
          arguments: { zelidauth: { zelid: '<ZELID>', signature: '<SIGNATURE>', loginPhrase: '<PHRASE>' } },
          note: 'Store zelidauth for subsequent calls.',
        });
        steps.push({
          tool: 'flux_check_privilege',
          arguments: { zelid: '<ZELID>', signature: '<SIGNATURE>', loginPhrase: '<PHRASE>' },
          note: 'Confirm your privilege level (admin/fluxteam/appownerabove).',
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

        const res = await client.request(path);
        if (!res.ok) {
          const out = { ok: false, appname, error: res.data };
          return jsonResult(out, { isError: true, structuredContent: out });
        }

        const payload = unwrapFluxEnvelope<unknown>(res.data);
        const obj = payload && typeof payload === 'object' && !Array.isArray(payload) ? (payload as Record<string, unknown>) : undefined;
        const logsValue = obj?.logs ?? obj?.data ?? payload;

        let text = '';
        if (typeof logsValue === 'string') text = logsValue;
        else if (Array.isArray(logsValue) && logsValue.every((x) => typeof x === 'string')) text = (logsValue as string[]).join('\n');
        else text = JSON.stringify(payload, null, 2);

        let truncated = false;
        if (Buffer.byteLength(text, 'utf8') > maxBytes) {
          truncated = true;
          const buffer = Buffer.from(text, 'utf8');
          text = buffer.subarray(buffer.length - maxBytes).toString('utf8');
        }

        const linesOut = text.split(/\r?\n/).filter((l) => l.length);

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

        const logsText = linesOut.join('\n');
        const link = resourceStore.putText({
          kind: 'logs',
          name: `${appname} logs`,
          description: 'Full log payload from flux_logs_tail',
          mimeType: 'text/plain',
          text: logsText,
        });

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                ok: true,
                appname,
                truncated,
                lineCount: linesOut.length,
                next: full.next,
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
          structuredContent: { ...full, resourceUri: link.uri },
          isError: false,
        };
      }

      case 'flux_app_health_report': {
        const appname = mustBeString(args['appname'], 'appname');
        const logsLinesRaw = asOptionalNumber(args['logsLines']);
        const logsLinesValue = logsLinesRaw === undefined ? 100 : Math.floor(logsLinesRaw);
        const logsLines = Math.min(300, Math.max(1, logsLinesValue));

        const monitorRangeRaw = asOptionalNumber(args['monitorRangeMs']);
        const monitorRangeValue = monitorRangeRaw === undefined ? 10 * 60 * 1000 : Math.floor(monitorRangeRaw);
        const monitorRangeMs = Math.min(24 * 60 * 60 * 1000, Math.max(1000, monitorRangeValue));

        const [inspect, stats, top, monitor, logs] = await Promise.all([
          client.request(`/apps/appinspect/${encodeURIComponent(appname)}`),
          client.request(`/apps/appstats/${encodeURIComponent(appname)}`),
          client.request(`/apps/apptop/${encodeURIComponent(appname)}`),
          client.request(`/apps/appmonitor/${encodeURIComponent(appname)}/${monitorRangeMs}`),
          client.request(`/apps/applogpolling/${encodeURIComponent(appname)}/${logsLines}`),
        ]);

        const inspectLink = resourceStore.putJson({
          kind: 'app/inspect',
          name: `${appname} inspect`,
          description: 'Raw /apps/appinspect response',
          value: inspect,
        });
        const statsLink = resourceStore.putJson({
          kind: 'app/stats',
          name: `${appname} stats`,
          description: 'Raw /apps/appstats response',
          value: stats,
        });
        const topLink = resourceStore.putJson({
          kind: 'app/top',
          name: `${appname} top`,
          description: 'Raw /apps/apptop response',
          value: top,
        });
        const monitorLink = resourceStore.putJson({
          kind: 'app/monitor',
          name: `${appname} monitor`,
          description: 'Raw /apps/appmonitor response',
          value: monitor,
        });
        const logsLink = resourceStore.putJson({
          kind: 'app/logs',
          name: `${appname} logs (raw)`,
          description: 'Raw /apps/applogpolling response',
          value: logs,
        });

        const summary = {
          ok: true,
          appname,
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
          nextSteps: [
            'Use flux_logs_tail for safe log tailing',
            'Use flux_apps_redeploy with confirm=true to redeploy',
            'Use flux_auth_diagnose if any call fails due to auth',
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
        return jsonResult({ ok: true, baseUrl: client.getBaseUrl() });
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
        } finally {
          if (prevBase) client.setBaseUrl(prevBase);
        }
      }

      case 'flux_set_zelidauth': {
        const value = args['zelidauth'];
        client.setZelidauth(value);
        return jsonResult({ ok: true, zelidauth: client.getZelidauthSummary() });
      }

      case 'flux_clear_zelidauth':
        client.clearZelidauth();
        return jsonResult({ ok: true, zelidauth: client.getZelidauthSummary() });

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

        const { table, shown } = renderMarkdownTable({ headers, rows, maxRows: 50 });

        const summary = {
          ok: true,
          query: query ?? null,
          category: category ?? null,
          access: access ?? null,
          method: method ?? null,
          count: results.length,
          shown,
          resourceUri: link.uri,
          nextActions: results.slice(0, 5).map((r) => ({
            tool: 'flux_request',
            arguments: {
              method: r.method,
              path: r.path,
            },
          })),
        };

        return {
          content: [
            { type: 'text', text: table },
            { type: 'text', text: `\n\n${JSON.stringify(summary, null, 2)}` },
            { type: 'resource_link', ...link },
          ],
          structuredContent: summary,
          isError: false,
        };
      }

      case 'flux_explorer_height_info': {
        const secondsPerBlockRaw = asOptionalNumber(args['secondsPerBlock']);
        const secondsPerBlock = secondsPerBlockRaw && secondsPerBlockRaw > 0 ? secondsPerBlockRaw : 120;

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
        const secondsPerBlock = secondsPerBlockRaw && secondsPerBlockRaw > 0 ? secondsPerBlockRaw : 120;

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

        const { table, shown } = renderMarkdownTable({ headers: ['Metric', 'Value'], rows, maxRows: 50 });

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
          shown,
          currentHeight: Number.isFinite(currentHeight) ? Math.trunc(currentHeight) : null,
          isSynced,
          approxSecondsBehind: isSynced === true ? 0 : null,
          secondsPerBlock,
          approxBlocksPerHour: Math.floor((60 * 60) / secondsPerBlock),
          approxBlocksPerDay: Math.floor((24 * 60 * 60) / secondsPerBlock),
          resourceUri: link.uri,
        };

        return {
          content: [
            { type: 'text', text: table },
            { type: 'text', text: `\n\n${JSON.stringify(summary, null, 2)}` },
            { type: 'resource_link', ...link },
          ],
          structuredContent: summary,
          isError: !summary.ok,
        };
      }

      case 'flux_request': {
        const method = asOptionalString(args['method']);
        const pathname = mustBeString(args['path'], 'path');
        const queryRaw = args['query'];
        const body = args['body'];
        const zelidauth = args['zelidauth'];
        const useStoredZelidauth = asOptionalBoolean(args['useStoredZelidauth']);
        const timeoutMs = asOptionalNumber(args['timeoutMs']);
        const allowMutation = (asOptionalBoolean(args['allowMutation']) ?? false) === true;
        const responseType = asResponseType(args['responseType']);
        const maxBytes = asOptionalNumber(args['maxBytes']);

        let query: Record<string, unknown> | undefined;
        if (queryRaw !== undefined) {
          if (!queryRaw || typeof queryRaw !== 'object' || Array.isArray(queryRaw)) {
            throw new Error('query must be an object when provided (e.g. {"appname":"myapp"})');
          }
          query = queryRaw as Record<string, unknown>;
        }

        return jsonResult(
          await client.request(pathname, {
            method,
            query,
            body,
            zelidauth,
            useStoredZelidauth,
            timeoutMs,
            allowMutation,
            responseType,
            maxBytes,
          })
        );
      }

      case 'flux_node_health': {
        const [version, info, isarcaneos] = await Promise.all([
          client.request('/flux/version'),
          client.request('/flux/info'),
          client.request('/flux/isarcaneos'),
        ]);
        return jsonResult({ version, info, isarcaneos });
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

        const { table, shown } = renderMarkdownTable({ headers, rows, maxRows: 50 });

        const summary = {
          ok: res.ok,
          status: res.status,
          count: items.length,
          shown,
          resourceUri: link.uri,
        };

        return {
          content: [
            { type: 'text', text: table },
            { type: 'text', text: `\n\n${JSON.stringify(summary, null, 2)}` },
            { type: 'resource_link', ...link },
          ],
          structuredContent: summary,
          isError: !res.ok,
        };
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

        const { table, shown } = renderMarkdownTable({ headers, rows, maxRows: 100 });

        const summary = {
          ok: res.ok,
          status: res.status,
          count: names.length,
          shown,
          resourceUri: link.uri,
        };

        return {
          content: [
            { type: 'text', text: table },
            { type: 'text', text: `\n\n${JSON.stringify(summary, null, 2)}` },
            { type: 'resource_link', ...link },
          ],
          structuredContent: summary,
          isError: !res.ok,
        };
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

        const summary = {
          ok: res.ok,
          status: res.status,
          hash: hash ?? null,
          owner: owner ?? null,
          appname: appname ?? null,
          resourceUri: link.uri,
        };

        return {
          content: [{ type: 'text', text: JSON.stringify(summary, null, 2) }, { type: 'resource_link', ...link }],
          structuredContent: summary,
          isError: !res.ok,
        };
      }

      case 'flux_apps_list_by_zelid_with_expiry': {
        const requestedZelid = asOptionalString(args['zelid']);
        const includeExpired = (asOptionalBoolean(args['includeExpired']) ?? false) === true;
        const estimateTimeRemaining = (asOptionalBoolean(args['estimateTimeRemaining']) ?? false) === true;
        const secondsPerBlockRaw = asOptionalNumber(args['secondsPerBlock']);
        const secondsPerBlock = secondsPerBlockRaw && secondsPerBlockRaw > 0 ? secondsPerBlockRaw : 120;

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

        const { table, shown } = renderMarkdownTable({ headers, rows, maxRows: limit });

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

        const preview = filtered.slice(0, limit);
        const summary = {
          ok: globalSpecsRes.ok && scannedHeightRes.ok && registrationInfoRes.ok,
          zelid,
          options: { includeExpired, estimateTimeRemaining, secondsPerBlock, limit },
          count: computed.length,
          shown,
          currentHeight,
          blocksLasting,
          daemonPONFork,
          preview,
          resourceUri: link.uri,
        };

        return {
          content: [
            { type: 'text', text: table },
            { type: 'text', text: `\n\n${JSON.stringify(summary, null, 2)}` },
            { type: 'resource_link', ...link },
          ],
          structuredContent: summary,
          isError: !summary.ok,
        };
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
              expirationHeight,
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

        const temporary = unwrapFluxEnvelope<unknown>(temporaryRes.data);
        const permanent = unwrapFluxEnvelope<unknown>(permanentRes.data);

        const temporaryCount = Array.isArray(temporary) ? temporary.length : null;
        const permanentCount = Array.isArray(permanent) ? permanent.length : null;

        const headers = ['App', 'Blocks Left', 'Expired?', 'Expires (height)', 'Updated (height)', 'Temp msgs', 'Perm msgs'];
        const rows = filtered.map((x) => {
          const name = typeof x.name === 'string' ? x.name : '-';
          const blocksRemaining = typeof x.blocksRemaining === 'number' ? Math.trunc(x.blocksRemaining) : 0;
          const expired = x.expired === true ? 'yes' : 'no';
          const expiresAt = typeof x.expirationHeight === 'number' ? Math.trunc(x.expirationHeight) : '-';
          const updatedAt = typeof x.height === 'number' ? Math.trunc(x.height) : '-';
          return [name, blocksRemaining, expired, expiresAt, updatedAt, temporaryCount ?? '-', permanentCount ?? '-'];
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
            apps: computed,
            raw: {
              globalappsspecifications: globalSpecsRes,
              temporarymessages: temporaryRes,
              permanentmessages: permanentRes,
              scannedheight: scannedHeightRes,
              registrationinformation: registrationInfoRes,
            },
          },
        });

        const summary = {
          ok: globalSpecsRes.ok && temporaryRes.ok && permanentRes.ok && scannedHeightRes.ok && registrationInfoRes.ok,
          zelid: zelid ?? null,
          appname: requestedAppname ?? null,
          count: computed.length,
          shown,
          temporaryCount,
          permanentCount,
          resourceUri: link.uri,
        };

        return {
          content: [
            { type: 'text', text: table },
            { type: 'text', text: `\n\n${JSON.stringify(summary, null, 2)}` },
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

        const summary = {
          ok: res.ok,
          status: res.status,
          appname,
          decrypt: decrypt ?? null,
          resourceUri: link.uri,
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
        const summary = { ok: res.ok, status: res.status, resourceUri: link.uri };
        return {
          content: [{ type: 'text', text: JSON.stringify(summary, null, 2) }, { type: 'resource_link', ...link }],
          structuredContent: summary,
          isError: !res.ok,
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
        const summary = { ok: res.ok, status: res.status, resourceUri: link.uri };
        return {
          content: [{ type: 'text', text: JSON.stringify(summary, null, 2) }, { type: 'resource_link', ...link }],
          structuredContent: summary,
          isError: !res.ok,
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
        const specInput = mustBeObject(args['spec'], 'spec');
        const timestamp = asOptionalNumber(args['timestamp']) ?? Date.now();
        const typeVersion = asOptionalNumber(args['typeVersion']) ?? 1;

        const verified = await client.request('/apps/verifyappregistrationspecifications', {
          method: 'POST',
          body: specInput,
          allowMutation: true,
        });

        const verifiedSpec = unwrapFluxEnvelope<Record<string, unknown>>(verified.data);

        const price = await client.request('/apps/calculateprice', {
          method: 'POST',
          body: verifiedSpec,
          allowMutation: true,
        });

        const [registrationInformation, deploymentInformation] = await Promise.all([
          client.request('/apps/registrationinformation'),
          client.request('/apps/deploymentinformation'),
        ]);

        const type = 'fluxappregister' as const;
        const messageToSign = buildMessageToSign({ type, version: typeVersion, spec: verifiedSpec, timestamp });
        const payload = buildSignedPayload({ type, version: typeVersion, spec: verifiedSpec, timestamp });

        return jsonResult({
          verified,
          price,
          registrationInformation,
          deploymentInformation,
          timestamp,
          type,
          typeVersion,
          messageToSign,
          payload,
          next: 'Sign messageToSign with the OWNER ZelID, then call flux_apps_register with signature + same timestamp.',
        });
      }

       case 'flux_apps_register': {
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
             })
           : null;
 
         const spec = verified ? unwrapFluxEnvelope<Record<string, unknown>>(verified.data) : specInput;
 
         const type = 'fluxappregister' as const;
         const messageToSign = buildMessageToSign({ type, version: typeVersion, spec, timestamp });
         const payload = buildSignedPayload({ type, version: typeVersion, spec, timestamp, signature });
 
         const submit = await client.request('/apps/appregister', {
           method: 'POST',
           body: payload,
           allowMutation: true,
         });
 
         const hash = extractHashFromAppMessageResponse(submit.data);
 
         return jsonResult({ verified, submit, hash, messageToSign, payload });
       }

       case 'flux_apps_register_and_verify': {
         requireConfirm(args, 'apps/appregister');
         const specInput = mustBeObject(args['spec'], 'spec');
         const signature = mustBeString(args['signature'], 'signature');
         const timestamp = mustBeNumber(args['timestamp'], 'timestamp');
         const verifyFirstRaw = args['verifyFirst'];
         const verifyFirst = verifyFirstRaw === undefined ? true : mustBeBoolean(verifyFirstRaw, 'verifyFirst');
         const typeVersion = asOptionalNumber(args['typeVersion']) ?? 1;
 
         const attempts = asOptionalNumber(args['attempts']) ?? 10;
         const intervalMs = asOptionalNumber(args['intervalMs']) ?? 3000;
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
         const payload = buildSignedPayload({ type, version: typeVersion, spec, timestamp, signature });
 
         const submit = await client.request('/apps/appregister', {
           method: 'POST',
           body: payload,
           allowMutation: true,
         });
 
         const hash = extractHashFromAppMessageResponse(submit.data);
         if (!hash) throw new Error('Could not extract message hash from registration response');
 
         const propagation = await pollMessagePropagation({ hash, attempts, intervalMs });

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

         const ok = submit.ok && propagation.permanentPresent === true && (globalPresent !== false);

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
             verified,
             submit,
             propagation,
             globalCheck,
             globalPresent,
           },
         });

         const summary = {
           ok,
           status: ok ? 'verified' : 'pending',
           appname: appname ?? null,
           owner: owner ?? null,
           hash,
           attemptsUsed: propagation.attemptsUsed,
           temporaryPresent: propagation.temporaryPresent,
           permanentPresent: propagation.permanentPresent,
           globalPresent,
           resourceUri: link.uri,
           nextActions: ok
             ? []
             : [
                 { tool: 'flux_apps_get_messages', arguments: { hash, kind: 'both' } },
                 appname ? { tool: 'flux_apps_global_status', arguments: { appname, zelid: owner } } : null,
               ].filter(Boolean),
         };

         return {
           content: [{ type: 'text', text: JSON.stringify(summary, null, 2) }, { type: 'resource_link', ...link }],
           structuredContent: summary,
           isError: !ok,
         };
       }


      case 'flux_apps_plan_update': {
        const specInput = mustBeObject(args['spec'], 'spec');
        const timestamp = asOptionalNumber(args['timestamp']) ?? Date.now();
        const typeVersion = asOptionalNumber(args['typeVersion']) ?? 1;

        const verified = await client.request('/apps/verifyappupdatespecifications', {
          method: 'POST',
          body: specInput,
          allowMutation: true,
        });

        const verifiedSpec = unwrapFluxEnvelope<Record<string, unknown>>(verified.data);

        const price = await client.request('/apps/calculateprice', {
          method: 'POST',
          body: verifiedSpec,
          allowMutation: true,
        });

        const type = 'fluxappupdate' as const;
        const messageToSign = buildMessageToSign({ type, version: typeVersion, spec: verifiedSpec, timestamp });
        const payload = buildSignedPayload({ type, version: typeVersion, spec: verifiedSpec, timestamp });

        return jsonResult({
          verified,
          price,
          timestamp,
          type,
          typeVersion,
          messageToSign,
          payload,
          next: 'Sign messageToSign with the OWNER ZelID, then call flux_apps_update with signature + same timestamp.',
        });
      }

       case 'flux_apps_update': {
         const specInput = mustBeObject(args['spec'], 'spec');
         const signature = mustBeString(args['signature'], 'signature');
         const timestamp = mustBeNumber(args['timestamp'], 'timestamp');
         const verifyFirstRaw = args['verifyFirst'];
         const verifyFirst = verifyFirstRaw === undefined ? true : mustBeBoolean(verifyFirstRaw, 'verifyFirst');
         const typeVersion = asOptionalNumber(args['typeVersion']) ?? 1;
 
         const verified = verifyFirst
           ? await client.request('/apps/verifyappupdatespecifications', {
               method: 'POST',
               body: specInput,
               allowMutation: true,
             })
           : null;
 
         const spec = verified ? unwrapFluxEnvelope<Record<string, unknown>>(verified.data) : specInput;
 
         const type = 'fluxappupdate' as const;
         const messageToSign = buildMessageToSign({ type, version: typeVersion, spec, timestamp });
         const payload = buildSignedPayload({ type, version: typeVersion, spec, timestamp, signature });
 
         const submit = await client.request('/apps/appupdate', {
           method: 'POST',
           body: payload,
           allowMutation: true,
         });
 
         const hash = extractHashFromAppMessageResponse(submit.data);
 
         return jsonResult({ verified, submit, hash, messageToSign, payload });
       }

       case 'flux_apps_update_and_verify': {
         requireConfirm(args, 'apps/appupdate');
         const specInput = mustBeObject(args['spec'], 'spec');
         const signature = mustBeString(args['signature'], 'signature');
         const timestamp = mustBeNumber(args['timestamp'], 'timestamp');
         const verifyFirstRaw = args['verifyFirst'];
         const verifyFirst = verifyFirstRaw === undefined ? true : mustBeBoolean(verifyFirstRaw, 'verifyFirst');
         const typeVersion = asOptionalNumber(args['typeVersion']) ?? 1;
 
         const attempts = asOptionalNumber(args['attempts']) ?? 10;
         const intervalMs = asOptionalNumber(args['intervalMs']) ?? 3000;
         const verifyGlobal = (asOptionalBoolean(args['verifyGlobal']) ?? true) === true;
 
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
         const payload = buildSignedPayload({ type, version: typeVersion, spec, timestamp, signature });
 
         const submit = await client.request('/apps/appupdate', {
           method: 'POST',
           body: payload,
           allowMutation: true,
         });
 
         const hash = extractHashFromAppMessageResponse(submit.data);
         if (!hash) throw new Error('Could not extract message hash from update response');
 
         const propagation = await pollMessagePropagation({ hash, attempts, intervalMs });

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

         const ok = submit.ok && propagation.permanentPresent === true && (globalPresent !== false);

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
             verified,
             submit,
             propagation,
             globalCheck,
             globalPresent,
           },
         });

         const summary = {
           ok,
           status: ok ? 'verified' : 'pending',
           appname: appname ?? null,
           owner: owner ?? null,
           hash,
           attemptsUsed: propagation.attemptsUsed,
           temporaryPresent: propagation.temporaryPresent,
           permanentPresent: propagation.permanentPresent,
           globalPresent,
           resourceUri: link.uri,
           nextActions: ok
             ? []
             : [
                 { tool: 'flux_apps_get_messages', arguments: { hash, kind: 'both' } },
                 appname ? { tool: 'flux_apps_global_status', arguments: { appname, zelid: owner } } : null,
               ].filter(Boolean),
         };

         return {
           content: [{ type: 'text', text: JSON.stringify(summary, null, 2) }, { type: 'resource_link', ...link }],
           structuredContent: summary,
           isError: !ok,
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
          const summary = { ok: res.ok, status: res.status, kind, hash, resourceUri: link.uri };
          return {
            content: [{ type: 'text', text: JSON.stringify(summary, null, 2) }, { type: 'resource_link', ...link }],
            structuredContent: summary,
            isError: !res.ok,
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
          const summary = { ok: res.ok, status: res.status, kind, hash, resourceUri: link.uri };
          return {
            content: [{ type: 'text', text: JSON.stringify(summary, null, 2) }, { type: 'resource_link', ...link }],
            structuredContent: summary,
            isError: !res.ok,
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

        const summary = {
          ok: temporary.ok && permanent.ok,
          hash,
          kind,
          resourceUri: link.uri,
          temporary: { ok: temporary.ok, status: temporary.status },
          permanent: { ok: permanent.ok, status: permanent.status },
        };

        return {
          content: [{ type: 'text', text: JSON.stringify(summary, null, 2) }, { type: 'resource_link', ...link }],
          structuredContent: summary,
          isError: !summary.ok,
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

      case 'flux_apps_redeploy': {
        requireConfirm(args, 'apps/redeploy');
        const appname = mustBeString(args['appname'], 'appname');
        const force = asOptionalBoolean(args['force']);
        const global = asOptionalBoolean(args['global']);

        return jsonResult(
          await client.request('/apps/redeploy', {
            method: 'GET',
            query: { appname, force, global },
            allowMutation: true,
          })
        );
      }

      case 'flux_apps_redeploy_component': {
        requireConfirm(args, 'apps/redeploycomponent');
        const appname = mustBeString(args['appname'], 'appname');
        const component = mustBeString(args['component'], 'component');
        const force = asOptionalBoolean(args['force']);

        return jsonResult(
          await client.request('/apps/redeploycomponent', {
            method: 'GET',
            query: { appname, component, force },
            allowMutation: true,
          })
        );
      }

      case 'flux_apps_logs': {
        const appname = mustBeString(args['appname'], 'appname');
        const lines = asOptionalString(args['lines']) ?? 'all';

        const res = await client.request('/apps/applog', { query: { appname, lines } });

        const link = resourceStore.putJson({
          kind: 'apps/applog',
          name: `${appname} applog`,
          description: 'Raw /apps/applog response',
          value: res,
        });

        const summary = {
          ok: res.ok,
          status: res.status,
          appname,
          lines,
          resourceUri: link.uri,
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

      case 'flux_apps_inspect': {
        const appname = mustBeString(args['appname'], 'appname');

        const res = await client.request('/apps/appinspect', { query: { appname } });

        const link = resourceStore.putJson({
          kind: 'apps/inspect',
          name: `${appname} inspect`,
          description: 'Raw /apps/appinspect response',
          value: res,
        });

        const summary = {
          ok: res.ok,
          status: res.status,
          appname,
          resourceUri: link.uri,
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

      case 'flux_apps_stats': {
        const appname = mustBeString(args['appname'], 'appname');

        const res = await client.request('/apps/appstats', { query: { appname } });

        const link = resourceStore.putJson({
          kind: 'apps/stats',
          name: `${appname} stats`,
          description: 'Raw /apps/appstats response',
          value: res,
        });

        const summary = {
          ok: res.ok,
          status: res.status,
          appname,
          resourceUri: link.uri,
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

      case 'flux_apps_top': {
        const appname = mustBeString(args['appname'], 'appname');

        const res = await client.request('/apps/apptop', { query: { appname } });

        const link = resourceStore.putJson({
          kind: 'apps/top',
          name: `${appname} top`,
          description: 'Raw /apps/apptop response',
          value: res,
        });

        const summary = {
          ok: res.ok,
          status: res.status,
          appname,
          resourceUri: link.uri,
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

      case 'flux_apps_monitor': {
        const appname = mustBeString(args['appname'], 'appname');
        const range = asOptionalNumber(args['range']);

        const res = await client.request('/apps/appmonitor', { query: { appname, range } });

        const link = resourceStore.putJson({
          kind: 'apps/monitor',
          name: `${appname} monitor`,
          description: 'Raw /apps/appmonitor response',
          value: res,
        });

        const summary = {
          ok: res.ok,
          status: res.status,
          appname,
          range: range ?? null,
          resourceUri: link.uri,
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

      case 'flux_apps_exec': {
        requireConfirm(args, 'apps/appexec');
        const appname = mustBeString(args['appname'], 'appname');
        const cmd = args['cmd'];
        if (!Array.isArray(cmd) || cmd.some((c) => typeof c !== 'string')) {
          throw new Error('cmd must be an array of strings');
        }
        const env = normalizeEnvParams(args['env']);

        return jsonResult(
          await client.request('/apps/appexec', {
            method: 'POST',
            body: { appname, cmd, env },
            allowMutation: true,
            responseType: 'text',
          })
        );
      }

      case 'flux_apps_list_folder': {
        const appname = mustBeString(args['appname'], 'appname');
        const component = mustBeString(args['component'], 'component');
        const folder = asOptionalString(args['folder']) ?? '';

        const res = await client.request('/apps/getfolderinfo', { query: { appname, component, folder } });

        const link = resourceStore.putJson({
          kind: 'apps/getfolderinfo',
          name: `${appname} folder listing`,
          description: 'Raw /apps/getfolderinfo response',
          value: res,
        });

        const summary = {
          ok: res.ok,
          status: res.status,
          appname,
          component,
          folder,
          resourceUri: link.uri,
        };

        return {
          content: [{ type: 'text', text: JSON.stringify(summary, null, 2) }, { type: 'resource_link', ...link }],
          structuredContent: summary,
          isError: !res.ok,
        };
      }

      case 'flux_apps_download_file': {
        const appname = mustBeString(args['appname'], 'appname');
        const component = mustBeString(args['component'], 'component');
        const file = mustBeString(args['file'], 'file');
        const maxBytes = asOptionalNumber(args['maxBytes']);

        return jsonResult(
          await client.request('/apps/downloadfile', {
            query: { appname, component, file },
            responseType: 'base64',
            maxBytes,
          })
        );
      }

      case 'flux_apps_download_folder': {
        const appname = mustBeString(args['appname'], 'appname');
        const component = mustBeString(args['component'], 'component');
        const folder = mustBeString(args['folder'], 'folder');
        const maxBytes = asOptionalNumber(args['maxBytes']);

        return jsonResult(
          await client.request('/apps/downloadfolder', {
            query: { appname, component, folder },
            responseType: 'base64',
            maxBytes,
          })
        );
      }

      case 'flux_apps_create_folder': {
        requireConfirm(args, 'apps/createfolder');
        const appname = mustBeString(args['appname'], 'appname');
        const component = mustBeString(args['component'], 'component');
        const folder = mustBeString(args['folder'], 'folder');

        return jsonResult(
          await client.request('/apps/createfolder', {
            method: 'GET',
            query: { appname, component, folder },
            allowMutation: true,
          })
        );
      }

      case 'flux_apps_rename_object': {
        requireConfirm(args, 'apps/renameobject');
        const appname = mustBeString(args['appname'], 'appname');
        const component = mustBeString(args['component'], 'component');
        const oldpath = mustBeString(args['oldpath'], 'oldpath');
        const newname = mustBeString(args['newname'], 'newname');

        return jsonResult(
          await client.request('/apps/renameobject', {
            method: 'GET',
            query: { appname, component, oldpath, newname },
            allowMutation: true,
          })
        );
      }

      case 'flux_apps_remove_object': {
        requireConfirm(args, 'apps/removeobject');
        const appname = mustBeString(args['appname'], 'appname');
        const component = mustBeString(args['component'], 'component');
        const object = mustBeString(args['object'], 'object');

        return jsonResult(
          await client.request('/apps/removeobject', {
            method: 'GET',
            query: { appname, component, object },
            allowMutation: true,
          })
        );
      }

      case 'flux_syncthing_metrics': {
        const res = await client.request('/syncthing/metrics');
        const link = resourceStore.putJson({
          kind: 'syncthing/metrics',
          name: 'Syncthing metrics',
          description: 'Raw /syncthing/metrics response',
          value: res,
        });
        const summary = { ok: res.ok, status: res.status, resourceUri: link.uri };
        return {
          content: [{ type: 'text', text: JSON.stringify(summary, null, 2) }, { type: 'resource_link', ...link }],
          structuredContent: summary,
          isError: !res.ok,
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

        const { table, shown } = renderMarkdownTable({ headers, rows, maxRows: 1 });

        const summary = { ok: res.ok, status: res.status, resourceUri: link.uri };
        return {
          content: [
            { type: 'text', text: table },
            { type: 'text', text: `\n\n${JSON.stringify(summary, null, 2)}` },
            { type: 'resource_link', ...link },
          ],
          structuredContent: summary,
          isError: !res.ok,
        };
      }

      case 'flux_syncthing_system_status': {
        const res = await client.request('/syncthing/system/status');
        const link = resourceStore.putJson({
          kind: 'syncthing/system/status',
          name: 'Syncthing system status',
          description: 'Raw /syncthing/system/status response',
          value: res,
        });
        const summary = { ok: res.ok, status: res.status, resourceUri: link.uri };
        return {
          content: [{ type: 'text', text: JSON.stringify(summary, null, 2) }, { type: 'resource_link', ...link }],
          structuredContent: summary,
          isError: !res.ok,
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

        const { table, shown } = renderMarkdownTable({ headers, rows, maxRows: 100 });

        const summary = { ok: res.ok, status: res.status, count: folders.length, shown, resourceUri: link.uri };
        return {
          content: [
            { type: 'text', text: table },
            { type: 'text', text: `\n\n${JSON.stringify(summary, null, 2)}` },
            { type: 'resource_link', ...link },
          ],
          structuredContent: summary,
          isError: !res.ok,
        };
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

        const { table, shown } = renderMarkdownTable({ headers, rows, maxRows: 100 });

        const summary = { ok: res.ok, status: res.status, count: devices.length, shown, resourceUri: link.uri };
        return {
          content: [
            { type: 'text', text: table },
            { type: 'text', text: `\n\n${JSON.stringify(summary, null, 2)}` },
            { type: 'resource_link', ...link },
          ],
          structuredContent: summary,
          isError: !res.ok,
        };
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
          ok: res.ok,
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
          isError: !res.ok,
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
        return jsonResult(await client.request('/syncthing/system/restart'));
      }

      default: {
        const out = { error: `Unknown tool: ${name}` };
        return jsonResult(out, { isError: true, structuredContent: out });
      }
    }
  } catch (err: unknown) {
    const hint =
      name === 'flux_request'
        ? 'For mutating endpoints, retry with allowMutation=true. For safer workflows, prefer dedicated flux_apps_* tools that require confirm=true.'
        : undefined;
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
