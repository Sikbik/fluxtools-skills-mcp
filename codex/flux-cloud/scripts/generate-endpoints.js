#!/usr/bin/env node

/*
Generate endpoint inventory files from the public Flux repo.

Outputs:
- ../references/endpoints.json
- ../references/endpoints-inventory.md

Optional:
- --also-mcp : also writes ../../../flux-mcp/data/endpoints.json (if present)

Usage:
  node scripts/generate-endpoints.js [--ref master] [--also-mcp]
*/

const fs = require('fs');
const path = require('path');

function usage(exitCode = 1) {
  process.stderr.write('Usage: generate-endpoints.js [--ref master] [--also-mcp]\n');
  process.exit(exitCode);
}

function parseArgs(argv) {
  const args = {};
  for (let i = 2; i < argv.length; i += 1) {
    const key = argv[i];
    if (!key.startsWith('--')) continue;
    const name = key.slice(2);
    const value = argv[i + 1];
    if (!value || value.startsWith('--')) {
      args[name] = true;
    } else {
      args[name] = value;
      i += 1;
    }
  }
  return args;
}

function escapeMd(text) {
  return String(text ?? '').replace(/\|/g, '\\|').replace(/\n/g, ' ');
}

function extractRoutes(routesJsText) {
  const lines = routesJsText.split(/\r?\n/);

  const routes = [];
  let access = 'GET PUBLIC';

  const accessRe = /^\s*\/\/\s*(GET|POST)\s+(PUBLIC\b.*|PROTECTED\b.*)$/i;
  const routeRe = /\bapp\.(get|post|put|delete|patch)\(\s*(['"])([^'"\n]+)\2/;
  const cacheRe = /\bcache\('([^']+)'\)/;

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const accessMatch = line.match(accessRe);
    if (accessMatch) {
      access = `${accessMatch[1].toUpperCase()} ${accessMatch[2].trim()}`;
      continue;
    }

    const m = line.match(routeRe);
    if (!m) continue;

    const method = m[1].toUpperCase();
    const routePath = m[3];
    const category = routePath.replace(/^\/+/, '').split('/')[0] || '(root)';
    const commentIndex = line.indexOf('//');
    const comment = commentIndex === -1 ? '' : line.slice(commentIndex + 2).trim();
    const deprecated = /\bDEPREC/i.test(comment);
    const localOnly = /\bisLocal\b/.test(line);
    const cacheMatch = line.match(cacheRe);
    const cache = cacheMatch ? cacheMatch[1] : null;

    routes.push({
      method,
      path: routePath,
      category,
      access,
      cache,
      localOnly,
      deprecated,
      comment,
      source: { file: 'ZelBack/src/routes.js', line: i + 1 },
    });
  }

  return routes;
}

function toMarkdown({ generatedAt, ref, routes }) {
  const byCategory = new Map();
  const byAccess = new Map();

  for (const r of routes) {
    byCategory.set(r.category, (byCategory.get(r.category) || 0) + 1);
    byAccess.set(r.access, (byAccess.get(r.access) || 0) + 1);
  }

  const categoryOrder = [...byCategory.entries()].sort((a, b) => b[1] - a[1]);
  const accessOrder = [...byAccess.entries()].sort((a, b) => b[1] - a[1]);

  const out = [];
  out.push('# Flux Node API — Endpoint Inventory (Generated)');
  out.push('');
  out.push('Generated from:');
  out.push(`- Repo: \`https://github.com/RunOnFlux/flux\``);
  out.push(`- Ref: \`${ref}\``);
  out.push(`- File: \`ZelBack/src/routes.js\``);
  out.push(`- Generated: \`${generatedAt}\``);
  out.push('');
  out.push('## Summary');
  out.push('');
  out.push(`- Total routes: **${routes.length}**`);
  out.push('');
  out.push('### Categories');
  out.push('');
  for (const [cat, count] of categoryOrder) {
    out.push(`- \`${cat}\`: ${count}`);
  }
  out.push('');
  out.push('### Access sections (as labeled in `routes.js`)');
  out.push('');
  for (const [a, count] of accessOrder) {
    out.push(`- \`${a}\`: ${count}`);
  }
  out.push('');
  out.push('## Routes by category');
  out.push('');

  const routesByCategory = new Map();
  for (const r of routes) {
    if (!routesByCategory.has(r.category)) routesByCategory.set(r.category, []);
    routesByCategory.get(r.category).push(r);
  }

  for (const [cat] of categoryOrder) {
    const list = routesByCategory.get(cat) || [];
    list.sort((a, b) => a.path.localeCompare(b.path) || a.method.localeCompare(b.method));

    out.push('<details>');
    out.push(`<summary><strong>${cat} (${list.length})</strong></summary>`);
    out.push('');
    out.push('| Method | Path | Access | Cache | Local | Deprecated | Notes |');
    out.push('| --- | --- | --- | --- | --- | --- | --- |');
    for (const r of list) {
      out.push(
        `| ${escapeMd(r.method)} | \`${escapeMd(r.path)}\` | \`${escapeMd(r.access)}\` | ${r.cache ? `\`${escapeMd(r.cache)}\`` : ''} | ${r.localOnly ? 'yes' : ''} | ${r.deprecated ? 'yes' : ''} | ${escapeMd(r.comment)} |`
      );
    }
    out.push('');
    out.push('</details>');
    out.push('');
  }

  return out.join('\n');
}

async function main() {
  const args = parseArgs(process.argv);
  if (args.help) usage(0);

  const ref = typeof args.ref === 'string' ? args.ref : 'master';
  const alsoMcp = Boolean(args['also-mcp']);

  const url = `https://raw.githubusercontent.com/RunOnFlux/flux/${ref}/ZelBack/src/routes.js`;
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Failed to fetch routes.js (${res.status}): ${url}`);
  }

  const routesJs = await res.text();
  const routes = extractRoutes(routesJs);

  const generatedAt = new Date().toISOString();
  const payload = {
    generatedAt,
    sourceRef: ref,
    sourceFile: 'ZelBack/src/routes.js',
    routeCount: routes.length,
    routes,
  };

  const here = __dirname;
  const refsDir = path.resolve(here, '..', 'references');

  fs.mkdirSync(refsDir, { recursive: true });

  fs.writeFileSync(path.join(refsDir, 'endpoints.json'), JSON.stringify(payload, null, 2) + '\n', 'utf8');
  fs.writeFileSync(path.join(refsDir, 'endpoints-inventory.md'), toMarkdown({ generatedAt, ref, routes }) + '\n', 'utf8');

  if (alsoMcp) {
    const mcpDataDir = path.resolve(here, '..', '..', '..', 'flux-mcp', 'data');
    if (fs.existsSync(mcpDataDir)) {
      fs.mkdirSync(mcpDataDir, { recursive: true });
      fs.writeFileSync(path.join(mcpDataDir, 'endpoints.json'), JSON.stringify(payload, null, 2) + '\n', 'utf8');
    }
  }

  process.stderr.write(`Wrote ${routes.length} routes from ref=${ref}\n`);
}

main().catch((err) => {
  process.stderr.write(`${err?.message ?? String(err)}\n`);
  process.exit(1);
});
