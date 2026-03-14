/**
 * basic.test.js — Smoke tests for silo
 *
 * Runs with plain Node.js (node:test + node:assert).
 * Zero test framework dependencies.
 */

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { execFileSync } = require('node:child_process');

const { Store } = require('../lib/store.js');
const { Search } = require('../lib/search.js');
const { ImportExport } = require('../lib/import-export.js');
const { Templates } = require('../lib/templates.js');
const { Packs } = require('../lib/packs.js');

const TEST_DIR = path.join(os.tmpdir(), `silo-test-${Date.now()}`);

function cleanup() {
  if (fs.existsSync(TEST_DIR)) {
    fs.rmSync(TEST_DIR, { recursive: true, force: true });
  }
}

describe('Store', () => {
  let store;
  before(() => {
    cleanup();
    store = new Store(path.join(TEST_DIR, 'silo')).init();
  });
  after(cleanup);

  it('creates directory structure on init', () => {
    assert.ok(fs.existsSync(store.root));
    assert.ok(fs.existsSync(store.claimsDir));
    assert.ok(fs.existsSync(store.templatesDir));
    assert.ok(fs.existsSync(store.packsDir));
    assert.ok(fs.existsSync(store.indexPath));
  });

  it('stores and retrieves claims', () => {
    const claims = [
      { id: 'c001', type: 'constraint', content: 'Must use TLS 1.2+', tags: ['security'] },
      { id: 'c002', type: 'risk', content: 'Latency may spike under load', tags: ['performance'] },
    ];
    const entry = store.storeClaims('test-claims', claims);
    assert.equal(entry.id, 'test-claims');
    assert.equal(entry.claimCount, 2);

    const retrieved = store.getClaims('test-claims');
    assert.ok(retrieved);
    assert.equal(retrieved.claims.length, 2);
    assert.equal(retrieved.claims[0].content, 'Must use TLS 1.2+');
  });

  it('lists stored collections', () => {
    const list = store.list();
    assert.ok(list.length >= 1);
    assert.ok(list.some((c) => c.id === 'test-claims'));
  });

  it('removes a collection', () => {
    store.storeClaims('to-remove', [{ id: 'x', content: 'temp' }]);
    assert.ok(store.getClaims('to-remove'));
    store.remove('to-remove');
    assert.equal(store.getClaims('to-remove'), null);
  });
});

describe('Search', () => {
  let store, search;
  before(() => {
    store = new Store(path.join(TEST_DIR, 'silo-search')).init();
    store.storeClaims('security-pack', [
      { id: 's001', type: 'constraint', evidence: 'documented', content: 'All data must be encrypted at rest', tags: ['encryption'] },
      { id: 's002', type: 'risk', evidence: 'web', content: 'TLS certificate rotation may cause downtime', tags: ['tls'] },
      { id: 's003', type: 'constraint', evidence: 'documented', content: 'Passwords must be hashed with bcrypt or argon2', tags: ['auth'] },
    ]);
    search = new Search(store);
  });

  it('finds claims by text search', () => {
    const results = search.query('encrypted');
    assert.ok(results.length >= 1);
    assert.ok(results[0].claim.content.includes('encrypted'));
  });

  it('filters by type', () => {
    const results = search.query('encrypted', { type: 'risk' });
    assert.equal(results.length, 0);
  });

  it('returns empty for no matches', () => {
    const results = search.query('quantum blockchain');
    assert.equal(results.length, 0);
  });
});

describe('ImportExport', () => {
  let store, io;
  before(() => {
    store = new Store(path.join(TEST_DIR, 'silo-io')).init();
    io = new ImportExport(store);
  });

  it('pulls built-in pack claims into a target file', () => {
    const targetPath = path.join(TEST_DIR, 'target-claims.json');
    fs.writeFileSync(targetPath, '[]');
    const result = io.pull('compliance', targetPath);
    assert.ok(result.imported > 0);

    const written = JSON.parse(fs.readFileSync(targetPath, 'utf-8'));
    assert.ok(written.length > 0);
    assert.ok(written[0].importedFrom === 'compliance');
  });

  it('deduplicates on repeated pulls', () => {
    const targetPath = path.join(TEST_DIR, 'target-dedup.json');
    fs.writeFileSync(targetPath, '[]');
    io.pull('compliance', targetPath);
    const first = JSON.parse(fs.readFileSync(targetPath, 'utf-8'));
    io.pull('compliance', targetPath);
    const second = JSON.parse(fs.readFileSync(targetPath, 'utf-8'));
    assert.equal(first.length, second.length);
  });

  it('normalizes legacy tier/text to evidence/content on pull', () => {
    // Store claims using legacy field names
    store.storeClaims('legacy-pack', [
      { id: 'leg001', type: 'constraint', tier: 'documented', text: 'Legacy claim with old fields', tags: ['test'] },
    ]);
    const targetPath = path.join(TEST_DIR, 'target-legacy.json');
    fs.writeFileSync(targetPath, '[]');
    io.pull('legacy-pack', targetPath);
    const claims = JSON.parse(fs.readFileSync(targetPath, 'utf-8'));
    assert.ok(claims.length > 0);
    const claim = claims[0];
    // Should have wheat-canonical fields
    assert.equal(claim.evidence, 'documented');
    assert.equal(claim.content, 'Legacy claim with old fields');
    // Should NOT have legacy fields
    assert.equal(claim.tier, undefined);
    assert.equal(claim.text, undefined);
    // Should have all required wheat fields
    assert.ok('source' in claim && typeof claim.source === 'object');
    assert.ok('status' in claim);
    assert.ok('phase_added' in claim);
    assert.ok('timestamp' in claim);
    assert.ok('conflicts_with' in claim);
    assert.ok('tags' in claim);
  });

  it('imported pack claims have wheat-canonical schema', () => {
    const targetPath = path.join(TEST_DIR, 'target-schema.json');
    fs.writeFileSync(targetPath, '[]');
    io.pull('compliance', targetPath);
    const claims = JSON.parse(fs.readFileSync(targetPath, 'utf-8'));
    for (const claim of claims) {
      assert.ok(claim.content, `claim ${claim.id} missing content`);
      assert.ok(claim.evidence, `claim ${claim.id} missing evidence`);
      assert.equal(claim.text, undefined, `claim ${claim.id} still has legacy text`);
      assert.equal(claim.tier, undefined, `claim ${claim.id} still has legacy tier`);
      assert.ok(typeof claim.source === 'object', `claim ${claim.id} source should be object`);
    }
  });

  it('stores claims from a file (push)', () => {
    const sourcePath = path.join(TEST_DIR, 'source.json');
    fs.writeFileSync(sourcePath, JSON.stringify([
      { id: 'p001', type: 'factual', content: 'Node.js is single-threaded' },
    ]));
    const entry = io.push(sourcePath, 'node-facts');
    assert.equal(entry.claimCount, 1);
    assert.ok(store.getClaims('node-facts'));
  });
});

