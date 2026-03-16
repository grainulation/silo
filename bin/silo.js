#!/usr/bin/env node

/**
 * silo — CLI for storing and sharing reusable research knowledge
 *
 * Usage:
 *   silo list                          List all stored collections and packs
 *   silo pull <pack> --into <file>     Pull claims from a pack into a claims file
 *   silo store <name> --from <file>    Store claims from a file into the silo
 *   silo search <query>                Search across all stored claims
 *   silo publish <name> --collections <ids...>  Bundle collections into a pack
 *   silo packs                         List available knowledge packs
 *   silo templates                     List available sprint templates
 *   silo serve [--port 9095]           Start the knowledge browser UI
 */

const { Store } = require('../lib/store.js');
const { Search } = require('../lib/search.js');
const { ImportExport } = require('../lib/import-export.js');
const { Templates } = require('../lib/templates.js');
const { Packs } = require('../lib/packs.js');

const store = new Store();
const search = new Search(store);
const io = new ImportExport(store);
const templates = new Templates(store);
const packs = new Packs(store);

const args = process.argv.slice(2);
const command = args[0];

function flag(name) {
  const idx = args.indexOf(`--${name}`);
  if (idx === -1) return null;
  return args[idx + 1] || true;
}

function flagList(name) {
  const idx = args.indexOf(`--${name}`);
  if (idx === -1) return [];
  const values = [];
  for (let i = idx + 1; i < args.length; i++) {
    if (args[i].startsWith('--')) break;
    values.push(args[i]);
  }
  return values;
}

function print(obj) {
  if (typeof obj === 'string') {
    process.stdout.write(obj + '\n');
  } else {
    process.stdout.write(JSON.stringify(obj, null, 2) + '\n');
  }
}

function usage() {
  print(`silo -- reusable knowledge for research sprints

Commands:
  list                              List all stored collections and packs
  pull <pack> --into <file> [--filter <ids>]  Pull claims (optionally filter by ID)
  store <name> --from <file>        Store claims from a file into the silo
  search <query> [--type <type>]    Search across all stored claims
  publish <name> --collections <ids...>  Bundle collections into a pack
  packs                             List available knowledge packs
  templates                         List available sprint templates
  install <file>                    Install a pack from a file
  serve [--port 9095]               Start the knowledge browser UI

Examples:
  silo pull compliance --into ./claims.json
  silo search "encryption" --type constraint
  silo store "my-findings" --from ./claims.json
  silo serve --port 9095
  silo packs`);
}

try {
  switch (command) {
    case 'list': {
      const collections = store.list();
      if (collections.length === 0) {
        print('No stored collections. Use "silo store" to save claims or "silo packs" to see built-in packs.');
      } else {
        print('Stored collections:\n');
        for (const c of collections) {
          print(`  ${c.id}  (${c.type || 'claims'}, ${c.claimCount} claims)  ${c.storedAt || ''}`);
        }
      }
      break;
    }

    case 'pull': {
      const source = args[1];
      const into = flag('into');
      if (!source || !into) {
        print('Usage: silo pull <pack> --into <file>');
        process.exit(1);
      }
      const dryRun = args.includes('--dry-run');
      const types = flagList('type');
      const filterIds = flag('filter');
      const ids = filterIds ? filterIds.split(',').map((s) => s.trim()) : undefined;
      const result = io.pull(source, into, { types: types.length ? types : undefined, ids, dryRun });
      if (dryRun) {
        print(`Dry run: would import ${result.wouldImport} claims`);
        print(result.claims);
      } else {
        print(`Imported ${result.imported} claims into ${into} (${result.skippedDuplicates} duplicates skipped, ${result.totalClaims} total)`);
      }
      break;
    }

    case 'store': {
      const name = args[1];
      const from = flag('from');
      if (!name || !from) {
        print('Usage: silo store <name> --from <file>');
        process.exit(1);
      }
      const result = io.push(from, name);
      print(`Stored "${name}" (${result.claimCount} claims, hash: ${result.hash})`);
      break;
    }

    case 'search': {
      const query = args.slice(1).filter((a) => !a.startsWith('--')).join(' ');
      if (!query) {
        print('Usage: silo search <query> [--type <type>] [--evidence <tier>]');
        process.exit(1);
      }
      const type = flag('type');
      const tier = flag('tier');
      const results = search.query(query, { type, tier });
      if (results.length === 0) {
        print('No matches found.');
      } else {
        print(`${results.length} result(s):\n`);
        for (const r of results) {
          const text = r.claim.content || r.claim.text || '';
          const tier = r.claim.evidence || r.claim.tier || 'unknown';
          print(`  [${r.claim.id}] (${r.claim.type}, ${tier}) ${text.slice(0, 120)}${text.length > 120 ? '...' : ''}`);
          print(`    from: ${r.collection}  score: ${r.score}\n`);
        }
      }
      break;
    }

    case 'publish': {
      const name = args[1];
      const collections = flagList('collections');
      if (!name || collections.length === 0) {
        print('Usage: silo publish <name> --collections <id1> <id2> ...');
        process.exit(1);
      }
      const desc = flag('description') || '';
      const result = packs.bundle(name, collections, { description: desc });
      print(`Published pack "${name}" (${result.claimCount} claims) -> ${result.path}`);
      break;
    }

    case 'packs': {
      const allPacks = packs.list();
      if (allPacks.length === 0) {
        print('No packs available.');
      } else {
        print('Available packs:\n');
        for (const p of allPacks) {
          print(`  ${p.id}  ${p.name}  (${p.claimCount} claims, v${p.version}, ${p.source})`);
          if (p.description) print(`    ${p.description.slice(0, 100)}`);
          print('');
        }
      }
      break;
    }

    case 'templates': {
      const allTemplates = templates.list();
      if (allTemplates.length === 0) {
        print('No templates saved yet. Use the Templates API to create them.');
      } else {
        for (const t of allTemplates) {
          print(`  ${t.id}  "${t.question || t.name}"  (${t.seedClaims} seed claims)  [${t.tags.join(', ')}]`);
        }
      }
      break;
    }

    case 'install': {
      const filePath = args[1];
      if (!filePath) {
        print('Usage: silo install <pack-file.json>');
        process.exit(1);
      }
      const result = packs.install(filePath);
      print(`Installed pack "${result.id}" (${result.claimCount} claims)`);
      break;
    }

    case 'serve': {
      // Dynamic import for ESM server module
      const port = flag('port') || '9095';
      const root = flag('root') || process.cwd();
      // Set args for the server module to pick up
      const serverArgs = ['serve'];
      if (flag('port')) { serverArgs.push('--port', port); }
      if (flag('root')) { serverArgs.push('--root', root); }
      // Re-exec as ESM since server.js uses import
      const { execFile } = require('node:child_process');
      const path = require('node:path');
      const serverPath = path.join(__dirname, '..', 'lib', 'server.js');
      const child = execFile('node', [serverPath, ...serverArgs.slice(1)], {
        stdio: 'inherit',
        env: process.env,
      });
      child.stdout && child.stdout.pipe(process.stdout);
      child.stderr && child.stderr.pipe(process.stderr);
      child.on('error', (err) => {
        process.stderr.write(`Error starting server: ${err.message}\n`);
        process.exit(1);
      });
      // Keep the process alive
      child.on('exit', (code) => process.exit(code || 0));
      break;
    }

    case 'help':
    case '--help':
    case '-h':
    case undefined:
      usage();
      break;

    default:
      print(`Unknown command: ${command}\n`);
      usage();
      process.exit(1);
  }
} catch (err) {
  process.stderr.write(`Error: ${err.message}\n`);
  process.exit(1);
}
