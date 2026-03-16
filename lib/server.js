#!/usr/bin/env node
/**
 * silo serve -- local HTTP server for the silo knowledge browser UI
 *
 * Two-column pack browser with search, import wizard, and SSE live updates.
 * Zero npm dependencies (node:http only).
 *
 * Usage:
 *   silo serve [--port 9095] [--root /path/to/repo]
 */

import { createServer } from 'node:http';
import { readFileSync, existsSync, readdirSync, writeFileSync } from 'node:fs';
import { join, resolve, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const __dirname = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

// ── Crash handlers ──
process.on('uncaughtException', (err) => {
  process.stderr.write(`[${new Date().toISOString()}] FATAL: ${err.stack || err}\n`);
  process.exit(1);
});
process.on('unhandledRejection', (reason) => {
  process.stderr.write(`[${new Date().toISOString()}] WARN unhandledRejection: ${reason}\n`);
});

const PUBLIC_DIR = join(__dirname, '..', 'public');
const PACKS_DIR = join(__dirname, '..', 'packs');

// ── CLI args ──────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
function arg(name, fallback) {
  const i = args.indexOf(`--${name}`);
  return i !== -1 && args[i + 1] ? args[i + 1] : fallback;
}

const PORT = parseInt(arg('port', '9095'), 10);
const ROOT = resolve(arg('root', process.cwd()));
const CORS_ORIGIN = arg('cors', null);

// ── Verbose logging ──────────────────────────────────────────────────────────

const verbose = process.argv.includes('--verbose') || process.argv.includes('-v');
function vlog(...a) {
  if (!verbose) return;
  const ts = new Date().toISOString();
  process.stderr.write(`[${ts}] silo: ${a.join(' ')}\n`);
}

// ── Routes manifest ──────────────────────────────────────────────────────────

const ROUTES = [
  { method: 'GET', path: '/events', description: 'SSE event stream for live updates' },
  { method: 'GET', path: '/api/packs', description: 'List all available knowledge packs' },
  { method: 'GET', path: '/api/packs/:name', description: 'Get pack details and claims by name' },
  { method: 'POST', path: '/api/import', description: 'Import a pack into a target claims file' },
  { method: 'GET', path: '/api/search', description: 'Search claims by ?q, ?type, ?evidence, ?limit' },
  { method: 'GET', path: '/api/docs', description: 'This API documentation page' },
];

// ── Load existing CJS modules via createRequire ──────────────────────────────

const { Store } = require('./store.js');
const { Search } = require('./search.js');
const { Packs } = require('./packs.js');
const { ImportExport } = require('./import-export.js');

const store = new Store();
const search = new Search(store);
const packs = new Packs(store);
const io = new ImportExport(store);

// ── State ─────────────────────────────────────────────────────────────────────

let state = {
  packs: [],
  searchResults: [],
};

const sseClients = new Set();

function broadcast(event) {
  const data = `data: ${JSON.stringify(event)}\n\n`;
  for (const res of sseClients) {
    try { res.write(data); } catch { sseClients.delete(res); }
  }
}

// ── Data loading ──────────────────────────────────────────────────────────────

function loadPacks() {
  return packs.list();
}

function refreshState() {
  state.packs = loadPacks();
  broadcast({ type: 'state', data: state });
}

// ── MIME types ────────────────────────────────────────────────────────────────

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function jsonResponse(res, code, data) {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(data));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', c => chunks.push(c));
    req.on('end', () => {
      try { resolve(JSON.parse(Buffer.concat(chunks).toString())); }
      catch (e) { reject(e); }
    });
    req.on('error', reject);
  });
}

