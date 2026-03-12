import { readFile } from 'node:fs/promises';

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
};

export type RunCliOptions = {
  io?: CliIo;
  toolRuntime?: ToolRuntime;
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

function writeLine(writer: TextWriter, text: string) {
  writer.write(text.endsWith('\n') ? text : `${text}\n`);
}

export function renderHelp(): string {
  return HELP_TEXT;
}

function renderToolHelp(): string {
  return TOOL_HELP_TEXT;
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

function extractErrorMessage(value: unknown): string | undefined {
  if (typeof value === 'string' && value.trim()) return value;

  const record = asRecord(value);
  if (!record) return undefined;

  if (typeof record.error === 'string' && record.error.trim()) return record.error;
  if (typeof record.message === 'string' && record.message.trim()) return record.message;

  if (looksLikeFluxRequestResult(value)) {
    return extractFluxEnvelopeError(record.data) ?? (record.ok === false ? `Flux request failed with status ${String(record.status)}.` : undefined);
  }

  return extractFluxEnvelopeError(value);
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
  const explicitFailure = toolResult.isError === true || hasFluxFailure(result);
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
  const module = (await import('./runtime/toolRuntime.js')) as { defaultToolRuntime: ToolRuntime };
  return module.defaultToolRuntime;
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

async function handleToolCall(args: string[], io: CliIo, toolRuntime: ToolRuntime): Promise<number> {
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
    normalized = normalizeToolCall(toolName, await toolRuntime.callTool(toolName, parsed.rawArgs));
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

async function handleToolCommand(args: string[], io: CliIo, toolRuntime: ToolRuntime): Promise<number> {
  if (args.length === 0 || isHelpFlag(args[0])) {
    writeLine(io.stdout, renderToolHelp());
    return EXIT_CODE_SUCCESS;
  }

  const [subcommand, ...rest] = args;

  switch (subcommand) {
    case 'list':
      return handleToolList(rest, io, toolRuntime);
    case 'call':
      return handleToolCall(rest, io, toolRuntime);
    default: {
      const parsed = parseOutputMode(rest);
      return emitFailure('validation', `Unknown tool subcommand: ${subcommand}`, io, parsed.outputMode);
    }
  }
}

export async function runCli(argv: string[], options: RunCliOptions = {}): Promise<number> {
  const io = options.io ?? { stdout: process.stdout, stderr: process.stderr };

  if (argv.length === 0 || isHelpFlag(argv[0])) {
    writeLine(io.stdout, renderHelp());
    return EXIT_CODE_SUCCESS;
  }

  const [command] = argv;

  try {
    switch (command) {
      case 'tool': {
        const toolRuntime = options.toolRuntime ?? (await getDefaultToolRuntime());
        return await handleToolCommand(argv.slice(1), io, toolRuntime);
      }
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
