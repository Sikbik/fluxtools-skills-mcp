import { readFile } from 'node:fs/promises';

import {
  clearCliResources,
  listCliResources,
  persistCliResource,
  pruneCliResources,
  readCliResource,
  type ResourceClearResult,
  type ResourceDescriptor as CliResourceDescriptor,
  type ResourcePruneResult,
} from './state/resourceStore.js';
import {
  createPersistedProfile,
  clearPersistedEnterpriseKeyState,
  clearPersistedProfileState,
  deletePersistedProfile,
  getStateVisibilitySummary,
  listPersistedProfiles,
  loadPersistedStateSnapshot,
  type PersistedProfileState,
  type PersistedProfilesSummary,
  updatePersistedProfileState,
  usePersistedProfile,
} from './state/sessionState.js';

export type TextWriter = {
  write(chunk: string): void;
};

export type CliIo = {
  stdout: TextWriter;
  stderr: TextWriter;
};

export const EXIT_CODE_SUCCESS = 0;
export const EXIT_CODE_VALIDATION = 2;
export const EXIT_CODE_AUTH = 3;
export const EXIT_CODE_CONFIRM = 4;
export const EXIT_CODE_NETWORK = 5;
export const EXIT_CODE_FLUX_FAILURE = 6;

type OutputMode = 'json' | 'pretty' | 'raw';

type FailureKind = 'validation' | 'auth' | 'confirm' | 'network' | 'flux';

type ToolDefinition = {
  name: string;
  description?: string;
  inputSchema?: unknown;
};

type ToolContentItem = {
  type: string;
  text?: string;
  uri?: string;
  name?: string;
  description?: string;
  mimeType?: string;
};

type ToolCallResult = {
  content: ToolContentItem[];
  structuredContent?: Record<string, unknown>;
  isError: boolean;
};

export type ToolRuntime = {
  listTools(): Promise<ToolDefinition[]>;
  callTool(name: string, rawArgs: unknown): Promise<ToolCallResult>;
  readResource?(uri: string): Promise<{ uri: string; mimeType?: string; text: string } | null>;
  hydrateResource?(resource: { uri: string; name: string; description?: string; mimeType?: string; text: string }): Promise<void>;
};

export type RunCliOptions = {
  io?: CliIo;
  toolRuntime?: ToolRuntime;
  persistedStateMode?: 'auto' | 'on' | 'off';
};

type ToolCatalogEntry = {
  name: string;
  description: string | null;
  inputSchema?: unknown;
};

type ToolCallEnvelope = {
  ok: boolean;
  status: string | number;
  tool: string;
  result: unknown;
  error?: string;
  resourceUri?: string;
  nextActions?: unknown[];
};

type ToolCallNormalization = {
  envelope: ToolCallEnvelope;
  failureKind?: FailureKind;
  rawResult: ToolCallResult;
};

const HELP_TEXT = `FluxOS CLI

Usage:
  flux [command]

Commands:
  help                           Show this help output
  tool list [--json|--pretty|--raw]
                                 List callable Flux tools
  tool call <tool-name> [--json|--pretty|--raw] [--arg key=value ...]
                                 [--args-json '{...}'] [--args-file path.json]
                                 Execute a Flux tool through the shared runtime
  resource list [--json|--pretty]
                                 List persisted CLI resources
  resource read <uri> [--json|--pretty|--raw]
                                 Read a persisted CLI resource payload
  resource prune [--json|--pretty] [--clear-all]
                                 Prune expired/overflow resources or clear all
  state show [--json|--pretty]
                                 Show persisted CLI session state for the active profile
  state clear [--json|--pretty]
                                 Reset persisted CLI session state for the active profile
  profile list [--json|--pretty]
                                 List persisted CLI profiles and show which one is active
  profile create <name> [--json|--pretty]
                                 Create a persisted CLI profile
  profile use <name> [--json|--pretty]
                                 Switch to a persisted CLI profile
  profile delete <name> [--json|--pretty]
                                 Delete a persisted CLI profile
  auth login --zelid <zelid> [--signature <sig>] [--login-phrase <phrase>]
                                 Run phrase-first auth or verify and persist auth
  auth status [--json|--pretty]
                                 Show current auth/base-url session status
  auth logout [--json|--pretty]
                                 Remove persisted auth material for the active profile
  auth clear [--json|--pretty]
                                 Remove persisted auth material for the active profile
  enterprise-key clear [--json|--pretty]
                                 Remove the persisted enterprise key for the active profile

Options:
  -h, --help  Show this help output

Package:
  fluxos-cli (Node.js 20+ TypeScript ESM package)
`;

const TOOL_HELP_TEXT = `FluxOS CLI - tool

Usage:
  flux tool list [--json|--pretty|--raw]
  flux tool call <tool-name> [--json|--pretty|--raw] [--arg key=value ...]
  flux tool call <tool-name> [--json|--pretty|--raw] [--args-json '{...}']
  flux tool call <tool-name> [--json|--pretty|--raw] [--args-file path.json]

Notes:
  - Use one argument mode per invocation: repeated --arg, --args-json, or --args-file.
  - --json prints the normalized CLI envelope, --pretty prints a human summary,
    and --raw prints the raw tool payload without CLI wrapping.
`;

const RESOURCE_HELP_TEXT = `FluxOS CLI - resource

Usage:
  flux resource list [--json|--pretty]
  flux resource read <uri> [--json|--pretty|--raw]
  flux resource prune [--json|--pretty] [--clear-all]

Notes:
  - Resources are persisted on disk for reuse across fresh CLI invocations.
  - JSON resources are re-read as structured values in --json mode.
  - --clear-all removes all persisted CLI resources explicitly.
`;

const STATE_HELP_TEXT = `FluxOS CLI - state

Usage:
  flux state show [--json|--pretty]
  flux state clear [--json|--pretty]

Notes:
  - State is persisted per active CLI profile under the configured state directory.
  - JSON mode shows redacted auth and enterprise-key summaries only.
`;

const PROFILE_HELP_TEXT = `FluxOS CLI - profile

Usage:
  flux profile list [--json|--pretty]
  flux profile create <name> [--json|--pretty]
  flux profile use <name> [--json|--pretty]
  flux profile delete <name> [--json|--pretty]

Notes:
  - Profiles isolate saved base URL, auth, enterprise key, FluxDrive URL, and HTTP defaults.
  - The default profile always exists and cannot be deleted.
`;

const AUTH_HELP_TEXT = `FluxOS CLI - auth

Usage:
  flux auth login --zelid <zelid> [--signature <sig>] [--login-phrase <phrase>]
                  [--gateway-base-url <url>] [--force] [--use-emergency-phrase]
                  [--json|--pretty|--raw]
  flux auth status [--json|--pretty|--raw]
  flux auth logout [--json|--pretty]
  flux auth clear [--json|--pretty]

Notes:
  - \`login\` preserves the shared phrase-first auth semantics from flux-mcp.
  - \`status\` is read-only and reports the hydrated session summary for the active profile.
  - \`logout\` and \`clear\` clear only persisted auth material for the active profile.
  - Base URL, enterprise key, HTTP defaults, and FluxDrive settings stay unchanged.
`;

const ENTERPRISE_KEY_HELP_TEXT = `FluxOS CLI - enterprise-key

Usage:
  flux enterprise-key clear [--json|--pretty]

Notes:
  - Clears only the persisted enterprise key for the active profile.
  - Base URL, auth, HTTP defaults, and FluxDrive settings stay unchanged.
`;

function writeLine(writer: TextWriter, text: string) {
  writer.write(text.endsWith('\n') ? text : `${text}\n`);
}

export function renderHelp(): string {
  return HELP_TEXT;
}

function renderToolHelp(): string {
  return TOOL_HELP_TEXT;
}

function renderResourceHelp(): string {
  return RESOURCE_HELP_TEXT;
}

function renderStateHelp(): string {
  return STATE_HELP_TEXT;
}

function renderProfileHelp(): string {
  return PROFILE_HELP_TEXT;
}

function renderAuthHelp(): string {
  return AUTH_HELP_TEXT;
}

function renderEnterpriseKeyHelp(): string {
  return ENTERPRISE_KEY_HELP_TEXT;
}

function isHelpFlag(value: string | undefined): boolean {
  return value === 'help' || value === '--help' || value === '-h';
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  return value as Record<string, unknown>;
}

function isJsonLikeOutputMode(outputMode: OutputMode): boolean {
  return outputMode === 'json' || outputMode === 'raw';
}

