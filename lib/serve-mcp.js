/**
 * silo serve-mcp — Local MCP server for Claude Code
 *
 * Exposes cross-sprint search and knowledge pack tools over stdio.
 * Zero npm dependencies.
 *
 * Tools:
 *   silo/search   — Full-text search across all stored claims
 *   silo/list     — List stored collections and packs
 *   silo/pull     — Pull claims from a pack into current sprint
 *   silo/store    — Store current sprint claims in silo
 *   silo/packs    — List available knowledge packs
 *
 * Resources:
 *   silo://index  — Silo index (all collections)
 *   silo://packs  — Available knowledge packs
 *
 * Install:
 *   claude mcp add silo -- npx @grainulation/silo serve-mcp
 */

const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { Store } = require('./store.js');
const { Search } = require('./search.js');
const { ImportExport } = require('./import-export.js');
const { Packs } = require('./packs.js');
const { Graph } = require('./graph.js');
const { Confluence } = require('./confluence.js');

// ─── Constants ──────────────────────────────────────────────────────────────

const SERVER_NAME = 'silo';
const SERVER_VERSION = '1.0.0';
const PROTOCOL_VERSION = '2024-11-05';

// ─── JSON-RPC helpers ───────────────────────────────────────────────────────

function jsonRpcResponse(id, result) {
  return JSON.stringify({ jsonrpc: '2.0', id, result });
}

function jsonRpcError(id, code, message) {
  return JSON.stringify({ jsonrpc: '2.0', id, error: { code, message } });
}

// ─── Initialize silo components ─────────────────────────────────────────────

const store = new Store();
const search = new Search(store);
const io = new ImportExport(store);
const packs = new Packs(store);
const graph = new Graph(store);
const confluence = new Confluence();

// ─── Tool implementations ───────────────────────────────────────────────────

function toolSearch(args) {
  const { query, type, evidence, limit } = args;
  if (!query) {
    return { status: 'error', message: 'Required field: query' };
  }

  const results = search.query(query, {
    type: type || null,
    tier: evidence || null,
    limit: limit || 20,
  });

  return {
    status: 'ok',
    count: results.length,
    claims: results.map(r => ({
      id: r.claim.id,
      type: r.claim.type,
      topic: r.claim.topic,
      evidence: r.claim.evidence,
      content: (r.claim.content || r.claim.text || '').slice(0, 200) + ((r.claim.content || r.claim.text || '').length > 200 ? '...' : ''),
      score: r.score,
      collection: r.collection,
    })),
  };
}

function toolList() {
  const collections = store.list();
  return {
    status: 'ok',
    count: collections.length,
    collections: collections.map(c => ({
      id: c.id,
      name: c.name,
      claimCount: c.claimCount,
      storedAt: c.storedAt,
    })),
  };
}

function toolPull(dir, args) {
  const { pack, into } = args;
  if (!pack) {
    return { status: 'error', message: 'Required field: pack (pack name or collection ID)' };
  }

  const targetFile = into || path.join(dir, 'claims.json');
  if (!fs.existsSync(targetFile)) {
    return { status: 'error', message: `Target file not found: ${targetFile}. Run wheat init first.` };
  }

  try {
    const result = io.pull(pack, targetFile, {});
    return {
      status: 'ok',
      message: `Pulled ${result.imported} claims from "${pack}" into ${path.basename(targetFile)}.`,
      imported: result.imported,
      skipped: result.skipped || 0,
    };
  } catch (err) {
    return { status: 'error', message: err.message };
  }
}

function toolStore(dir, args) {
  const { name, from } = args;
  if (!name) {
    return { status: 'error', message: 'Required field: name' };
  }

  const sourceFile = from || path.join(dir, 'claims.json');
  if (!fs.existsSync(sourceFile)) {
    return { status: 'error', message: `Source file not found: ${sourceFile}` };
  }

  try {
    const data = JSON.parse(fs.readFileSync(sourceFile, 'utf8'));
    const claims = data.claims || data;
    const meta = data.meta || {};
    const result = store.storeClaims(name, claims, meta);
    return {
      status: 'ok',
      message: `Stored ${result.claimCount} claims as "${name}".`,
      id: result.id,
      claimCount: result.claimCount,
      hash: result.hash,
    };
  } catch (err) {
    return { status: 'error', message: err.message };
  }
}

