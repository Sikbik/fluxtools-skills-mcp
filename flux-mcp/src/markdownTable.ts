export type MarkdownTableRowValue = string | number | boolean | null | undefined;

export function renderMarkdownTable(opts: {
  headers: string[];
  rows: MarkdownTableRowValue[][];
  maxRows?: number;
}): { table: string; shown: number } {
  const headers = opts.headers;
  const maxRows = Math.max(1, Math.min(200, Math.floor(opts.maxRows ?? 50)));
  const rows = opts.rows.slice(0, maxRows);

  const escapeCell = (value: MarkdownTableRowValue): string => {
    const s = value === null || value === undefined ? '-' : String(value);
    return s.replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
  };

  const lines = [
    `| ${headers.map((h) => escapeCell(h)).join(' | ')} |`,
    `| ${headers.map(() => '---').join(' | ')} |`,
    ...rows.map((r) => `| ${r.map((c) => escapeCell(c)).join(' | ')} |`),
  ];

  return { table: lines.join('\n'), shown: rows.length };
}