function parseJsonText(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function isJsonMimeType(mimeType: string | undefined): boolean {
  if (!mimeType) return false;
  const normalized = mimeType.toLowerCase();
  return normalized === 'application/json' || normalized.endsWith('+json') || normalized.includes('/json');
}

function parseLooseValue(text: string): unknown {
  const trimmed = text.trim();
  if (trimmed.length === 0) return '';

  try {
    return JSON.parse(trimmed);
  } catch {
    return text;
  }
}

function parseJsonObject(text: string, label: string): Record<string, unknown> {
  let parsed: unknown;

  try {
    parsed = JSON.parse(text);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Invalid JSON for ${label}: ${message}`);
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`${label} must decode to a JSON object.`);
  }

  return parsed as Record<string, unknown>;
}

function resolveOutputModePreference(requested: { json: boolean; pretty: boolean; raw: boolean }): OutputMode {
  if (requested.json) return 'json';
  if (requested.raw) return 'raw';
  return 'pretty';
}

function parseOutputMode(args: string[]): { outputMode: OutputMode; positional: string[] } | { outputMode: OutputMode; error: string } {
  const requested = { json: false, pretty: false, raw: false };
  const positional: string[] = [];

  for (const arg of args) {
    if (arg === '--json') {
      requested.json = true;
      continue;
    }

    if (arg === '--pretty') {
      requested.pretty = true;
      continue;
    }

    if (arg === '--raw') {
      requested.raw = true;
      continue;
    }

    positional.push(arg);
  }

  const outputMode = resolveOutputModePreference(requested);
  const selectedCount = Number(requested.json) + Number(requested.pretty) + Number(requested.raw);

  if (selectedCount > 1) {
    return { outputMode, error: 'Choose only one output mode: --json, --pretty, or --raw.' };
  }

  return { outputMode, positional };
}

async function parseToolArgs(
  args: string[]
): Promise<{ outputMode: OutputMode; rawArgs: Record<string, unknown>; positional: string[] } | { outputMode: OutputMode; error: string }> {
  const requested = { json: false, pretty: false, raw: false };
  const positional: string[] = [];
  const keyValueArgs: string[] = [];
  let argsJson: string | undefined;
  let argsFile: string | undefined;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];

    if (arg === '--json') {
      requested.json = true;
      continue;
    }

    if (arg === '--pretty') {
      requested.pretty = true;
      continue;
    }

    if (arg === '--raw') {
      requested.raw = true;
      continue;
    }

    if (arg === '--arg' || arg.startsWith('--arg=')) {
      const value = arg === '--arg' ? args[index + 1] : arg.slice('--arg='.length);
      if (arg === '--arg') index += 1;

      if (!value) {
        return { outputMode: resolveOutputModePreference(requested), error: 'Missing value for --arg. Expected key=value.' };
      }

      keyValueArgs.push(value);
      continue;
    }

    if (arg === '--args-json' || arg.startsWith('--args-json=')) {
      const value = arg === '--args-json' ? args[index + 1] : arg.slice('--args-json='.length);
      if (arg === '--args-json') index += 1;

      if (!value) {
        return { outputMode: resolveOutputModePreference(requested), error: 'Missing value for --args-json.' };
      }

      if (argsJson !== undefined) {
        return { outputMode: resolveOutputModePreference(requested), error: 'Provide --args-json only once per invocation.' };
      }

      argsJson = value;
      continue;
    }

    if (arg === '--args-file' || arg.startsWith('--args-file=')) {
      const value = arg === '--args-file' ? args[index + 1] : arg.slice('--args-file='.length);
      if (arg === '--args-file') index += 1;

      if (!value) {
        return { outputMode: resolveOutputModePreference(requested), error: 'Missing value for --args-file.' };
      }

      if (argsFile !== undefined) {
        return { outputMode: resolveOutputModePreference(requested), error: 'Provide --args-file only once per invocation.' };
      }

      argsFile = value;
      continue;
    }

    positional.push(arg);
  }

  const outputMode = resolveOutputModePreference(requested);
  const selectedOutputModes = Number(requested.json) + Number(requested.pretty) + Number(requested.raw);
  if (selectedOutputModes > 1) {
    return { outputMode, error: 'Choose only one output mode: --json, --pretty, or --raw.' };
  }

  const selectedArgModes = Number(keyValueArgs.length > 0) + Number(argsJson !== undefined) + Number(argsFile !== undefined);
  if (selectedArgModes > 1) {
    return { outputMode, error: 'Choose only one argument mode: --arg, --args-json, or --args-file.' };
  }

  try {
    if (argsJson !== undefined) {
      return { outputMode, rawArgs: parseJsonObject(argsJson, '--args-json'), positional };
    }

    if (argsFile !== undefined) {
      let fileText: string;
      try {
        fileText = await readFile(argsFile, 'utf8');
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return { outputMode, error: `Could not read --args-file ${argsFile}: ${message}` };
      }

      return { outputMode, rawArgs: parseJsonObject(fileText, `--args-file ${argsFile}`), positional };
    }

    const rawArgs: Record<string, unknown> = {};

    for (const pair of keyValueArgs) {
      const separatorIndex = pair.indexOf('=');
      if (separatorIndex <= 0) {
        return { outputMode, error: `Invalid --arg value \`${pair}\`. Expected key=value.` };
      }

      const key = pair.slice(0, separatorIndex).trim();
      const rawValue = pair.slice(separatorIndex + 1);

      if (!key) {
        return { outputMode, error: `Invalid --arg value \`${pair}\`. Expected key=value.` };
      }

      rawArgs[key] = parseLooseValue(rawValue);
    }

    return { outputMode, rawArgs, positional };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { outputMode, error: message };
  }
}

function renderJson(writer: TextWriter, value: unknown) {
  writeLine(writer, JSON.stringify(value, null, 2));
}

function isResourceLinkContent(item: ToolContentItem): item is ToolContentItem & {
  type: 'resource_link';
  uri: string;
  name?: string;
  description?: string;
  mimeType?: string;
} {
  return item.type === 'resource_link' && typeof item.uri === 'string' && item.uri.length > 0;
}

function looksLikeFluxRequestResult(value: unknown): value is Record<string, unknown> & { ok: boolean; status: number | string; data: unknown } {
  const record = asRecord(value);
  if (!record) return false;

  return typeof record.ok === 'boolean' && (typeof record.status === 'number' || typeof record.status === 'string') && 'data' in record;
}

function extractFluxEnvelopeError(value: unknown): string | undefined {
  const record = asRecord(value);
  if (!record) return undefined;

  const status = typeof record.status === 'string' ? record.status.toLowerCase() : undefined;
  if (!status || status === 'success') return undefined;

  const data = record.data;
  if (typeof data === 'string' && data.trim()) return data;

  const nested = asRecord(data);
  if (typeof nested?.message === 'string' && nested.message.trim()) return nested.message;

  return typeof record.status === 'string' ? record.status : undefined;
}

function stringifyFailureValue(value: unknown): string | undefined {
  if (typeof value === 'string' && value.trim()) return value;
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') {
    return String(value);
  }

  if (!value || typeof value !== 'object') return undefined;

  try {
    return JSON.stringify(value);
  } catch {
    return undefined;
  }
}

function extractFailedCheckMessage(record: Record<string, unknown>): string | undefined {
  const checks = record.checks;
  if (!Array.isArray(checks)) return undefined;

  for (const check of checks) {
    const checkRecord = asRecord(check);
    if (checkRecord?.ok !== false) continue;

    const checkName = typeof checkRecord.name === 'string' ? checkRecord.name.trim().toLowerCase() : '';
    const detailRecord = asRecord(checkRecord.detail);
    if (checkName === 'zelidauth' && detailRecord?.present === false) {
      return 'Authentication required (zelidauth not set).';
    }
  }

  for (const check of checks) {
    const checkRecord = asRecord(check);
    if (checkRecord?.ok !== false) continue;

    const detailEnvelopeError = extractFluxEnvelopeError(checkRecord.detail);
    if (detailEnvelopeError) return detailEnvelopeError;

    const detail = stringifyFailureValue(checkRecord.detail);
    if (detail) return detail;

    if (typeof checkRecord.name === 'string' && checkRecord.name.trim()) {
      return `${checkRecord.name} check failed.`;
    }
  }

  return undefined;
}

function extractNestedFailureMessage(record: Record<string, unknown>): string | undefined {
  const failures = record.failures;
  if (!Array.isArray(failures)) return undefined;

  for (const failure of failures) {
    const failureRecord = asRecord(failure);
    if (!failureRecord) continue;

    const message = stringifyFailureValue(failureRecord.error) ?? stringifyFailureValue(failureRecord.message);
    if (message) return message;
  }

  return undefined;
}

function hasNegativeEnvelopeFailure(value: unknown): boolean {
  const record = asRecord(value);
  return record?.ok === false;
}