function toolPacks() {
  const available = packs.list();
  return {
    status: 'ok',
    count: available.length,
    packs: available.map(p => ({
      name: p.name,
      description: p.description || '',
      claimCount: p.claims ? p.claims.length : p.claimCount || 0,
      source: p.source || 'unknown',
    })),
  };
}

function toolGraph(args) {
  const { action, claimId, topic, tag, minSize } = args;
  switch (action) {
    case 'build': {
      const stats = graph.build();
      return { status: 'ok', message: 'Knowledge graph built.', ...stats };
    }
    case 'related': {
      if (!claimId) return { status: 'error', message: 'Required field: claimId' };
      const results = graph.related(claimId, { limit: 20 });
      return {
        status: 'ok',
        count: results.length,
        related: results.map(r => ({
          id: r.claim.id,
          type: r.claim.type,
          topic: r.claim.topic,
          content: (r.claim.content || '').slice(0, 200),
          source: r.source,
          relation: r.relation,
          weight: r.weight,
        })),
      };
    }
    case 'topic': {
      if (!topic) return { status: 'error', message: 'Required field: topic' };
      const results = graph.byTopic(topic);
      return {
        status: 'ok',
        count: results.length,
        claims: results.map(r => ({
          id: r.claim.id,
          type: r.claim.type,
          content: (r.claim.content || '').slice(0, 200),
          source: r.source,
        })),
      };
    }
    case 'clusters': {
      const clusters = graph.clusters(minSize || 3);
      return {
        status: 'ok',
        count: clusters.length,
        clusters: clusters.slice(0, 20).map(c => ({
          topic: c.topic,
          claimCount: c.claimCount,
          edgeCount: c.edgeCount,
        })),
      };
    }
    case 'stats': {
      return { status: 'ok', ...graph.stats() };
    }
    default:
      return { status: 'error', message: 'Unknown action. Use: build, related, topic, clusters, stats' };
  }
}

function toolConfluence(dir, args) {
  const { action } = args;
  if (!confluence.isConfigured()) {
    return {
      status: 'error',
      message: 'Confluence not configured. Set CONFLUENCE_BASE_URL, CONFLUENCE_TOKEN, and CONFLUENCE_EMAIL environment variables.',
    };
  }

  switch (action) {
    case 'publish': {
      const { title, from, spaceKey, parentId, pageId } = args;
      if (!title) return { status: 'error', message: 'Required field: title' };
      const sourceFile = from || path.join(dir, 'claims.json');
      if (!fs.existsSync(sourceFile)) return { status: 'error', message: `Source file not found: ${sourceFile}` };
      const raw = JSON.parse(fs.readFileSync(sourceFile, 'utf8'));
      const claims = Array.isArray(raw) ? raw : raw.claims || [];
      return confluence.publish(title, claims, { spaceKey, parentId, pageId })
        .then(result => ({ status: 'ok', message: `Published to Confluence: ${result.title}`, ...result }))
        .catch(err => ({ status: 'error', message: err.message }));
    }
    case 'pull': {
      const { pageId: pid, title: searchTitle, into, spaceKey } = args;
      const target = pid || searchTitle;
      if (!target) return { status: 'error', message: 'Required: pageId or title' };
      return confluence.pull(target, { spaceKey })
        .then(result => {
          if (into) {
            const targetFile = path.resolve(dir, into);
            let existing = [];
            if (fs.existsSync(targetFile)) {
              const raw = JSON.parse(fs.readFileSync(targetFile, 'utf-8'));
              existing = Array.isArray(raw) ? raw : raw.claims || [];
            }
            const merged = [...existing, ...result.claims];
            fs.writeFileSync(targetFile, JSON.stringify(merged, null, 2) + '\n');
          }
          return { status: 'ok', title: result.title, claimCount: result.claims.length };
        })
        .catch(err => ({ status: 'error', message: err.message }));
    }
    case 'list': {
      const { spaceKey } = args;
      return confluence.listPages({ spaceKey })
        .then(result => ({ status: 'ok', ...result }))
        .catch(err => ({ status: 'error', message: err.message }));
    }
    default:
      return { status: 'error', message: 'Unknown action. Use: publish, pull, list' };
  }
}

