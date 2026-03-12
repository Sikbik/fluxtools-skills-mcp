import fs from 'node:fs';

export function loadEndpointInventory(filePath) {
  if (!fs.existsSync(filePath)) return null;
  const raw = fs.readFileSync(filePath, 'utf8');
  const parsed = JSON.parse(raw);
  if (!parsed || !Array.isArray(parsed.routes)) return null;
  return parsed;
}

export function summarizeByCategory(routes) {
  const map = new Map();
  for (const route of routes) map.set(route.category, (map.get(route.category) || 0) + 1);
  return [...map.entries()].sort((a, b) => b[1] - a[1]).map(([category, count]) => ({ category, count }));
}

export function searchRoutes(routes, opts) {
  const q = (opts.query ?? '').trim().toLowerCase();
  const category = (opts.category ?? '').trim();
  const access = (opts.access ?? '').trim();
  const method = (opts.method ?? '').trim().toUpperCase();
  const limit = Math.max(1, Math.min(200, Number(opts.limit ?? 50)));

  const out = [];
  for (const route of routes) {
    if (category && route.category !== category) continue;
    if (access && route.access !== access) continue;
    if (method && route.method !== method) continue;

    if (q) {
      const hay = `${route.method} ${route.path} ${route.access} ${route.comment}`.toLowerCase();
      if (!hay.includes(q)) continue;
    }

    out.push(route);
    if (out.length >= limit) break;
  }

  return out;
}
