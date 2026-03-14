import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

import type { ToolRuntime } from '../cli.js';
import { clearCliResources, pruneCliResources, readCliResource } from '../state/resourceStore.js';

type FluxMcpTool = {
  name: string;
  description?: string;
  inputSchema?: unknown;
};

type ToolResult = {
  isError: boolean;
  structuredContent?: Record<string, unknown>;
  content: Array<{ type: string; text?: string; uri?: string; name?: string; description?: string; mimeType?: string }>;
};

type FluxMcpModule = {
  __closeLocalLaunchersForTests?(): Promise<void>;
  __getLocalLauncherDebugState?(): {
    keepAlive: boolean;
    localLauncherPort: number | null;
    localLauncherRefed: boolean | null;
    localLauncherRouteCount: number;
    zelcoreLauncherPort: number | null;
    zelcoreLauncherRefed: boolean | null;
    zelcoreLauncherRouteCount: number;
  };
  tools: FluxMcpTool[];
  callTool(name: string, rawArgs: unknown): Promise<ToolResult>;
  hydrateResource(resource: { uri: string; name: string; description?: string; mimeType?: string; text: string }): Promise<unknown>;
  setLocalLauncherKeepAlive?(keepAlive: boolean): void;
};

const require = createRequire(import.meta.url);
const fluxMcpEntryUrl = pathToFileURL(require.resolve('flux-mcp')).href;

function createFluxMcpModuleLoader() {
  let cached: Promise<FluxMcpModule> | undefined;

  return async function loadFluxMcpModule(): Promise<FluxMcpModule> {
    if (!cached) {
      const sessionToken = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
      cached = import(`${fluxMcpEntryUrl}?fluxos_cli_session=${sessionToken}`) as Promise<FluxMcpModule>;
    }

    return cached;
  };
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function asOptionalBoolean(value: unknown): boolean | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value === 'boolean') return value;
  if (typeof value !== 'string') return undefined;

  const normalized = value.trim().toLowerCase();
  if (normalized === 'true' || normalized === '1' || normalized === 'yes') return true;
  if (normalized === 'false' || normalized === '0' || normalized === 'no') return false;
  return undefined;
}

function jsonToolResult(payload: Record<string, unknown>, opts?: { isError?: boolean; contentText?: string }): ToolResult {
  return {
    isError: opts?.isError ?? false,
    structuredContent: payload,
    content: [{ type: 'text', text: opts?.contentText ?? JSON.stringify(payload, null, 2) }],
  };
}

async function readCliBackedResource(rawArgs: unknown): Promise<ToolResult | null> {
  const uri = typeof asRecord(rawArgs).uri === 'string' ? String(asRecord(rawArgs).uri).trim() : '';
  if (!uri || uri === 'flux://inventory/endpoints') return null;

  const found = await readCliResource(uri);
  if (!found) {
    return jsonToolResult({ ok: false, error: 'Resource not found', uri }, { isError: true });
  }

  const payload = {
    ok: true,
    uri: found.uri,
    mimeType: found.mimeType ?? 'text/plain',
  };

  return jsonToolResult(payload, { contentText: found.text });
}

async function pruneCliBackedResources(rawArgs: unknown): Promise<ToolResult> {
  const clearAll = asOptionalBoolean(asRecord(rawArgs).clearAll) ?? false;
  const payload = clearAll
    ? { ok: true, action: 'clearAll', ...(await clearCliResources()) }
    : { ok: true, action: 'prune', ...(await pruneCliResources()) };

  return jsonToolResult(payload);
}

function cloneToolDefinition(tool: FluxMcpTool) {
  return {
    name: tool.name,
    description: tool.description,
    inputSchema: tool.inputSchema,
  };
}

function cloneToolResult(result: ToolResult) {
  return {
    isError: result.isError,
    structuredContent: result.structuredContent,
    content: result.content.map((item) => ({ ...item })),
  };
}

export function createDefaultToolRuntime(): ToolRuntime {
  const loadFluxMcpModule = createFluxMcpModuleLoader();

  return {
    async listTools() {
      const { tools } = await loadFluxMcpModule();
      return tools.map(cloneToolDefinition);
    },

    async callTool(name, rawArgs) {
      if (name === 'flux_resource_read') {
        const cliResult = await readCliBackedResource(rawArgs);
        if (cliResult) return cliResult;
      }

      if (name === 'flux_resource_prune') {
        return pruneCliBackedResources(rawArgs);
      }

      const { callTool } = await loadFluxMcpModule();
      return cloneToolResult(await callTool(name, rawArgs));
    },

    async readResource(uri) {
      const { callTool } = await loadFluxMcpModule();
      const result = await callTool('flux_resource_read', { uri });
      if (result.isError) return null;

      const textItem = result.content.find((item) => item.type === 'text' && typeof item.text === 'string');
      const structured = result.structuredContent;
      const mimeType =
        structured && typeof structured === 'object' && !Array.isArray(structured) && typeof structured.mimeType === 'string'
          ? structured.mimeType
          : undefined;

      if (!textItem || typeof textItem.text !== 'string') return null;
      return { uri, mimeType, text: textItem.text };
    },

    async hydrateResource(resource) {
      const module = await loadFluxMcpModule();
      await module.hydrateResource(resource);
    },

    async setLauncherKeepAlive(keepAlive) {
      const module = await loadFluxMcpModule();
      module.setLocalLauncherKeepAlive?.(keepAlive);
    },

    async getLauncherDebugState() {
      const module = await loadFluxMcpModule();
      return module.__getLocalLauncherDebugState?.() ?? {
        keepAlive: true,
        localLauncherPort: null,
        localLauncherRefed: null,
        localLauncherRouteCount: 0,
        zelcoreLauncherPort: null,
        zelcoreLauncherRefed: null,
        zelcoreLauncherRouteCount: 0,
      };
    },

    async closeLocalLaunchersForTests() {
      const module = await loadFluxMcpModule();
      await module.__closeLocalLaunchersForTests?.();
    },
  };
}
