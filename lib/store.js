/**
 * store.js — Local claim/template storage (filesystem-based)
 *
 * Silo stores everything as JSON files in a local directory (~/.silo by default).
 * No database, no dependencies — just the filesystem.
 */

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const DEFAULT_SILO_DIR = path.join(require('node:os').homedir(), '.silo');

class Store {
  constructor(siloDir = DEFAULT_SILO_DIR) {
    this.root = siloDir;
    this.claimsDir = path.join(siloDir, 'claims');
    this.templatesDir = path.join(siloDir, 'templates');
    this.packsDir = path.join(siloDir, 'packs');
    this.indexPath = path.join(siloDir, 'index.json');
  }

  /** Ensure the silo directory structure exists. */
  init() {
    for (const dir of [this.root, this.claimsDir, this.templatesDir, this.packsDir]) {
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
    }
    if (!fs.existsSync(this.indexPath)) {
      this._writeJSON(this.indexPath, {
        version: 1,
        created: new Date().toISOString(),
        collections: [],
      });
    }
    return this;
  }

  /** Store a collection of claims under a name. */
  storeClaims(name, claims, meta = {}) {
    this.init();
    const id = this._slugify(name);
    const entry = {
      id,
      name,
      type: 'claims',
      claimCount: claims.length,
      hash: this._hash(JSON.stringify(claims)),
      storedAt: new Date().toISOString(),
      ...meta,
    };
    const filePath = path.join(this.claimsDir, `${id}.json`);
    this._writeJSON(filePath, { meta: entry, claims });
    this._addToIndex(entry);
    return entry;
  }

  /** Retrieve claims by collection name/id. */
  getClaims(nameOrId) {
    const id = this._slugify(nameOrId);
    const filePath = path.join(this.claimsDir, `${id}.json`);
    if (!fs.existsSync(filePath)) return null;
    return this._readJSON(filePath);
  }

  /** List all stored collections. */
  list() {
    this.init();
    const index = this._readJSON(this.indexPath);
    return index.collections || [];
  }

  /** Remove a collection by name/id. */
  remove(nameOrId) {
    const id = this._slugify(nameOrId);
    for (const dir of [this.claimsDir, this.templatesDir, this.packsDir]) {
      const filePath = path.join(dir, `${id}.json`);
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }
    }
    this._removeFromIndex(id);
    return true;
  }

  // --- Internal helpers ---

  _readJSON(filePath) {
    return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  }

  _writeJSON(filePath, data) {
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2) + '\n', 'utf-8');
  }

  _hash(str) {
    return crypto.createHash('sha256').update(str).digest('hex').slice(0, 12);
  }

  _slugify(str) {
    return str.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  }

  _addToIndex(entry) {
    const index = this._readJSON(this.indexPath);
    index.collections = index.collections.filter((c) => c.id !== entry.id);
    index.collections.push(entry);
    this._writeJSON(this.indexPath, index);
  }

  _removeFromIndex(id) {
    const index = this._readJSON(this.indexPath);
    index.collections = index.collections.filter((c) => c.id !== id);
    this._writeJSON(this.indexPath, index);
  }
}

module.exports = { Store, DEFAULT_SILO_DIR };