function extractErrorMessage(value: unknown): string | undefined {
  if (typeof value === 'string' && value.trim()) return value;

  const record = asRecord(value);
  if (!record) return undefined;

  if (typeof record.error === 'string' && record.error.trim()) return record.error;
  if (typeof record.message === 'string' && record.message.trim()) return record.message;

  if (looksLikeFluxRequestResult(value)) {
    return extractFluxEnvelopeError(record.data) ?? (record.ok === false ? `Flux request failed with status ${String(record.status)}.` : undefined);
  }

  const detail = stringifyFailureValue(record.detail) ?? extractFailedCheckMessage(record) ?? extractNestedFailureMessage(record);
  if (detail) return detail;

  const envelopeError = extractFluxEnvelopeError(value);
  if (envelopeError) return envelopeError;

  if (record.ok === false) {
    return 'Flux tool execution failed.';
  }

  return undefined;
}

function hasFluxFailure(value: unknown): boolean {
  if (!looksLikeFluxRequestResult(value)) return false;

  if (value.ok === false) return true;
  return extractFluxEnvelopeError(value.data) !== undefined;
}

function classifyFailureKind(message: string): FailureKind {
  const lower = message.toLowerCase();

  if (
    lower.includes('authentication required') ||
    lower.includes('not authenticated') ||
    lower.includes('zelidauth not set') ||
    lower.includes('zelidauth is required') ||
    lower.includes('zelidauth required') ||
    lower.includes('requires zelidauth') ||
    lower.includes('requires authentication') ||
    lower.includes('auth required') ||
    lower.includes('unauthorized')
  ) {
    return 'auth';
  }

  if (lower.includes('confirm=true is required') || lower.includes('requires confirm=true') || lower.includes('confirm required')) {
    return 'confirm';
  }

  if (
    lower.includes('aborterror') ||
    lower.includes('timeout') ||
    lower.includes('fetch failed') ||
    lower.includes('network error') ||
    lower.includes('econnrefused') ||
    lower.includes('connection refused') ||
    lower.includes('ehostunreach') ||
    lower.includes('host unreachable') ||
    lower.includes('enotfound') ||
    lower.includes('host not found') ||
    lower.includes('request failed after retries') ||
    lower.includes('econnreset') ||
    lower.includes('timed out')
  ) {
    return 'network';
  }

  if (
    lower.startsWith('unknown tool:') ||
    lower.includes(' must be ') ||
    lower.includes('must match') ||
    lower.includes('must start with') ||
    lower.includes('choose only one') ||
    lower.includes('unexpected arguments') ||
    lower.includes('invalid json') ||
    lower.includes('could not read --args-file') ||
    lower.includes('resource not found') ||
    lower.includes('base url not set') ||
    lower.includes('no baseurl available') ||
    lower.includes('did not contain valid json') ||
    lower.includes('json must be an object') ||
    lower.startsWith('usage:') ||
    lower.startsWith('invalid --arg value') ||
    lower.startsWith('missing value for --arg') ||
    lower.startsWith('missing value for --args-json') ||
    lower.startsWith('missing value for --args-file') ||
    lower.startsWith('provide --args-json only once') ||
    lower.startsWith('provide --args-file only once') ||
    lower.startsWith('unsupported ')
  ) {
    return 'validation';
  }

  return 'flux';
}

function failureStatus(kind: FailureKind): string {
  switch (kind) {
    case 'validation':
      return 'validation_error';
    case 'auth':
      return 'auth_required';
    case 'confirm':
      return 'confirm_required';
    case 'network':
      return 'network_error';
    case 'flux':
      return 'flux_error';
  }
}

function exitCodeForFailureKind(kind: FailureKind): number {
  switch (kind) {
    case 'validation':
      return EXIT_CODE_VALIDATION;
    case 'auth':
      return EXIT_CODE_AUTH;
    case 'confirm':
      return EXIT_CODE_CONFIRM;
    case 'network':
      return EXIT_CODE_NETWORK;
    case 'flux':
      return EXIT_CODE_FLUX_FAILURE;
  }
}

function buildFailurePayload(kind: FailureKind, message: string, tool?: string) {
  return {
    ok: false,
    status: failureStatus(kind),
    ...(tool ? { tool } : {}),
    error: message,
  };
}

function normalizeToolCatalogEntry(tool: ToolDefinition): ToolCatalogEntry {
  return {
    name: tool.name,
    description: typeof tool.description === 'string' ? tool.description : null,
    inputSchema: tool.inputSchema,
  };
}

function renderToolCatalogPretty(tools: ToolCatalogEntry[]): string {
  if (tools.length === 0) {
    return 'Flux tool catalog is empty.';
  }

  return [
    `Flux tool catalog (${tools.length})`,
    ...tools.map((tool) => `- ${tool.name}${tool.description ? ` — ${tool.description}` : ''}`),
  ].join('\n');
}

function readFirstTextContent(content: ToolContentItem[]): unknown {
  const firstText = content.find((item) => item.type === 'text' && typeof item.text === 'string');
  if (!firstText || typeof firstText.text !== 'string') return undefined;
  return parseJsonText(firstText.text);
}

function extractResourceUri(content: ToolContentItem[], result: unknown): string | undefined {
  const record = asRecord(result);
  const fromResult = record?.resourceUri;
  if (typeof fromResult === 'string' && fromResult.length > 0) return fromResult;

  const link = content.find((item) => item.type === 'resource_link' && typeof item.uri === 'string');
  return typeof link?.uri === 'string' && link.uri.length > 0 ? link.uri : undefined;
}

function extractNextActions(result: unknown): unknown[] | undefined {
  const value = asRecord(result)?.nextActions;
  return Array.isArray(value) ? value : undefined;
}

function deriveSuccessStatus(result: unknown): string | number {
  const record = asRecord(result);

  if (!looksLikeFluxRequestResult(result) && (typeof record?.status === 'string' || typeof record?.status === 'number')) {
    return record.status;
  }

  if (looksLikeFluxRequestResult(result)) {
    const requestRecord = result as Record<string, unknown>;
    const nestedStatus = asRecord(requestRecord.data)?.status;
    if (typeof nestedStatus === 'string' || typeof nestedStatus === 'number') return nestedStatus;
  }

  return 'ok';
}

function normalizeToolCall(toolName: string, toolResult: ToolCallResult): ToolCallNormalization {
  const result = toolResult.structuredContent ?? readFirstTextContent(toolResult.content) ?? null;
  const explicitFailure = toolResult.isError === true || hasNegativeEnvelopeFailure(result) || hasFluxFailure(result);
  const error = explicitFailure ? extractErrorMessage(result) ?? 'Flux tool execution failed.' : undefined;
  const failureKind = explicitFailure && error ? classifyFailureKind(error) : undefined;
  const ok = failureKind === undefined;
  const status = ok ? deriveSuccessStatus(result) : failureStatus(failureKind ?? 'flux');
  const resourceUri = extractResourceUri(toolResult.content, result);
  const nextActions = extractNextActions(result);

  return {
    envelope: {
      ok,
      status,
      tool: toolName,
      result,
      ...(error ? { error } : {}),
      ...(resourceUri ? { resourceUri } : {}),
      ...(nextActions ? { nextActions } : {}),
    },
    ...(failureKind ? { failureKind } : {}),
    rawResult: toolResult,
  };
}

function renderToolCallPretty(envelope: ToolCallEnvelope): string {
  const lines = [`Tool: ${envelope.tool}`, `Status: ${String(envelope.status)}`, `OK: ${String(envelope.ok)}`];

  if (envelope.error) {
    lines.push(`Error: ${envelope.error}`);
  }

  if (envelope.resourceUri) {
    lines.push(`Resource URI: ${envelope.resourceUri}`);
  }

  if (envelope.nextActions && envelope.nextActions.length > 0) {
    lines.push('Next actions:');
    for (const action of envelope.nextActions) {
      lines.push(`- ${JSON.stringify(action)}`);
    }
  }

  lines.push('Result:');
  lines.push(typeof envelope.result === 'string' ? envelope.result : JSON.stringify(envelope.result, null, 2));

  return lines.join('\n');
}

function emitFailure(kind: FailureKind, message: string, io: CliIo, outputMode: OutputMode, tool?: string): number {
  if (isJsonLikeOutputMode(outputMode)) {
    renderJson(io.stdout, buildFailurePayload(kind, message, tool));
  } else {
    writeLine(io.stderr, message);
  }

  return exitCodeForFailureKind(kind);
}

async function getDefaultToolRuntime(): Promise<ToolRuntime> {
  const module = (await import('./runtime/toolRuntime.js')) as { createDefaultToolRuntime(): ToolRuntime };
  return module.createDefaultToolRuntime();
}

function normalizeBaseUrl(url: string): string {
  const parsed = new URL(url);
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('Base URL must start with http:// or https://');
  }

  return url.replace(/\/+$/, '');
}

