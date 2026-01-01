import fs from 'node:fs';

export type FluxRoute = {
  method: string;
  path: string;
  category: string;
  access: string;
  cache: string | null;
  localOnly: boolean;
  deprecated: boolean;
  comment: string;
  source?: { file: string; line: number };
};

export type FluxEndpointInventory = {
  generatedAt: string;
  sourceCommit?: string;
  sourceRef?: string;
  sourceFile: string;
  routeCount: number;
  routes: FluxRoute[];
};

export function loadEndpointInventory(filePath: string): FluxEndpointInventory | null {
  if (!fs.existsSync(filePath)) return null;
  const raw = fs.readFileSync(filePath, 'utf8');
  const parsed = JSON.parse(raw) as FluxEndpointInventory;
  if (!parsed || !Array.isArray(parsed.routes)) return null;
  return parsed;
}

export function summarizeByCategory(routes: FluxRoute[]) {
  const map = new Map<string, number>();
  for (const r of routes) map.set(r.category, (map.get(r.category) || 0) + 1);
  return [...map.entries()].sort((a, b) => b[1] - a[1]).map(([category, count]) => ({ category, count }));
}

export function searchRoutes(routes: FluxRoute[], opts: {
  query?: string;
  category?: string;
  access?: string;
  method?: string;
  limit?: number;
}) {
  const q = (opts.query ?? '').trim().toLowerCase();
  const category = (opts.category ?? '').trim();
  const access = (opts.access ?? '').trim();
  const method = (opts.method ?? '').trim().toUpperCase();
  const limit = Math.max(1, Math.min(200, Number(opts.limit ?? 50)));

  const out: FluxRoute[] = [];
  for (const r of routes) {
    if (category && r.category !== category) continue;
    if (access && r.access !== access) continue;
    if (method && r.method !== method) continue;

    if (q) {
      const hay = `${r.method} ${r.path} ${r.access} ${r.comment}`.toLowerCase();
      if (!hay.includes(q)) continue;
    }

    out.push(r);
    if (out.length >= limit) break;
  }

  return out;
}