describe('Templates', () => {
  let store, tmpl;
  before(() => {
    store = new Store(path.join(TEST_DIR, 'silo-tmpl')).init();
    tmpl = new Templates(store);
  });

  it('saves and retrieves a template', () => {
    tmpl.save('Database Migration', {
      question: 'Should we migrate from Postgres to CockroachDB?',
      audience: 'Engineering team',
      constraints: ['Zero downtime', 'No data loss'],
      seedClaims: [
        { type: 'constraint', content: 'Migration must be reversible' },
      ],
      tags: ['database', 'migration'],
    });

    const retrieved = tmpl.get('database-migration');
    assert.ok(retrieved);
    assert.equal(retrieved.question, 'Should we migrate from Postgres to CockroachDB?');
    assert.equal(retrieved.seedClaims.length, 1);
  });

  it('lists templates', () => {
    const list = tmpl.list();
    assert.ok(list.length >= 1);
    assert.ok(list.some((t) => t.id === 'database-migration'));
  });

  it('instantiates a template into a directory', () => {
    const dir = path.join(TEST_DIR, 'new-sprint');
    const result = tmpl.instantiate('database-migration', dir);
    assert.ok(fs.existsSync(result.claimsFile));
    assert.ok(fs.existsSync(result.configFile));
    assert.equal(result.seedClaims, 1);
  });
});

describe('Packs', () => {
  let packsMgr;
  before(() => {
    const store = new Store(path.join(TEST_DIR, 'silo-packs')).init();
    packsMgr = new Packs(store);
  });

  it('lists built-in packs', () => {
    const list = packsMgr.list();
    assert.ok(list.length >= 3);
    const ids = list.map((p) => p.id);
    assert.ok(ids.includes('compliance'));
    assert.ok(ids.includes('migration'));
    assert.ok(ids.includes('architecture'));
  });

  it('retrieves a built-in pack', () => {
    const pack = packsMgr.get('compliance');
    assert.ok(pack);
    assert.ok(pack.claims.length > 0);
    assert.equal(pack.name, 'Compliance Constraints');
  });

  it('installs a pack from file', () => {
    const packFile = path.join(TEST_DIR, 'custom-pack.json');
    fs.writeFileSync(packFile, JSON.stringify({
      name: 'Custom Pack',
      claims: [{ id: 'x001', content: 'test claim' }],
    }));
    const result = packsMgr.install(packFile);
    assert.equal(result.id, 'custom-pack');
    assert.equal(result.claimCount, 1);
  });
});

describe('CLI', () => {
  const cli = path.join(__dirname, '..', 'bin', 'silo.js');

  it('prints help with no args', () => {
    const output = execFileSync('node', [cli], { encoding: 'utf-8' });
    assert.ok(output.includes('reusable knowledge'));
  });

  it('lists packs', () => {
    const output = execFileSync('node', [cli, 'packs'], { encoding: 'utf-8' });
    assert.ok(output.includes('compliance'));
    assert.ok(output.includes('migration'));
    assert.ok(output.includes('architecture'));
  });

  it('pulls compliance pack into a file', () => {
    const target = path.join(TEST_DIR, 'cli-target.json');
    fs.writeFileSync(target, '[]');
    const output = execFileSync('node', [cli, 'pull', 'compliance', '--into', target], { encoding: 'utf-8' });
    assert.ok(output.includes('Imported'));
    const claims = JSON.parse(fs.readFileSync(target, 'utf-8'));
    assert.ok(claims.length > 0);
  });
});