async function executeToolCall(
  toolName: string,
  rawArgs: Record<string, unknown>,
  toolRuntime: ToolRuntime,
  mode: RunCliOptions['persistedStateMode']
): Promise<ToolCallNormalization> {
  await hydratePersistedSessionState(toolRuntime, mode);
  await hydratePersistedResourceArguments(rawArgs, toolRuntime);

  const rawResult = await toolRuntime.callTool(toolName, rawArgs);
  await persistMutatedSessionState(toolName, rawArgs, rawResult, mode);
  await persistToolResources(rawResult, toolRuntime);

  return normalizeToolCall(toolName, rawResult);
}

function shouldPersistState(mode: RunCliOptions['persistedStateMode']): boolean {
  return mode !== 'off';
}

async function hydratePersistedSessionState(toolRuntime: ToolRuntime, mode: RunCliOptions['persistedStateMode']): Promise<void> {
  if (!shouldPersistState(mode)) return;

  const snapshot = await loadPersistedStateSnapshot();
  const profile = snapshot.profile;

  await toolRuntime.callTool('flux_clear_zelidauth', {});
  await toolRuntime.callTool('flux_clear_enterprise_key', {});

  if (profile.baseUrl) {
    await toolRuntime.callTool('flux_set_base_url', { baseUrl: profile.baseUrl });
  }

  await toolRuntime.callTool('flux_set_http_defaults', profile.httpDefaults);
  await toolRuntime.callTool('flux_fluxdrive_set_base_url', { baseUrl: profile.fluxDriveMwsBaseUrl });

  if (profile.zelidauth) {
    let value: unknown = profile.zelidauth;
    try {
      value = JSON.parse(profile.zelidauth);
    } catch {
      value = profile.zelidauth;
    }

    await toolRuntime.callTool('flux_set_zelidauth', { zelidauth: value });
  }

  if (profile.enterpriseKey) {
    await toolRuntime.callTool('flux_set_enterprise_key', { enterpriseKey: profile.enterpriseKey });
  }
}

async function persistMutatedSessionState(
  toolName: string,
  rawArgs: Record<string, unknown>,
  rawResult: ToolCallResult,
  mode: RunCliOptions['persistedStateMode']
): Promise<void> {
  if (!shouldPersistState(mode)) return;

  const normalized = normalizeToolCall(toolName, rawResult);
  if (!normalized.envelope.ok) return;

  switch (toolName) {
    case 'flux_set_base_url': {
      const baseUrl = typeof rawArgs.baseUrl === 'string' ? rawArgs.baseUrl.trim() : '';
      if (!baseUrl) return;

      await updatePersistedProfileState((current) => ({
        ...current,
        baseUrl: normalizeBaseUrl(baseUrl),
      }));
      return;
    }

    case 'flux_set_http_defaults': {
      await updatePersistedProfileState((current) => ({
        ...current,
        httpDefaults: {
          timeoutMs: typeof rawArgs.timeoutMs === 'number' ? rawArgs.timeoutMs : current.httpDefaults.timeoutMs,
          retryCount: typeof rawArgs.retryCount === 'number' ? rawArgs.retryCount : current.httpDefaults.retryCount,
          retryBackoffMs:
            typeof rawArgs.retryBackoffMs === 'number' ? rawArgs.retryBackoffMs : current.httpDefaults.retryBackoffMs,
        },
      }));
      return;
    }

    case 'flux_set_zelidauth': {
      const rawValue = rawArgs.zelidauth;
      if (typeof rawValue !== 'string' && (!rawValue || typeof rawValue !== 'object' || Array.isArray(rawValue))) return;
      const serialized = typeof rawValue === 'string' ? rawValue : JSON.stringify(rawValue);

      await updatePersistedProfileState((current) => ({
        ...current,
        zelidauth: serialized,
      }));
      return;
    }

    case 'flux_clear_zelidauth': {
      await updatePersistedProfileState((current) => ({
        ...current,
        zelidauth: null,
      }));
      return;
    }

    case 'flux_auth_login': {
      const result = asRecord(normalized.envelope.result);
      if (!result || result.needSignature === true) return;

      const zelidauthSet = result.zelidauthSet === true;
      const alreadyAuthenticated = result.alreadyAuthenticated === true;
      if (!zelidauthSet && !alreadyAuthenticated) return;

      const baseUrl = typeof result.baseUrl === 'string' && result.baseUrl.trim() ? normalizeBaseUrl(result.baseUrl) : null;
      const zelid = typeof rawArgs.zelid === 'string' ? rawArgs.zelid.trim() : '';
      const signature = typeof rawArgs.signature === 'string' ? rawArgs.signature.trim() : '';
      const loginPhrase = typeof rawArgs.loginPhrase === 'string' ? rawArgs.loginPhrase.trim() : '';

      await updatePersistedProfileState((current) => ({
        ...current,
        ...(baseUrl ? { baseUrl } : {}),
        ...(zelidauthSet && zelid && signature && loginPhrase
          ? { zelidauth: JSON.stringify({ zelid, signature, loginPhrase }) }
          : {}),
      }));
      return;
    }

    case 'flux_set_enterprise_key': {
      const enterpriseKey = typeof rawArgs.enterpriseKey === 'string' ? rawArgs.enterpriseKey.trim() : '';
      if (!enterpriseKey) return;

      await updatePersistedProfileState((current) => ({
        ...current,
        enterpriseKey,
      }));
      return;
    }

    case 'flux_clear_enterprise_key': {
      await updatePersistedProfileState((current) => ({
        ...current,
        enterpriseKey: null,
      }));
      return;
    }

    case 'flux_fluxdrive_set_base_url': {
      const baseUrl = typeof rawArgs.baseUrl === 'string' ? rawArgs.baseUrl.trim() : '';
      if (!baseUrl) return;

      await updatePersistedProfileState((current) => ({
        ...current,
        fluxDriveMwsBaseUrl: normalizeBaseUrl(baseUrl),
      }));
      return;
    }
  }
}

async function hydratePersistedResourceArguments(rawArgs: Record<string, unknown>, toolRuntime: ToolRuntime): Promise<void> {
  if (typeof toolRuntime.hydrateResource !== 'function') return;

  const hydratedUris = new Set<string>();

  for (const [key, value] of Object.entries(rawArgs)) {
    if (!key.toLowerCase().endsWith('resourceuri') || typeof value !== 'string' || hydratedUris.has(value)) continue;

    const persisted = await readCliResource(value);
    if (!persisted) continue;

    hydratedUris.add(value);
    await toolRuntime.hydrateResource({
      uri: persisted.uri,
      name: persisted.name,
      description: persisted.description,
      mimeType: persisted.mimeType,
      text: persisted.text,
    });
  }
}

async function persistToolResources(rawResult: ToolCallResult, toolRuntime: ToolRuntime): Promise<void> {
  if (typeof toolRuntime.readResource !== 'function') return;

  const resourceLinks = rawResult.content.filter(isResourceLinkContent);
  for (const link of resourceLinks) {
    const contents = await toolRuntime.readResource(link.uri);
    if (!contents) continue;

    await persistCliResource({
      descriptor: {
        uri: link.uri,
        name: link.name ?? link.uri,
        description: link.description,
        mimeType: link.mimeType,
      },
      contents,
    });
  }
}

async function handleToolList(args: string[], io: CliIo, toolRuntime: ToolRuntime): Promise<number> {
  const parsed = parseOutputMode(args);
  if ('error' in parsed) {
    return emitFailure('validation', parsed.error, io, parsed.outputMode);
  }

  if (parsed.positional.length > 0) {
    return emitFailure('validation', `Unexpected arguments for \`flux tool list\`: ${parsed.positional.join(' ')}`, io, parsed.outputMode);
  }

  const tools = (await toolRuntime.listTools()).map(normalizeToolCatalogEntry).sort((left, right) => left.name.localeCompare(right.name));
  const payload = {
    ok: true,
    status: 'ok',
    count: tools.length,
    tools,
  };

  if (parsed.outputMode === 'json' || parsed.outputMode === 'raw') {
    renderJson(io.stdout, payload);
  } else {
    writeLine(io.stdout, renderToolCatalogPretty(tools));
  }

  return EXIT_CODE_SUCCESS;
}

