import type { ResourceDescriptor } from './resources.js';
import type { MarkdownTableRowValue } from './markdownTable.js';
import { renderMarkdownTable } from './markdownTable.js';

export type ToolNextAction = { tool: string; arguments: Record<string, unknown> };

export type ToolSummaryBase = {
  ok: boolean;
  status?: string;
  count?: number;
  shown?: number;
  resourceUri?: string;
  nextActions?: ToolNextAction[];
};

export function buildTableResult(opts: {
  headers: string[];
  rows: MarkdownTableRowValue[][];
  maxRows?: number;
  summary: ToolSummaryBase & Record<string, unknown>;
  resource?: ResourceDescriptor;
}): {
  content: Array<{ type: 'text'; text: string } | ({ type: 'resource_link' } & ResourceDescriptor)>;
  structuredContent: Record<string, unknown>;
  isError: boolean;
} {
  const { table, shown } = renderMarkdownTable({
    headers: opts.headers,
    rows: opts.rows,
    maxRows: opts.maxRows,
  });

  const summary = {
    ...opts.summary,
    shown,
    resourceUri: opts.resource?.uri ?? (opts.summary.resourceUri ?? null),
    status: opts.summary.status ?? (opts.summary.ok === true ? 'ok' : 'error'),
  };

  const content: Array<{ type: 'text'; text: string } | ({ type: 'resource_link' } & ResourceDescriptor)> = [
    { type: 'text', text: table },
    { type: 'text', text: `\n\n${JSON.stringify(summary, null, 2)}` },
  ];

  if (opts.resource) content.push({ type: 'resource_link', ...opts.resource });

  return {
    content,
    structuredContent: summary,
    isError: summary.ok !== true,
  };
}
