export type TextWriter = {
  write(chunk: string): void;
};

export type CliIo = {
  stdout: TextWriter;
  stderr: TextWriter;
};

export const EXIT_CODE_SUCCESS = 0;
export const EXIT_CODE_VALIDATION = 2;
export const EXIT_CODE_TOOL_FAILURE = 1;

type OutputMode = 'json' | 'pretty';

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

const HELP_TEXT = `FluxOS CLI

Usage:
  flux [command]

Commands:
  help                           Show this help output
  tool list [--json|--pretty]    List callable Flux tools
  tool call <tool-name> [--json|--pretty]
                                 Execute a Flux tool through the shared runtime

Options:
  -h, --help  Show this help output

Package:
  fluxos-cli (Node.js 20+ TypeScript ESM package)
`;

const TOOL_HELP_TEXT = `FluxOS CLI - tool

Usage:
  flux tool list [--json|--pretty]
  flux tool call <tool-name> [--json|--pretty]

Notes:
  - This slice supports tool listing and zero-argument tool invocation.
  - Argument ingestion flags land in a later roadmap slice.
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

function parseJsonText(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function parseOutputMode(args: string[]): { outputMode: OutputMode; positional: string[] } | { error: string } {
  let outputMode: OutputMode = 'pretty';
  let seenJson = false;
  let seenPretty = false;
  const positional: string[] = [];

  for (const arg of args) {
    if (arg === '--json') {
      seenJson = true;
      outputMode = 'json';
      continue;
    }

    if (arg === '--pretty') {
      seenPretty = true;
      outputMode = 'pretty';
      continue;
    }

    positional.push(arg);
  }

  if (seenJson && seenPretty) {
    return { error: 'Choose only one output mode: --json or --pretty.' };
  }

  return { outputMode, positional };
}

function renderJson(writer: TextWriter, value: unknown) {
  writeLine(writer, JSON.stringify(value, null, 2));
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

function normalizeToolCallEnvelope(toolName: string, toolResult: ToolCallResult): ToolCallEnvelope {
  const result = toolResult.structuredContent ?? readFirstTextContent(toolResult.content) ?? null;
  const record = asRecord(result);
  const ok = typeof record?.ok === 'boolean' ? record.ok : toolResult.isError !== true;
  const status = typeof record?.status === 'string' || typeof record?.status === 'number' ? record.status : ok ? 'ok' : 'error';
  const error = typeof record?.error === 'string' ? record.error : undefined;
  const resourceUri = extractResourceUri(toolResult.content, result);
  const nextActions = extractNextActions(result);

  return {
    ok,
    status,
    tool: toolName,
    result,
    ...(error ? { error } : {}),
    ...(resourceUri ? { resourceUri } : {}),
    ...(nextActions ? { nextActions } : {}),
  };
}

function renderToolCallPretty(envelope: ToolCallEnvelope): string {
  const lines = [`Tool: ${envelope.tool}`, `Status: ${String(envelope.status)}`, `OK: ${String(envelope.ok)}`];

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

function validationError(message: string, io: CliIo): number {
  writeLine(io.stderr, message);
  return EXIT_CODE_VALIDATION;
}

async function getDefaultToolRuntime(): Promise<ToolRuntime> {
  const module = (await import('./runtime/toolRuntime.js')) as { defaultToolRuntime: ToolRuntime };
  return module.defaultToolRuntime;
}

async function handleToolList(args: string[], io: CliIo, toolRuntime: ToolRuntime): Promise<number> {
  const parsed = parseOutputMode(args);
  if ('error' in parsed) {
    return validationError(parsed.error, io);
  }

  if (parsed.positional.length > 0) {
    return validationError(`Unexpected arguments for \`flux tool list\`: ${parsed.positional.join(' ')}`, io);
  }

  const tools = (await toolRuntime.listTools()).map(normalizeToolCatalogEntry).sort((left, right) => left.name.localeCompare(right.name));
  const payload = {
    ok: true,
    status: 'ok',
    count: tools.length,
    tools,
  };

  if (parsed.outputMode === 'json') {
    renderJson(io.stdout, payload);
  } else {
    writeLine(io.stdout, renderToolCatalogPretty(tools));
  }

  return EXIT_CODE_SUCCESS;
}

function classifyToolFailure(envelope: ToolCallEnvelope): number {
  if (typeof envelope.error === 'string' && envelope.error.startsWith('Unknown tool:')) {
    return EXIT_CODE_VALIDATION;
  }

  return EXIT_CODE_TOOL_FAILURE;
}

async function handleToolCall(args: string[], io: CliIo, toolRuntime: ToolRuntime): Promise<number> {
  const [toolName, ...rest] = args;

  if (!toolName || toolName.startsWith('-')) {
    return validationError('Usage: flux tool call <tool-name> [--json|--pretty]', io);
  }

  const parsed = parseOutputMode(rest);
  if ('error' in parsed) {
    return validationError(parsed.error, io);
  }

  if (parsed.positional.length > 0) {
    return validationError(
      `Unexpected arguments for \`flux tool call\`: ${parsed.positional.join(' ')}. Argument flags are added in a later slice.`,
      io
    );
  }

  const envelope = normalizeToolCallEnvelope(toolName, await toolRuntime.callTool(toolName, {}));
  const exitCode = envelope.ok ? EXIT_CODE_SUCCESS : classifyToolFailure(envelope);

  if (parsed.outputMode === 'json') {
    renderJson(io.stdout, envelope);
    return exitCode;
  }

  const writer = envelope.ok ? io.stdout : io.stderr;
  writeLine(writer, renderToolCallPretty(envelope));
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
    default:
      return validationError(`Unknown tool subcommand: ${subcommand}`, io);
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
    return EXIT_CODE_TOOL_FAILURE;
  }
}