async function handleToolCall(
  args: string[],
  io: CliIo,
  toolRuntime: ToolRuntime,
  mode: RunCliOptions['persistedStateMode']
): Promise<number> {
  const [toolName, ...rest] = args;

  if (!toolName || toolName.startsWith('-')) {
    const parsed = parseOutputMode(args);
    const outputMode = parsed.outputMode;
    return emitFailure(
      'validation',
      'Usage: flux tool call <tool-name> [--json|--pretty|--raw] [--arg key=value ...|--args-json {...}|--args-file path.json]',
      io,
      outputMode
    );
  }

  const parsed = await parseToolArgs(rest);
  if ('error' in parsed) {
    return emitFailure('validation', parsed.error, io, parsed.outputMode, toolName);
  }

  if (parsed.positional.length > 0) {
    return emitFailure('validation', `Unexpected arguments for \`flux tool call\`: ${parsed.positional.join(' ')}`, io, parsed.outputMode, toolName);
  }

  let normalized: ToolCallNormalization;
  try {
    normalized = await executeToolCall(toolName, parsed.rawArgs, toolRuntime, mode);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return emitFailure(classifyFailureKind(message), message, io, parsed.outputMode, toolName);
  }

  const exitCode = normalized.failureKind ? exitCodeForFailureKind(normalized.failureKind) : EXIT_CODE_SUCCESS;

  if (parsed.outputMode === 'json') {
    renderJson(io.stdout, normalized.envelope);
    return exitCode;
  }

  if (parsed.outputMode === 'raw') {
    renderJson(io.stdout, normalized.rawResult);
    return exitCode;
  }

  const writer = normalized.envelope.ok ? io.stdout : io.stderr;
  writeLine(writer, renderToolCallPretty(normalized.envelope));
  return exitCode;
}

function renderResourceListPretty(resources: Array<CliResourceDescriptor & { createdAtMs: number; expiresAtMs: number; sizeBytes: number }>): string {
  if (resources.length === 0) return 'No persisted CLI resources.';

  return [
    `Persisted CLI resources (${resources.length})`,
    ...resources.map((resource) => {
      const extras = [resource.mimeType ?? 'text/plain', `${resource.sizeBytes} bytes`].join(' · ');
      return `- ${resource.uri} — ${resource.name} (${extras})`;
    }),
  ].join('\n');
}

function parseStoredResourceValue(text: string, mimeType?: string): unknown {
  if (!isJsonMimeType(mimeType)) return text;

  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

async function handleResourceList(args: string[], io: CliIo): Promise<number> {
  const parsed = parseOutputMode(args);
  if ('error' in parsed) {
    return emitFailure('validation', parsed.error, io, parsed.outputMode);
  }

  if (parsed.positional.length > 0) {
    return emitFailure('validation', `Unexpected arguments for \`flux resource list\`: ${parsed.positional.join(' ')}`, io, parsed.outputMode);
  }

  const resources = await listCliResources();
  const payload = {
    ok: true,
    status: 'ok',
    count: resources.length,
    resources: resources.map((resource) => ({
      ...resource,
      persistent: true,
    })),
  };

  if (parsed.outputMode === 'json' || parsed.outputMode === 'raw') {
    renderJson(io.stdout, payload);
  } else {
    writeLine(io.stdout, renderResourceListPretty(resources));
  }

  return EXIT_CODE_SUCCESS;
}

async function handleResourceRead(args: string[], io: CliIo): Promise<number> {
  const [uri, ...rest] = args;
  if (!uri || uri.startsWith('-')) {
    const parsed = parseOutputMode(args);
    return emitFailure('validation', 'Usage: flux resource read <uri> [--json|--pretty|--raw]', io, parsed.outputMode);
  }

  const parsed = parseOutputMode(rest);
  if ('error' in parsed) {
    return emitFailure('validation', parsed.error, io, parsed.outputMode);
  }

  if (parsed.positional.length > 0) {
    return emitFailure('validation', `Unexpected arguments for \`flux resource read\`: ${parsed.positional.join(' ')}`, io, parsed.outputMode);
  }

  const resource = await readCliResource(uri);
  if (!resource) {
    return emitFailure('validation', `Resource not found: ${uri}`, io, parsed.outputMode);
  }

  const value = parseStoredResourceValue(resource.text, resource.mimeType);
  const payload = {
    ok: true,
    status: 'ok',
    resource: {
      uri: resource.uri,
      name: resource.name,
      description: resource.description,
      mimeType: resource.mimeType ?? 'text/plain',
      createdAtMs: resource.createdAtMs,
      expiresAtMs: resource.expiresAtMs,
      sizeBytes: resource.sizeBytes,
      persistent: true,
    },
    contents: {
      text: resource.text,
      ...(isJsonMimeType(resource.mimeType) ? { value } : {}),
    },
  };

  if (parsed.outputMode === 'json') {
    renderJson(io.stdout, payload);
    return EXIT_CODE_SUCCESS;
  }

  if (parsed.outputMode === 'raw') {
    io.stdout.write(resource.text);
    return EXIT_CODE_SUCCESS;
  }

  const prettyLines = [
    `Resource: ${resource.uri}`,
    `Name: ${resource.name}`,
    `MIME type: ${resource.mimeType ?? 'text/plain'}`,
    'Contents:',
    resource.text,
  ];
  writeLine(io.stdout, prettyLines.join('\n'));
  return EXIT_CODE_SUCCESS;
}

async function handleResourcePrune(args: string[], io: CliIo): Promise<number> {
  let clearAll = false;
  const filteredArgs: string[] = [];

  for (const arg of args) {
    if (arg === '--clear-all') {
      clearAll = true;
      continue;
    }

    filteredArgs.push(arg);
  }

  const parsed = parseOutputMode(filteredArgs);
  if ('error' in parsed) {
    return emitFailure('validation', parsed.error, io, parsed.outputMode);
  }

  if (parsed.positional.length > 0) {
    return emitFailure('validation', `Unexpected arguments for \`flux resource prune\`: ${parsed.positional.join(' ')}`, io, parsed.outputMode);
  }

  const payload:
    | ({ ok: true; status: 'ok'; action: 'clearAll' } & ResourceClearResult)
    | ({ ok: true; status: 'ok'; action: 'prune' } & ResourcePruneResult) = clearAll
    ? { ok: true, status: 'ok', action: 'clearAll', ...(await clearCliResources()) }
    : { ok: true, status: 'ok', action: 'prune', ...(await pruneCliResources()) };

  if (parsed.outputMode === 'json' || parsed.outputMode === 'raw') {
    renderJson(io.stdout, payload);
  } else {
    if (payload.action === 'clearAll') {
      writeLine(io.stdout, `Cleared ${payload.before} persisted CLI resources.`);
    } else {
      writeLine(
        io.stdout,
        `Pruned persisted CLI resources: before=${payload.before}, after=${payload.after}, expired=${payload.removedExpired}, overflow=${payload.removedOverflow}`
      );
    }
  }

  return EXIT_CODE_SUCCESS;
}

async function handleResourceCommand(args: string[], io: CliIo): Promise<number> {
  if (args.length === 0 || isHelpFlag(args[0])) {
    writeLine(io.stdout, renderResourceHelp());
    return EXIT_CODE_SUCCESS;
  }

  const [subcommand, ...rest] = args;
  switch (subcommand) {
    case 'list':
      return handleResourceList(rest, io);
    case 'read':
      return handleResourceRead(rest, io);
    case 'prune':
      return handleResourcePrune(rest, io);
    default: {
      const parsed = parseOutputMode(rest);
      return emitFailure('validation', `Unknown resource subcommand: ${subcommand}`, io, parsed.outputMode);
    }
  }
}

function renderStatePretty(state: Awaited<ReturnType<typeof getStateVisibilitySummary>>): string {
  return [
    `Active profile: ${state.activeProfile}`,
    `Base URL: ${state.baseUrl ?? '<unset>'}`,
    `Auth: ${state.auth.present ? `present${state.auth.zelid ? ` (zelid: ${state.auth.zelid})` : ''}` : 'not set'}`,
    `Enterprise key: ${state.enterpriseKey.present ? 'present' : 'not set'}`,
    `FluxDrive base URL: ${state.fluxDriveMwsBaseUrl}`,
    `HTTP defaults: timeoutMs=${state.httpDefaults.timeoutMs}, retryCount=${state.httpDefaults.retryCount}, retryBackoffMs=${state.httpDefaults.retryBackoffMs}`,
    `State dir: ${state.paths.stateDir}`,
    `State file: ${state.paths.stateFile}`,
    `Resource store file: ${state.paths.resourceStoreFile}`,
  ].join('\n');
}

async function handleStateShow(args: string[], io: CliIo): Promise<number> {
  const parsed = parseOutputMode(args);
  if ('error' in parsed) {
    return emitFailure('validation', parsed.error, io, parsed.outputMode);
  }

  if (parsed.positional.length > 0) {
    return emitFailure('validation', `Unexpected arguments for \`flux state show\`: ${parsed.positional.join(' ')}`, io, parsed.outputMode);
  }

  const state = await getStateVisibilitySummary();
  const payload = {
    ok: true,
    status: 'ok',
    state,
  };

  if (parsed.outputMode === 'json' || parsed.outputMode === 'raw') {
    renderJson(io.stdout, payload);
  } else {
    writeLine(io.stdout, renderStatePretty(state));
  }

  return EXIT_CODE_SUCCESS;
}

async function handleStateClear(args: string[], io: CliIo): Promise<number> {
  const parsed = parseOutputMode(args);
  if ('error' in parsed) {
    return emitFailure('validation', parsed.error, io, parsed.outputMode);
  }

  if (parsed.positional.length > 0) {
    return emitFailure('validation', `Unexpected arguments for \`flux state clear\`: ${parsed.positional.join(' ')}`, io, parsed.outputMode);
  }

  await clearPersistedProfileState();
  const state = await getStateVisibilitySummary();
  const payload = {
    ok: true,
    status: 'ok',
    action: 'clear',
    state,
  };

  if (parsed.outputMode === 'json' || parsed.outputMode === 'raw') {
    renderJson(io.stdout, payload);
  } else {
    writeLine(io.stdout, `Cleared persisted state for profile ${state.activeProfile}.`);
  }

  return EXIT_CODE_SUCCESS;
}

type AuthLoginParseResult =
  | {
      outputMode: OutputMode;
      rawArgs: Record<string, unknown>;
      positional: string[];
    }
  | { outputMode: OutputMode; error: string };

function readFlagValue(
  args: string[],
  index: number,
  arg: string,
  flagName: string
): { value: string; nextIndex: number } | { error: string } {
  if (arg === flagName) {
    const value = args[index + 1];
    if (!value) {
      return { error: `Missing value for ${flagName}.` };
    }

    return { value, nextIndex: index + 1 };
  }

  const prefix = `${flagName}=`;
  const value = arg.slice(prefix.length);
  if (!value) {
    return { error: `Missing value for ${flagName}.` };
  }

  return { value, nextIndex: index };
}

function parseAuthLoginArgs(args: string[]): AuthLoginParseResult {
  const requested = { json: false, pretty: false, raw: false };
  const positional: string[] = [];
  const rawArgs: Record<string, unknown> = {
    verify: true,
    setZelidauth: true,
    checkPrivilege: true,
    autoPinGateway: true,
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];

    if (arg === '--json') {
      requested.json = true;
      continue;
    }

    if (arg === '--pretty') {
      requested.pretty = true;
      continue;
    }

    if (arg === '--raw') {
      requested.raw = true;
      continue;
    }

    if (arg === '--force') {
      rawArgs.force = true;
      continue;
    }

    if (arg === '--use-emergency-phrase') {
      rawArgs.useEmergencyPhrase = true;
      continue;
    }

    if (arg === '--zelid' || arg.startsWith('--zelid=')) {
      const value = readFlagValue(args, index, arg, '--zelid');
      if ('error' in value) {
        return { outputMode: resolveOutputModePreference(requested), error: value.error };
      }

      rawArgs.zelid = value.value;
      index = value.nextIndex;
      continue;
    }

    if (arg === '--signature' || arg.startsWith('--signature=')) {
      const value = readFlagValue(args, index, arg, '--signature');
      if ('error' in value) {
        return { outputMode: resolveOutputModePreference(requested), error: value.error };
      }

      rawArgs.signature = value.value;
      index = value.nextIndex;
      continue;
    }

    if (arg === '--login-phrase' || arg.startsWith('--login-phrase=')) {
      const value = readFlagValue(args, index, arg, '--login-phrase');
      if ('error' in value) {
        return { outputMode: resolveOutputModePreference(requested), error: value.error };
      }

      rawArgs.loginPhrase = value.value;
      index = value.nextIndex;
      continue;
    }

    if (arg === '--gateway-base-url' || arg.startsWith('--gateway-base-url=')) {
      const value = readFlagValue(args, index, arg, '--gateway-base-url');
      if ('error' in value) {
        return { outputMode: resolveOutputModePreference(requested), error: value.error };
      }

      rawArgs.gatewayBaseUrl = value.value;
      index = value.nextIndex;
      continue;
    }

    positional.push(arg);
  }

  const outputMode = resolveOutputModePreference(requested);
  const selectedOutputModes = Number(requested.json) + Number(requested.pretty) + Number(requested.raw);
  if (selectedOutputModes > 1) {
    return { outputMode, error: 'Choose only one output mode: --json, --pretty, or --raw.' };
  }

  const zelid = typeof rawArgs.zelid === 'string' ? rawArgs.zelid.trim() : '';
  if (!zelid) {
    return {
      outputMode,
      error:
        'Usage: flux auth login --zelid <zelid> [--signature <sig>] [--login-phrase <phrase>] [--gateway-base-url <url>] [--force] [--use-emergency-phrase] [--json|--pretty|--raw]',
    };
  }

  return {
    outputMode,
    rawArgs: {
      ...rawArgs,
      zelid,
      ...(typeof rawArgs.signature === 'string' ? { signature: rawArgs.signature.trim() } : {}),
      ...(typeof rawArgs.loginPhrase === 'string' ? { loginPhrase: rawArgs.loginPhrase } : {}),
      ...(typeof rawArgs.gatewayBaseUrl === 'string' ? { gatewayBaseUrl: rawArgs.gatewayBaseUrl.trim() } : {}),
    },
    positional,
  };
}