// ─── Tool & Resource definitions ────────────────────────────────────────────

const TOOLS = [
  {
    name: 'silo/search',
    description: 'Full-text search across all stored claims and knowledge packs. Returns ranked results with relevance scores.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search query (space-separated terms, OR logic)' },
        type: { type: 'string', enum: ['constraint', 'factual', 'estimate', 'risk', 'recommendation', 'feedback'], description: 'Filter by claim type' },
        evidence: { type: 'string', enum: ['stated', 'web', 'documented', 'tested', 'production'], description: 'Filter by evidence tier' },
        limit: { type: 'number', description: 'Max results (default: 20)' },
      },
      required: ['query'],
    },
  },
  {
    name: 'silo/list',
    description: 'List all stored collections in the silo (completed sprints, imported knowledge).',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'silo/pull',
    description: 'Pull claims from a knowledge pack or stored collection into the current sprint claims.json. Deduplicates and re-prefixes IDs to avoid collisions.',
    inputSchema: {
      type: 'object',
      properties: {
        pack: { type: 'string', description: 'Pack name (e.g., "compliance", "security") or stored collection ID' },
        into: { type: 'string', description: 'Target claims.json path (default: ./claims.json)' },
      },
      required: ['pack'],
    },
  },
  {
    name: 'silo/store',
    description: 'Store the current sprint claims into the silo for future reuse across other sprints.',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Collection name (e.g., "q4-migration-findings")' },
        from: { type: 'string', description: 'Source claims.json path (default: ./claims.json)' },
      },
      required: ['name'],
    },
  },
  {
    name: 'silo/packs',
    description: 'List available knowledge packs (built-in: compliance, security, architecture, migration, vendor-eval, adr, hackathon categories, etc.).',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'silo/graph',
    description: 'Cross-sprint knowledge graph — find related claims, explore topics, and discover clusters across all stored collections and packs.',
    inputSchema: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['build', 'related', 'topic', 'clusters', 'stats'], description: 'Graph operation to perform' },
        claimId: { type: 'string', description: 'Claim ID for "related" action' },
        topic: { type: 'string', description: 'Topic string for "topic" action' },
        tag: { type: 'string', description: 'Tag for filtering' },
        minSize: { type: 'number', description: 'Minimum cluster size for "clusters" action (default: 3)' },
      },
      required: ['action'],
    },
  },
  {
    name: 'silo/confluence',
    description: 'Confluence backend adapter — publish claims to Confluence pages or pull claims from existing pages. Requires CONFLUENCE_BASE_URL, CONFLUENCE_TOKEN, CONFLUENCE_EMAIL env vars.',
    inputSchema: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['publish', 'pull', 'list'], description: 'Confluence operation' },
        title: { type: 'string', description: 'Page title (publish/pull by title)' },
        from: { type: 'string', description: 'Source claims.json path (publish, default: ./claims.json)' },
        into: { type: 'string', description: 'Target claims.json path (pull)' },
        pageId: { type: 'string', description: 'Confluence page ID (pull/publish update)' },
        spaceKey: { type: 'string', description: 'Confluence space key' },
        parentId: { type: 'string', description: 'Parent page ID (publish)' },
      },
      required: ['action'],
    },
  },
];

const RESOURCES = [
  {
    uri: 'silo://index',
    name: 'Silo Index',
    description: 'All stored collections — IDs, names, claim counts, timestamps.',
    mimeType: 'application/json',
  },
  {
    uri: 'silo://packs',
    name: 'Knowledge Packs',
    description: 'Available built-in and local knowledge packs.',
    mimeType: 'application/json',
  },
];

