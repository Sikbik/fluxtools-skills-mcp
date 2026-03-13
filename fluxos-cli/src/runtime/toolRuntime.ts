import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import type { ToolRuntime } from '../cli.js';

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
  tools: FluxMcpTool[];
  callTool(name: string, rawArgs: unknown): Promise<ToolResult>;
  hydrateResource(resource: { uri: string; name: string; description?: string; mimeType?: string; text: string }): Promise<void>;
};

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const fluxMcpEntryUrl = pathToFileURL(path.resolve(__dirname, '..', '..', '..', 'flux-mcp', 'dist', 'index.js')).href;

async function loadFluxMcpModule(): Promise<FluxMcpModule> {
  return (await import(fluxMcpEntryUrl)) as FluxMcpModule;
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

export const defaultToolRuntime: ToolRuntime = {
  async listTools() {
    const { tools } = await loadFluxMcpModule();
    return tools.map(cloneToolDefinition);
  },

  async callTool(name, rawArgs) {
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
};