function mergeAuthLoginPayload(normalized: ToolCallNormalization, activeProfile: string): Record<string, unknown> {
  const result = asRecord(normalized.envelope.result) ?? {};

  return {
    ...result,
    ok: normalized.envelope.ok,
    status:
      typeof result.status === 'string' || typeof result.status === 'number'
        ? result.status
        : normalized.envelope.ok
          ? 'ok'
          : normalized.envelope.status,
    activeProfile,
    ...(normalized.envelope.resourceUri && result.resourceUri === undefined ? { resourceUri: normalized.envelope.resourceUri } : {}),
    ...(normalized.envelope.nextActions && result.nextActions === undefined ? { nextActions: normalized.envelope.nextActions } : {}),
  };
}

function renderAuthLoginPretty(payload: Record<string, unknown>): string {
  const lines: string[] = [];
  const zelid = typeof payload.zelid === 'string' ? payload.zelid : '<unknown>';
  const baseUrl = typeof payload.baseUrl === 'string' ? payload.baseUrl : null;
  const activeProfile = typeof payload.activeProfile === 'string' ? payload.activeProfile : null;

  if (payload.needSignature === true) {
    lines.push(`Login phrase ready for ${zelid}.`);
    if (activeProfile) lines.push(`Active profile: ${activeProfile}`);
    if (typeof payload.pinnedBaseUrl === 'string' && payload.pinnedBaseUrl) {
      lines.push(`Pinned base URL: ${payload.pinnedBaseUrl}`);
    }
    if (typeof payload.gatewayBaseUrl === 'string' && payload.gatewayBaseUrl) {
      lines.push(`Gateway base URL: ${payload.gatewayBaseUrl}`);
    }
    if (typeof payload.loginPhrase === 'string' && payload.loginPhrase) {
      lines.push('Login phrase:');
      lines.push(payload.loginPhrase);
    }
    if (typeof payload.signLauncherHttpUrl === 'string' && payload.signLauncherHttpUrl) {
      lines.push(`Sign launcher: ${payload.signLauncherHttpUrl}`);
    }
    if (typeof payload.zelcoreLauncherHttpUrl === 'string' && payload.zelcoreLauncherHttpUrl) {
      lines.push(`Zelcore launcher: ${payload.zelcoreLauncherHttpUrl}`);
    }
    if (typeof payload.zelcoreSignLink === 'string' && payload.zelcoreSignLink) {
      lines.push(`Zelcore sign link: ${payload.zelcoreSignLink}`);
    }

    return lines.join('\n');
  }

  lines.push(payload.alreadyAuthenticated === true ? `Already authenticated as ${zelid}.` : `Authenticated as ${zelid}.`);
  if (activeProfile) lines.push(`Active profile: ${activeProfile}`);
  lines.push(`Base URL: ${baseUrl ?? '<unset>'}`);

  if (typeof payload.privilege === 'string' && payload.privilege) {
    lines.push(`Privilege: ${payload.privilege}`);
  }

  return lines.join('\n');
}

function normalizeAuthStatusPayload(result: unknown, activeProfile: string): Record<string, unknown> {
  const record = asRecord(result) ?? {};

  return {
    ok: true,
    status: 'ok',
    activeProfile,
    baseUrl: typeof record.baseUrl === 'string' ? record.baseUrl : null,
    auth: asRecord(record.zelidauth) ?? { present: false },
    ...(record.zelidauthCache !== undefined ? { authCache: record.zelidauthCache } : {}),
    ...(record.enterpriseKey !== undefined ? { enterpriseKey: record.enterpriseKey } : {}),
    ...(record.fluxDriveMwsBaseUrl !== undefined ? { fluxDriveMwsBaseUrl: record.fluxDriveMwsBaseUrl } : {}),
    ...(record.httpDefaults !== undefined ? { httpDefaults: record.httpDefaults } : {}),
  };
}