// ── HTTP server ───────────────────────────────────────────────────────────────

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);

  // CORS (only when --cors is passed)
  if (CORS_ORIGIN) {
    res.setHeader('Access-Control-Allow-Origin', CORS_ORIGIN);
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  }

  if (req.method === 'OPTIONS' && CORS_ORIGIN) {
    res.writeHead(204);
    res.end();
    return;
  }

  vlog('request', req.method, url.pathname);

  // ── API: docs ──
  if (req.method === 'GET' && url.pathname === '/api/docs') {
    const html = `<!DOCTYPE html><html><head><title>silo API</title>
<style>body{font-family:system-ui;background:#0a0e1a;color:#e8ecf1;max-width:800px;margin:40px auto;padding:0 20px}
table{width:100%;border-collapse:collapse}th,td{padding:8px 12px;border-bottom:1px solid #1e293b;text-align:left}
th{color:#9ca3af}code{background:#1e293b;padding:2px 6px;border-radius:4px;font-size:13px}</style></head>
<body><h1>silo API</h1><p>${ROUTES.length} endpoints</p>
<table><tr><th>Method</th><th>Path</th><th>Description</th></tr>
${ROUTES.map(r => '<tr><td><code>'+r.method+'</code></td><td><code>'+r.path+'</code></td><td>'+r.description+'</td></tr>').join('')}
</table></body></html>`;
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(html);
    return;
  }

  // ── SSE endpoint ──
  if (req.method === 'GET' && url.pathname === '/events') {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    });
    res.write(`data: ${JSON.stringify({ type: 'state', data: state })}\n\n`);
    const heartbeat = setInterval(() => {
      try { res.write(': heartbeat\n\n'); } catch { clearInterval(heartbeat); }
    }, 15000);
    sseClients.add(res);
    vlog('sse', `client connected (${sseClients.size} total)`);
    req.on('close', () => { clearInterval(heartbeat); sseClients.delete(res); vlog('sse', `client disconnected (${sseClients.size} total)`); });
    return;
  }

  // ── API: list packs ──
  if (req.method === 'GET' && url.pathname === '/api/packs') {
    const packList = loadPacks();
    jsonResponse(res, 200, { packs: packList });
    return;
  }

  // ── API: get pack details ──
  if (req.method === 'GET' && url.pathname.startsWith('/api/packs/')) {
    const name = decodeURIComponent(url.pathname.slice('/api/packs/'.length));
    if (!name) { jsonResponse(res, 400, { error: 'missing pack name' }); return; }

    const pack = packs.get(name);
    if (!pack) { jsonResponse(res, 404, { error: `pack "${name}" not found` }); return; }

    jsonResponse(res, 200, {
      id: name,
      name: pack.name,
      description: pack.description,
      version: pack.version,
      claimCount: (pack.claims || []).length,
      claims: pack.claims || [],
    });
    return;
  }

  // ── API: import pack ──
  if (req.method === 'POST' && url.pathname === '/api/import') {
    try {
      const body = await readBody(req);
      const { pack: packName, targetDir } = body;
      if (!packName || !targetDir) {
        jsonResponse(res, 400, { error: 'missing pack or targetDir' });
        return;
      }

      const targetPath = resolve(targetDir, 'claims.json');
      // Ensure the target file exists
      if (!existsSync(targetPath)) {
        writeFileSync(targetPath, '[]', 'utf-8');
      }

      const result = io.pull(packName, targetPath);
      refreshState();
      jsonResponse(res, 200, {
        success: true,
        imported: result.imported,
        skippedDuplicates: result.skippedDuplicates,
        totalClaims: result.totalClaims,
      });
    } catch (err) {
      jsonResponse(res, 500, { error: err.message });
    }
    return;
  }

  // ── API: search ──
  if (req.method === 'GET' && url.pathname === '/api/search') {
    const q = url.searchParams.get('q') || '';
    const type = url.searchParams.get('type') || undefined;
    const evidence = url.searchParams.get('evidence') || undefined;
    const limit = parseInt(url.searchParams.get('limit') || '20', 10);

    if (!q) {
      jsonResponse(res, 200, { query: q, results: [] });
      return;
    }

    // Search built-in packs too
    const results = [];

    // Search silo store
    const storeResults = search.query(q, { type, evidence, limit });
    results.push(...storeResults);

    // Also search directly in packs/ directory
    if (existsSync(PACKS_DIR)) {
      for (const file of readdirSync(PACKS_DIR)) {
        if (!file.endsWith('.json')) continue;
        try {
          const data = JSON.parse(readFileSync(join(PACKS_DIR, file), 'utf-8'));
          const packName = data.name || file.replace('.json', '');
          for (const claim of data.claims || []) {
            if (type && claim.type !== type) continue;
            if (evidence && claim.evidence !== evidence) continue;
            const searchable = [
              claim.content || claim.text || '',
              claim.type || '',
              claim.topic || '',
              (claim.tags || []).join(' '),
            ].join(' ').toLowerCase();

            const tokens = q.toLowerCase().split(/\s+/).filter(t => t.length > 1);
            let score = 0;
            for (const token of tokens) {
              if (searchable.includes(token)) {
                score += 1;
                if (searchable.includes(` ${token} `) || searchable.startsWith(`${token} `)) {
                  score += 0.5;
                }
              }
            }
            if (score > 0) {
              results.push({ claim, collection: `pack:${packName}`, score });
            }
          }
        } catch { /* skip malformed */ }
      }
    }

    // Deduplicate by claim ID, keep highest score
    const seen = new Map();
    for (const r of results) {
      const key = r.claim.id || JSON.stringify(r.claim);
      if (!seen.has(key) || seen.get(key).score < r.score) {
        seen.set(key, r);
      }
    }

    const deduped = [...seen.values()]
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);

    jsonResponse(res, 200, { query: q, results: deduped });
    return;
  }

  // ── Static files ──
  let filePath = url.pathname === '/' ? '/index.html' : url.pathname;
  filePath = join(PUBLIC_DIR, filePath);

  if (existsSync(filePath)) {
    const ext = extname(filePath);
    const mime = MIME[ext] || 'application/octet-stream';
    try {
      const content = readFileSync(filePath);
      res.writeHead(200, { 'Content-Type': mime });
      res.end(content);
    } catch {
      res.writeHead(500);
      res.end('read error');
    }
    return;
  }

  // ── 404 ──
  res.writeHead(404, { 'Content-Type': 'text/plain' });
  res.end('not found');
});

// ── Graceful shutdown ─────────────────────────────────────────────────────────
const shutdown = (signal) => {
  console.log(`\nsilo: ${signal} received, shutting down...`);
  for (const res of sseClients) { try { res.end(); } catch {} }
  sseClients.clear();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 5000);
};
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

// ── Start ─────────────────────────────────────────────────────────────────────

refreshState();

server.listen(PORT, '127.0.0.1', () => {
  vlog('listen', `port=${PORT}`, `root=${ROOT}`);
  console.log(`silo: serving on http://localhost:${PORT}`);
  console.log(`  packs: ${state.packs.length} available`);
  console.log(`  root:  ${ROOT}`);
});

export { server, PORT };