// ─── Request handler ────────────────────────────────────────────────────────

function handleRequest(dir, method, params, id) {
  switch (method) {
    case 'initialize':
      return jsonRpcResponse(id, {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: { tools: {}, resources: {} },
        serverInfo: { name: SERVER_NAME, version: SERVER_VERSION },
      });

    case 'notifications/initialized':
      return null;

    case 'tools/list':
      return jsonRpcResponse(id, { tools: TOOLS });

    case 'tools/call': {
      const toolName = params.name;
      const toolArgs = params.arguments || {};
      let result;

      switch (toolName) {
        case 'silo/search': result = toolSearch(toolArgs); break;
        case 'silo/list':   result = toolList(); break;
        case 'silo/pull':   result = toolPull(dir, toolArgs); break;
        case 'silo/store':  result = toolStore(dir, toolArgs); break;
        case 'silo/packs':      result = toolPacks(); break;
        case 'silo/graph':      result = toolGraph(toolArgs); break;
        case 'silo/confluence': result = toolConfluence(dir, toolArgs); break;
        default:
          return jsonRpcError(id, -32601, `Unknown tool: ${toolName}`);
      }

      // Handle async tool results (e.g., confluence)
      if (result && typeof result.then === 'function') {
        return result.then(r => jsonRpcResponse(id, {
          content: [{ type: 'text', text: JSON.stringify(r, null, 2) }],
          isError: r.status === 'error',
        }));
      }

      return jsonRpcResponse(id, {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
        isError: result.status === 'error',
      });
    }

    case 'resources/list':
      return jsonRpcResponse(id, { resources: RESOURCES });

    case 'resources/read': {
      const uri = params.uri;
      let text;

      switch (uri) {
        case 'silo://index':
          text = JSON.stringify(store.list(), null, 2);
          break;
        case 'silo://packs':
          text = JSON.stringify(packs.list().map(p => ({
            name: p.name, description: p.description, claimCount: p.claims ? p.claims.length : 0, source: p.source,
          })), null, 2);
          break;
        default:
          return jsonRpcError(id, -32602, `Unknown resource: ${uri}`);
      }

      return jsonRpcResponse(id, {
        contents: [{ uri, mimeType: 'application/json', text }],
      });
    }

    case 'ping':
      return jsonRpcResponse(id, {});

    default:
      if (id === undefined || id === null) return null;
      return jsonRpcError(id, -32601, `Method not found: ${method}`);
  }
}

// ─── Stdio transport ────────────────────────────────────────────────────────

function startServer(dir) {
  const rl = readline.createInterface({ input: process.stdin, terminal: false });

  if (process.stdout._handle && process.stdout._handle.setBlocking) {
    process.stdout._handle.setBlocking(true);
  }

  rl.on('line', (line) => {
    if (!line.trim()) return;
    let msg;
    try { msg = JSON.parse(line); } catch {
      process.stdout.write(jsonRpcError(null, -32700, 'Parse error') + '\n');
      return;
    }
    const response = handleRequest(dir, msg.method, msg.params || {}, msg.id);
    if (response && typeof response.then === 'function') {
      response.then(r => { if (r !== null) process.stdout.write(r + '\n'); });
    } else if (response !== null) {
      process.stdout.write(response + '\n');
    }
  });

  rl.on('close', () => process.exit(0));

  process.stderr.write(`silo MCP server v${SERVER_VERSION} ready on stdio\n`);
  process.stderr.write(`  Silo root: ${store.root}\n`);
  process.stderr.write(`  Tools: ${TOOLS.length} | Resources: ${RESOURCES.length}\n`);
}

// ─── Entry point ────────────────────────────────────────────────────────────

if (require.main === module) {
  startServer(process.cwd());
}

async function run(dir) { startServer(dir); }

module.exports = { startServer, handleRequest, TOOLS, RESOURCES, run };