function renderAuthStatusPretty(payload: Record<string, unknown>): string {
  const auth = asRecord(payload.auth);
  return [
    `Active profile: ${typeof payload.activeProfile === 'string' ? payload.activeProfile : '<unknown>'}`,
    `Base URL: ${typeof payload.baseUrl === 'string' ? payload.baseUrl : '<unset>'}`,
    `Auth: ${auth?.present === true ? `present${typeof auth.zelid === 'string' ? ` (zelid: ${auth.zelid})` : ''}` : 'not set'}`,
  ].join('\n');
}

async function handleAuthLogin(
  args: string[],
  io: CliIo,
  toolRuntime: ToolRuntime,
  mode: RunCliOptions['persistedStateMode']
): Promise<number> {
  const parsed = parseAuthLoginArgs(args);
  if ('error' in parsed) {
    return emitFailure('validation', parsed.error, io, parsed.outputMode);
  }

  if (parsed.positional.length > 0) {
    return emitFailure('validation', `Unexpected arguments for \`flux auth login\`: ${parsed.positional.join(' ')}`, io, parsed.outputMode);
  }

  let normalized: ToolCallNormalization;
  try {
    normalized = await executeToolCall('flux_auth_login', parsed.rawArgs, toolRuntime, mode);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return emitFailure(classifyFailureKind(message), message, io, parsed.outputMode);
  }

  if (!normalized.envelope.ok) {
    return emitFailure(normalized.failureKind ?? 'flux', normalized.envelope.error ?? 'Flux auth login failed.', io, parsed.outputMode);
  }

  const snapshot = await loadPersistedStateSnapshot();
  const payload = mergeAuthLoginPayload(normalized, snapshot.activeProfile);

  if (parsed.outputMode === 'json' || parsed.outputMode === 'raw') {
    renderJson(io.stdout, payload);
  } else {
    writeLine(io.stdout, renderAuthLoginPretty(payload));
  }

  return EXIT_CODE_SUCCESS;
}

async function handleAuthStatus(
  args: string[],
  io: CliIo,
  toolRuntime: ToolRuntime,
  mode: RunCliOptions['persistedStateMode']
): Promise<number> {
  const parsed = parseOutputMode(args);
  if ('error' in parsed) {
    return emitFailure('validation', parsed.error, io, parsed.outputMode);
  }

  if (parsed.positional.length > 0) {
    return emitFailure('validation', `Unexpected arguments for \`flux auth status\`: ${parsed.positional.join(' ')}`, io, parsed.outputMode);
  }

  let normalized: ToolCallNormalization;
  try {
    normalized = await executeToolCall('flux_get_state', {}, toolRuntime, mode);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return emitFailure(classifyFailureKind(message), message, io, parsed.outputMode);
  }

  if (!normalized.envelope.ok) {
    return emitFailure(normalized.failureKind ?? 'flux', normalized.envelope.error ?? 'Could not read auth status.', io, parsed.outputMode);
  }

  const snapshot = await loadPersistedStateSnapshot();
  const payload = normalizeAuthStatusPayload(normalized.envelope.result, snapshot.activeProfile);

  if (parsed.outputMode === 'json' || parsed.outputMode === 'raw') {
    renderJson(io.stdout, payload);
  } else {
    writeLine(io.stdout, renderAuthStatusPretty(payload));
  }

  return EXIT_CODE_SUCCESS;
}

