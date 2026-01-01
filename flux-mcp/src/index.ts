#!/usr/bin/env node

import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  Tool,
} from '@modelcontextprotocol/sdk/types.js';

import { FluxClient } from './fluxClient.js';
import type { FluxResponseType } from './fluxClient.js';
import {
  loadEndpointInventory,
  searchRoutes,
  summarizeByCategory,
} from './endpoints.js';

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

function jsonResult(data: unknown, isError = false) {
  return {
    content: [{ type: 'text', text: JSON.stringify(data, null, 2) }],
    isError,
  };
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

function unwrapFluxData<T = unknown>(maybeEnvelope: any): T {
  if (maybeEnvelope && typeof maybeEnvelope === 'object' && maybeEnvelope.status === 'success' && 'data' in maybeEnvelope) {
    return maybeEnvelope.data as T;
  }
  return maybeEnvelope as T;
}

function extractHashFromAppMessageResponse(responseBody: any): string | undefined {
  const body = responseBody;
  if (!body || typeof body !== 'object') return undefined;

  // Standard envelope
  if (typeof body.data === 'string') return body.data;

  const inner = body.data;
  if (inner && typeof inner === 'object') {
    const candidates = [
      (inner as any).hash,
      (inner as any).messageHASH,
      (inner as any).messageHash,
      (inner as any).id,
    ];
    for (const c of candidates) {
      if (typeof c === 'string' && c.trim()) return c;
    }
  }

  // Fallbacks
  const topCandidates = [body.hash, body.messageHASH, body.messageHash, body.id];
  for (const c of topCandidates) {
    if (typeof c === 'string' && c.trim()) return c;
  }

  return undefined;
}

function requireConfirm(args: any, actionDescription: string) {
  const confirm = asOptionalBoolean(args?.confirm) ?? false;
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

const tools: Tool[] = [
  // Session/auth helpers
  {
    name: 'flux_get_state',
    description: 'Get current MCP client state (base URL, whether zelidauth is set).',
    inputSchema: { type: 'object', properties: {} },
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

  // Endpoint discovery
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

  // Generic request (escape hatch)
  {
    name: 'flux_request',
    description: 'Call any Flux node API endpoint. Mutating endpoints require allowMutation=true. Use responseType=base64 for file downloads.',
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

const server = new Server(
  { name: 'flux-mcp', version: '0.3.0' },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools }));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    switch (name) {
      // Session/auth helpers
      case 'flux_get_state':
        return jsonResult({
          baseUrl: client.getBaseUrl(),
          zelidauth: client.getZelidauthSummary(),
          endpointsInventory: inventory
            ? { path: endpointsPath, routeCount: inventory.routeCount, generatedAt: inventory.generatedAt }
            : { path: endpointsPath, present: false },
        });

      case 'flux_set_base_url': {
        const baseUrl = mustBeString((args as any)?.baseUrl, 'baseUrl');
        client.setBaseUrl(baseUrl);
        return jsonResult({ ok: true, baseUrl: client.getBaseUrl() });
      }

      case 'flux_set_zelidauth': {
        const value = (args as any)?.zelidauth;
        client.setZelidauth(value);
        return jsonResult({ ok: true, zelidauth: client.getZelidauthSummary() });
      }

      case 'flux_clear_zelidauth':
        client.clearZelidauth();
        return jsonResult({ ok: true, zelidauth: client.getZelidauthSummary() });

      case 'flux_get_login_phrase':
        return jsonResult(await client.request('/id/loginphrase'));

      case 'flux_build_zelidauth': {
        const zelid = mustBeString((args as any)?.zelid, 'zelid');
        const signature = mustBeString((args as any)?.signature, 'signature');
        const loginPhrase = mustBeString((args as any)?.loginPhrase, 'loginPhrase');
        const headerValue = JSON.stringify({ zelid, signature, loginPhrase });
        return jsonResult({ zelidauth: headerValue });
      }

      // Endpoint discovery
      case 'flux_list_endpoint_categories': {
        if (!inventory) return jsonResult({ error: 'Endpoint inventory not found', endpointsPath }, true);
        return jsonResult({
          routeCount: inventory.routeCount,
          categories: summarizeByCategory(inventory.routes),
        });
      }

      case 'flux_search_endpoints': {
        if (!inventory) return jsonResult({ error: 'Endpoint inventory not found', endpointsPath }, true);
        const query = asOptionalString((args as any)?.query);
        const category = asOptionalString((args as any)?.category);
        const access = asOptionalString((args as any)?.access);
        const method = asOptionalString((args as any)?.method);
        const limit = (args as any)?.limit;

        return jsonResult({
          results: searchRoutes(inventory.routes, { query, category, access, method, limit }),
        });
      }

      // Generic request
      case 'flux_request': {
        const method = asOptionalString((args as any)?.method);
        const pathname = mustBeString((args as any)?.path, 'path');
        const query = (args as any)?.query;
        const body = (args as any)?.body;
        const zelidauth = (args as any)?.zelidauth;
        const useStoredZelidauth = asOptionalBoolean((args as any)?.useStoredZelidauth);
        const timeoutMs = asOptionalNumber((args as any)?.timeoutMs);
        const allowMutation = (asOptionalBoolean((args as any)?.allowMutation) ?? false) === true;
        const responseType = asResponseType((args as any)?.responseType);
        const maxBytes = asOptionalNumber((args as any)?.maxBytes);

        if (query !== undefined && (!query || typeof query !== 'object' || Array.isArray(query))) {
          throw new Error('query must be an object when provided');
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

      // Node / platform
      case 'flux_node_health': {
        const [version, info, isarcaneos] = await Promise.all([
          client.request('/flux/version'),
          client.request('/flux/info'),
          client.request('/flux/isarcaneos'),
        ]);
        return jsonResult({ version, info, isarcaneos });
      }

      // App discovery
      case 'flux_apps_list_running':
        return jsonResult(await client.request('/apps/listrunningapps'));

      case 'flux_apps_list_all':
        return jsonResult(await client.request('/apps/listallapps'));

      case 'flux_apps_get_spec': {
        const appname = mustBeString((args as any)?.appname, 'appname');
        const decrypt = asOptionalBoolean((args as any)?.decrypt);
        const path = decrypt === undefined
          ? `/apps/appspecifications/${encodeURIComponent(appname)}`
          : `/apps/appspecifications/${encodeURIComponent(appname)}/${decrypt ? 'true' : 'false'}`;
        return jsonResult(await client.request(path));
      }

      case 'flux_apps_get_owner': {
        const appname = mustBeString((args as any)?.appname, 'appname');
        return jsonResult(await client.request(`/apps/appowner/${encodeURIComponent(appname)}`));
      }

      case 'flux_apps_registration_information':
        return jsonResult(await client.request('/apps/registrationinformation'));

      case 'flux_apps_deployment_information':
        return jsonResult(await client.request('/apps/deploymentinformation'));

      // Spec helpers
      case 'flux_generate_app_spec_v8': {
        const appName = mustBeString((args as any)?.name, 'name');
        const owner = mustBeString((args as any)?.owner, 'owner');
        const repotag = mustBeString((args as any)?.repotag, 'repotag');

        const appDescription = asOptionalString((args as any)?.appDescription) ?? '';
        const componentName = asOptionalString((args as any)?.componentName) ?? 'web';
        const componentDescription = asOptionalString((args as any)?.componentDescription) ?? componentName;

        const portsRaw = (args as any)?.ports;
        const containerPortsRaw = (args as any)?.containerPorts;
        const domainsRaw = (args as any)?.domains;

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

        const environmentParameters = normalizeEnvParams((args as any)?.environment);
        const commands = normalizeCommands((args as any)?.commands);

        const containerData = asOptionalString((args as any)?.containerData) ?? '/data';

        const cpu = asOptionalNumber((args as any)?.cpu) ?? 1;
        const ram = asOptionalNumber((args as any)?.ram) ?? 2000;
        const hdd = asOptionalNumber((args as any)?.hdd) ?? 10;
        const instances = asOptionalNumber((args as any)?.instances) ?? 3;
        const staticip = asOptionalBoolean((args as any)?.staticip) ?? false;
        const enterprise = asOptionalString((args as any)?.enterprise) ?? '';

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

      // Register/update signing workflow
      case 'flux_apps_verify_registration_spec': {
        const spec = mustBeObject((args as any)?.spec, 'spec');
        return jsonResult(
          await client.request('/apps/verifyappregistrationspecifications', {
            method: 'POST',
            body: spec,
            allowMutation: true,
          })
        );
      }

      case 'flux_apps_verify_update_spec': {
        const spec = mustBeObject((args as any)?.spec, 'spec');
        return jsonResult(
          await client.request('/apps/verifyappupdatespecifications', {
            method: 'POST',
            body: spec,
            allowMutation: true,
          })
        );
      }

      case 'flux_apps_calculate_price': {
        const spec = mustBeObject((args as any)?.spec, 'spec');
        return jsonResult(
          await client.request('/apps/calculateprice', {
            method: 'POST',
            body: spec,
            allowMutation: true,
          })
        );
      }

      case 'flux_apps_plan_registration': {
        const specInput = mustBeObject((args as any)?.spec, 'spec');
        const timestamp = asOptionalNumber((args as any)?.timestamp) ?? Date.now();
        const typeVersion = asOptionalNumber((args as any)?.typeVersion) ?? 1;

        const verified = await client.request('/apps/verifyappregistrationspecifications', {
          method: 'POST',
          body: specInput,
          allowMutation: true,
        });

        const verifiedSpec = unwrapFluxData<Record<string, unknown>>(verified.data);

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
        const specInput = mustBeObject((args as any)?.spec, 'spec');
        const signature = mustBeString((args as any)?.signature, 'signature');
        const timestamp = mustBeNumber((args as any)?.timestamp, 'timestamp');
        const verifyFirst = (args as any)?.verifyFirst === undefined ? true : mustBeBoolean((args as any)?.verifyFirst, 'verifyFirst');
        const typeVersion = asOptionalNumber((args as any)?.typeVersion) ?? 1;

        const verified = verifyFirst
          ? await client.request('/apps/verifyappregistrationspecifications', {
              method: 'POST',
              body: specInput,
              allowMutation: true,
            })
          : null;

        const spec = verified ? unwrapFluxData<Record<string, unknown>>(verified.data) : specInput;

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

      case 'flux_apps_plan_update': {
        const specInput = mustBeObject((args as any)?.spec, 'spec');
        const timestamp = asOptionalNumber((args as any)?.timestamp) ?? Date.now();
        const typeVersion = asOptionalNumber((args as any)?.typeVersion) ?? 1;

        const verified = await client.request('/apps/verifyappupdatespecifications', {
          method: 'POST',
          body: specInput,
          allowMutation: true,
        });

        const verifiedSpec = unwrapFluxData<Record<string, unknown>>(verified.data);

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
        const specInput = mustBeObject((args as any)?.spec, 'spec');
        const signature = mustBeString((args as any)?.signature, 'signature');
        const timestamp = mustBeNumber((args as any)?.timestamp, 'timestamp');
        const verifyFirst = (args as any)?.verifyFirst === undefined ? true : mustBeBoolean((args as any)?.verifyFirst, 'verifyFirst');
        const typeVersion = asOptionalNumber((args as any)?.typeVersion) ?? 1;

        const verified = verifyFirst
          ? await client.request('/apps/verifyappupdatespecifications', {
              method: 'POST',
              body: specInput,
              allowMutation: true,
            })
          : null;

        const spec = verified ? unwrapFluxData<Record<string, unknown>>(verified.data) : specInput;

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

      case 'flux_apps_get_messages': {
        const hash = mustBeString((args as any)?.hash, 'hash');
        const kind = asOptionalString((args as any)?.kind) ?? 'both';

        if (kind === 'temporary') {
          return jsonResult({ temporary: await client.request(`/apps/temporarymessages/${encodeURIComponent(hash)}`) });
        }
        if (kind === 'permanent') {
          return jsonResult({ permanent: await client.request(`/apps/permanentmessages/${encodeURIComponent(hash)}`) });
        }

        const [temporary, permanent] = await Promise.all([
          client.request(`/apps/temporarymessages/${encodeURIComponent(hash)}`),
          client.request(`/apps/permanentmessages/${encodeURIComponent(hash)}`),
        ]);

        return jsonResult({ temporary, permanent });
      }

      // App lifecycle (mutating)
      case 'flux_apps_start': {
        requireConfirm(args, 'apps/appstart');
        const appname = mustBeString((args as any)?.appname, 'appname');
        const global = asOptionalBoolean((args as any)?.global);

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
        const appname = mustBeString((args as any)?.appname, 'appname');
        const global = asOptionalBoolean((args as any)?.global);

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
        const appname = mustBeString((args as any)?.appname, 'appname');
        const global = asOptionalBoolean((args as any)?.global);

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
        const appname = mustBeString((args as any)?.appname, 'appname');
        const force = asOptionalBoolean((args as any)?.force);
        const global = asOptionalBoolean((args as any)?.global);

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
        const appname = mustBeString((args as any)?.appname, 'appname');
        const component = mustBeString((args as any)?.component, 'component');
        const force = asOptionalBoolean((args as any)?.force);

        return jsonResult(
          await client.request('/apps/redeploycomponent', {
            method: 'GET',
            query: { appname, component, force },
            allowMutation: true,
          })
        );
      }

      // App observability
      case 'flux_apps_logs': {
        const appname = mustBeString((args as any)?.appname, 'appname');
        const lines = asOptionalString((args as any)?.lines) ?? 'all';
        return jsonResult(await client.request('/apps/applog', { query: { appname, lines } }));
      }

      case 'flux_apps_inspect': {
        const appname = mustBeString((args as any)?.appname, 'appname');
        return jsonResult(await client.request('/apps/appinspect', { query: { appname } }));
      }

      case 'flux_apps_stats': {
        const appname = mustBeString((args as any)?.appname, 'appname');
        return jsonResult(await client.request('/apps/appstats', { query: { appname } }));
      }

      case 'flux_apps_top': {
        const appname = mustBeString((args as any)?.appname, 'appname');
        return jsonResult(await client.request('/apps/apptop', { query: { appname } }));
      }

      case 'flux_apps_monitor': {
        const appname = mustBeString((args as any)?.appname, 'appname');
        const range = asOptionalNumber((args as any)?.range);
        return jsonResult(await client.request('/apps/appmonitor', { query: { appname, range } }));
      }

      case 'flux_apps_exec': {
        requireConfirm(args, 'apps/appexec');
        const appname = mustBeString((args as any)?.appname, 'appname');
        const cmd = (args as any)?.cmd;
        if (!Array.isArray(cmd) || cmd.some((c) => typeof c !== 'string')) {
          throw new Error('cmd must be an array of strings');
        }
        const env = normalizeEnvParams((args as any)?.env);

        return jsonResult(
          await client.request('/apps/appexec', {
            method: 'POST',
            body: { appname, cmd, env },
            allowMutation: true,
            responseType: 'text',
          })
        );
      }

      // Volume browser (files)
      case 'flux_apps_list_folder': {
        const appname = mustBeString((args as any)?.appname, 'appname');
        const component = mustBeString((args as any)?.component, 'component');
        const folder = asOptionalString((args as any)?.folder) ?? '';
        return jsonResult(await client.request('/apps/getfolderinfo', { query: { appname, component, folder } }));
      }

      case 'flux_apps_download_file': {
        const appname = mustBeString((args as any)?.appname, 'appname');
        const component = mustBeString((args as any)?.component, 'component');
        const file = mustBeString((args as any)?.file, 'file');
        const maxBytes = asOptionalNumber((args as any)?.maxBytes);

        return jsonResult(
          await client.request('/apps/downloadfile', {
            query: { appname, component, file },
            responseType: 'base64',
            maxBytes,
          })
        );
      }

      case 'flux_apps_download_folder': {
        const appname = mustBeString((args as any)?.appname, 'appname');
        const component = mustBeString((args as any)?.component, 'component');
        const folder = mustBeString((args as any)?.folder, 'folder');
        const maxBytes = asOptionalNumber((args as any)?.maxBytes);

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
        const appname = mustBeString((args as any)?.appname, 'appname');
        const component = mustBeString((args as any)?.component, 'component');
        const folder = mustBeString((args as any)?.folder, 'folder');

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
        const appname = mustBeString((args as any)?.appname, 'appname');
        const component = mustBeString((args as any)?.component, 'component');
        const oldpath = mustBeString((args as any)?.oldpath, 'oldpath');
        const newname = mustBeString((args as any)?.newname, 'newname');

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
        const appname = mustBeString((args as any)?.appname, 'appname');
        const component = mustBeString((args as any)?.component, 'component');
        const object = mustBeString((args as any)?.object, 'object');

        return jsonResult(
          await client.request('/apps/removeobject', {
            method: 'GET',
            query: { appname, component, object },
            allowMutation: true,
          })
        );
      }

      // Syncthing
      case 'flux_syncthing_metrics':
        return jsonResult(await client.request('/syncthing/metrics'));

      case 'flux_syncthing_metrics_health':
        return jsonResult(await client.request('/syncthing/metrics/health'));

      case 'flux_syncthing_system_status':
        return jsonResult(await client.request('/syncthing/system/status'));

      case 'flux_syncthing_list_folders':
        return jsonResult(await client.request('/syncthing/config/folders'));

      case 'flux_syncthing_list_devices':
        return jsonResult(await client.request('/syncthing/config/devices'));

      case 'flux_syncthing_db_browse': {
        const folder = mustBeString((args as any)?.folder, 'folder');
        const levels = asOptionalNumber((args as any)?.levels);
        const prefix = asOptionalString((args as any)?.prefix);

        return jsonResult(
          await client.request(`/syncthing/db/browse/${encodeURIComponent(folder)}`, {
            query: { levels, prefix },
          })
        );
      }

      case 'flux_syncthing_db_scan': {
        requireConfirm(args, 'syncthing/db/scan');
        const folder = mustBeString((args as any)?.folder, 'folder');
        const sub = asOptionalString((args as any)?.sub);

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
        return jsonResult(
          await client.request('/syncthing/system/restart', {
            method: 'GET',
            allowMutation: true,
          })
        );
      }

      default:
        return jsonResult({ error: `Unknown tool: ${name}` }, true);
    }
  } catch (err: any) {
    return jsonResult({ error: err?.message ?? String(err) }, true);
  }
});

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  process.stderr.write(`flux-mcp failed to start: ${err?.message ?? String(err)}\n`);
  process.exit(1);
});