async function handleAuthSessionClear(
  args: string[],
  io: CliIo,
  toolRuntime: ToolRuntime,
  mode: RunCliOptions['persistedStateMode'],
  action: 'clear' | 'logout'
): Promise<number> {
  const parsed = parseOutputMode(args);
  if ('error' in parsed) {
    return emitFailure('validation', parsed.error, io, parsed.outputMode);
  }

  if (parsed.positional.length > 0) {
    return emitFailure('validation', `Unexpected arguments for \`flux auth ${action}\`: ${parsed.positional.join(' ')}`, io, parsed.outputMode);
  }

  try {
    const normalized = await executeToolCall('flux_clear_zelidauth', {}, toolRuntime, mode);
    if (!normalized.envelope.ok) {
      return emitFailure(
        normalized.failureKind ?? 'flux',
        normalized.envelope.error ?? 'Could not clear auth state.',
        io,
        parsed.outputMode
      );
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return emitFailure(classifyFailureKind(message), message, io, parsed.outputMode);
  }

  const state = await getStateVisibilitySummary();
  const payload = {
    ok: true,
    status: 'ok',
    action,
    target: 'auth',
    state,
  };

  if (parsed.outputMode === 'json' || parsed.outputMode === 'raw') {
    renderJson(io.stdout, payload);
  } else {
    writeLine(io.stdout, `${action === 'logout' ? 'Logged out' : 'Cleared persisted auth'} for profile ${state.activeProfile}.`);
  }

  return EXIT_CODE_SUCCESS;
}

async function handleAuthClear(
  args: string[],
  io: CliIo,
  toolRuntime: ToolRuntime,
  mode: RunCliOptions['persistedStateMode']
): Promise<number> {
  return handleAuthSessionClear(args, io, toolRuntime, mode, 'clear');
}

async function handleAuthCommand(
  args: string[],
  io: CliIo,
  toolRuntime: ToolRuntime,
  mode: RunCliOptions['persistedStateMode']
): Promise<number> {
  if (args.length === 0 || isHelpFlag(args[0])) {
    writeLine(io.stdout, renderAuthHelp());
    return EXIT_CODE_SUCCESS;
  }

  const [subcommand, ...rest] = args;

  switch (subcommand) {
    case 'login':
      return handleAuthLogin(rest, io, toolRuntime, mode);
    case 'status':
      return handleAuthStatus(rest, io, toolRuntime, mode);
    case 'logout':
      return handleAuthSessionClear(rest, io, toolRuntime, mode, 'logout');
    case 'clear':
      return handleAuthClear(rest, io, toolRuntime, mode);
    default: {
      const parsed = parseOutputMode(rest);
      return emitFailure('validation', `Unknown auth subcommand: ${subcommand}`, io, parsed.outputMode);
    }
  }
}

async function handleEnterpriseKeyClear(args: string[], io: CliIo): Promise<number> {
  const parsed = parseOutputMode(args);
  if ('error' in parsed) {
    return emitFailure('validation', parsed.error, io, parsed.outputMode);
  }

  if (parsed.positional.length > 0) {
    return emitFailure(
      'validation',
      `Unexpected arguments for \`flux enterprise-key clear\`: ${parsed.positional.join(' ')}`,
      io,
      parsed.outputMode
    );
  }

  await clearPersistedEnterpriseKeyState();
  const state = await getStateVisibilitySummary();
  const payload = {
    ok: true,
    status: 'ok',
    action: 'clear',
    target: 'enterprise-key',
    state,
  };

  if (parsed.outputMode === 'json' || parsed.outputMode === 'raw') {
    renderJson(io.stdout, payload);
  } else {
    writeLine(io.stdout, `Cleared persisted enterprise key for profile ${state.activeProfile}.`);
  }

  return EXIT_CODE_SUCCESS;
}

async function handleEnterpriseKeyCommand(args: string[], io: CliIo): Promise<number> {
  if (args.length === 0 || isHelpFlag(args[0])) {
    writeLine(io.stdout, renderEnterpriseKeyHelp());
    return EXIT_CODE_SUCCESS;
  }

  const [subcommand, ...rest] = args;

  switch (subcommand) {
    case 'clear':
      return handleEnterpriseKeyClear(rest, io);
    default: {
      const parsed = parseOutputMode(rest);
      return emitFailure('validation', `Unknown enterprise-key subcommand: ${subcommand}`, io, parsed.outputMode);
    }
  }
}

async function handleStateCommand(args: string[], io: CliIo): Promise<number> {
  if (args.length === 0 || isHelpFlag(args[0])) {
    writeLine(io.stdout, renderStateHelp());
    return EXIT_CODE_SUCCESS;
  }

  const [subcommand, ...rest] = args;

  switch (subcommand) {
    case 'show':
      return handleStateShow(rest, io);
    case 'clear':
      return handleStateClear(rest, io);
    default: {
      const parsed = parseOutputMode(rest);
      return emitFailure('validation', `Unknown state subcommand: ${subcommand}`, io, parsed.outputMode);
    }
  }
}

function renderProfileListPretty(summary: PersistedProfilesSummary): string {
  return [
    `Persisted CLI profiles (${summary.profiles.length})`,
    `Active profile: ${summary.activeProfile}`,
    ...summary.profiles.map((profile) => {
      const parts = [
        `${profile.active ? '*' : '-'} ${profile.name}`,
        `baseUrl=${profile.baseUrl ?? '<unset>'}`,
        `auth=${profile.auth.present ? 'present' : 'not set'}`,
        `enterpriseKey=${profile.enterpriseKey.present ? 'present' : 'not set'}`,
        `fluxDrive=${profile.fluxDriveMwsBaseUrl}`,
        `httpDefaults=${profile.httpDefaults.timeoutMs}/${profile.httpDefaults.retryCount}/${profile.httpDefaults.retryBackoffMs}`,
      ];

      return parts.join(' · ');
    }),
  ].join('\n');
}

async function handleProfileList(args: string[], io: CliIo): Promise<number> {
  const parsed = parseOutputMode(args);
  if ('error' in parsed) {
    return emitFailure('validation', parsed.error, io, parsed.outputMode);
  }

  if (parsed.positional.length > 0) {
    return emitFailure('validation', `Unexpected arguments for \`flux profile list\`: ${parsed.positional.join(' ')}`, io, parsed.outputMode);
  }

  const summary = await listPersistedProfiles();
  const payload = {
    ok: true,
    status: 'ok',
    count: summary.profiles.length,
    activeProfile: summary.activeProfile,
    profiles: summary.profiles,
  };

  if (parsed.outputMode === 'json' || parsed.outputMode === 'raw') {
    renderJson(io.stdout, payload);
  } else {
    writeLine(io.stdout, renderProfileListPretty(summary));
  }

  return EXIT_CODE_SUCCESS;
}

async function handleProfileCreate(args: string[], io: CliIo): Promise<number> {
  const [profileName, ...rest] = args;
  if (!profileName || profileName.startsWith('-')) {
    const parsed = parseOutputMode(args);
    return emitFailure('validation', 'Usage: flux profile create <name> [--json|--pretty]', io, parsed.outputMode);
  }

  const parsed = parseOutputMode(rest);
  if ('error' in parsed) {
    return emitFailure('validation', parsed.error, io, parsed.outputMode);
  }

  if (parsed.positional.length > 0) {
    return emitFailure('validation', `Unexpected arguments for \`flux profile create\`: ${parsed.positional.join(' ')}`, io, parsed.outputMode);
  }

  try {
    const result = await createPersistedProfile(profileName);
    const payload = {
      ok: true,
      status: 'ok',
      action: 'create',
      activeProfile: result.activeProfile,
      profile: result.profile,
    };

    if (parsed.outputMode === 'json' || parsed.outputMode === 'raw') {
      renderJson(io.stdout, payload);
    } else {
      writeLine(io.stdout, `Created profile ${result.profile.name}. Active profile remains ${result.activeProfile}.`);
    }

    return EXIT_CODE_SUCCESS;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return emitFailure('validation', message, io, parsed.outputMode);
  }
}

async function handleProfileUse(args: string[], io: CliIo): Promise<number> {
  const [profileName, ...rest] = args;
  if (!profileName || profileName.startsWith('-')) {
    const parsed = parseOutputMode(args);
    return emitFailure('validation', 'Usage: flux profile use <name> [--json|--pretty]', io, parsed.outputMode);
  }

  const parsed = parseOutputMode(rest);
  if ('error' in parsed) {
    return emitFailure('validation', parsed.error, io, parsed.outputMode);
  }

  if (parsed.positional.length > 0) {
    return emitFailure('validation', `Unexpected arguments for \`flux profile use\`: ${parsed.positional.join(' ')}`, io, parsed.outputMode);
  }

  try {
    const result = await usePersistedProfile(profileName);
    const payload = {
      ok: true,
      status: 'ok',
      action: 'use',
      activeProfile: result.activeProfile,
      profile: result.profile,
    };

    if (parsed.outputMode === 'json' || parsed.outputMode === 'raw') {
      renderJson(io.stdout, payload);
    } else {
      writeLine(io.stdout, `Switched active profile to ${result.activeProfile}.`);
    }

    return EXIT_CODE_SUCCESS;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return emitFailure('validation', message, io, parsed.outputMode);
  }
}

async function handleProfileDelete(args: string[], io: CliIo): Promise<number> {
  const [profileName, ...rest] = args;
  if (!profileName || profileName.startsWith('-')) {
    const parsed = parseOutputMode(args);
    return emitFailure('validation', 'Usage: flux profile delete <name> [--json|--pretty]', io, parsed.outputMode);
  }

  const parsed = parseOutputMode(rest);
  if ('error' in parsed) {
    return emitFailure('validation', parsed.error, io, parsed.outputMode);
  }

  if (parsed.positional.length > 0) {
    return emitFailure('validation', `Unexpected arguments for \`flux profile delete\`: ${parsed.positional.join(' ')}`, io, parsed.outputMode);
  }

  try {
    const result = await deletePersistedProfile(profileName);
    const payload = {
      ok: true,
      status: 'ok',
      action: 'delete',
      deletedProfile: result.deletedProfile,
      deletedWasActive: result.deletedWasActive,
      activeProfile: result.activeProfile,
    };

    if (parsed.outputMode === 'json' || parsed.outputMode === 'raw') {
      renderJson(io.stdout, payload);
    } else {
      writeLine(
        io.stdout,
        result.deletedWasActive
          ? `Deleted active profile ${result.deletedProfile}; switched to ${result.activeProfile}.`
          : `Deleted profile ${result.deletedProfile}. Active profile remains ${result.activeProfile}.`
      );
    }

    return EXIT_CODE_SUCCESS;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return emitFailure('validation', message, io, parsed.outputMode);
  }
}

async function handleProfileCommand(args: string[], io: CliIo): Promise<number> {
  if (args.length === 0 || isHelpFlag(args[0])) {
    writeLine(io.stdout, renderProfileHelp());
    return EXIT_CODE_SUCCESS;
  }

  const [subcommand, ...rest] = args;

  switch (subcommand) {
    case 'list':
      return handleProfileList(rest, io);
    case 'create':
      return handleProfileCreate(rest, io);
    case 'use':
      return handleProfileUse(rest, io);
    case 'delete':
      return handleProfileDelete(rest, io);
    default: {
      const parsed = parseOutputMode(rest);
      return emitFailure('validation', `Unknown profile subcommand: ${subcommand}`, io, parsed.outputMode);
    }
  }
}

async function handleToolCommand(
  args: string[],
  io: CliIo,
  toolRuntime: ToolRuntime,
  mode: RunCliOptions['persistedStateMode']
): Promise<number> {
  if (args.length === 0 || isHelpFlag(args[0])) {
    writeLine(io.stdout, renderToolHelp());
    return EXIT_CODE_SUCCESS;
  }

  const [subcommand, ...rest] = args;

  switch (subcommand) {
    case 'list':
      return handleToolList(rest, io, toolRuntime);
    case 'call':
      return handleToolCall(rest, io, toolRuntime, mode);
    default: {
      const parsed = parseOutputMode(rest);
      return emitFailure('validation', `Unknown tool subcommand: ${subcommand}`, io, parsed.outputMode);
    }
  }
}

export async function runCli(argv: string[], options: RunCliOptions = {}): Promise<number> {
  const io = options.io ?? { stdout: process.stdout, stderr: process.stderr };
  const effectivePersistedStateMode = options.persistedStateMode ?? (options.toolRuntime ? 'off' : 'auto');

  if (argv.length === 0 || isHelpFlag(argv[0])) {
    writeLine(io.stdout, renderHelp());
    return EXIT_CODE_SUCCESS;
  }

  const [command] = argv;

  try {
    switch (command) {
      case 'tool': {
        const toolRuntime = options.toolRuntime ?? (await getDefaultToolRuntime());
        return await handleToolCommand(argv.slice(1), io, toolRuntime, effectivePersistedStateMode);
      }
      case 'resource':
        return await handleResourceCommand(argv.slice(1), io);
      case 'state':
        return await handleStateCommand(argv.slice(1), io);
      case 'profile':
        return await handleProfileCommand(argv.slice(1), io);
      case 'auth':
        return await handleAuthCommand(
          argv.slice(1),
          io,
          options.toolRuntime ?? (await getDefaultToolRuntime()),
          effectivePersistedStateMode
        );
      case 'enterprise-key':
        return await handleEnterpriseKeyCommand(argv.slice(1), io);
      default:
        writeLine(io.stderr, `Unknown command: ${command}`);
        writeLine(io.stderr, '');
        writeLine(io.stderr, renderHelp());
        return EXIT_CODE_VALIDATION;
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    writeLine(io.stderr, `flux failed: ${message}`);
    return EXIT_CODE_FLUX_FAILURE;
  }
}
