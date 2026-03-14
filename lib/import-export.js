/**
 * import-export.js — Pull claims between sprints and silos
 *
 * Handles the core workflow: take claims from a silo collection
 * (or built-in pack) and merge them into a sprint's claims.json.
 */

const fs = require('node:fs');
const path = require('node:path');
const { Store } = require('./store.js');

class ImportExport {
  constructor(store) {
    this.store = store || new Store();
  }

  /**
   * Pull claims from a silo collection into a target claims file.
   * New claims get re-prefixed to avoid ID collisions.
   *
   * @param {string} source - Collection name/id or built-in pack name
   * @param {string} targetPath - Path to claims.json to merge into
   * @param {object} opts
   * @param {string} opts.prefix - Claim ID prefix for imported claims (default: 'imp')
   * @param {string[]} opts.types - Only import these claim types
   * @param {boolean} opts.dryRun - If true, return what would be imported without writing
   */
  pull(source, targetPath, opts = {}) {
    const { prefix = 'imp', types, dryRun = false } = opts;

    // Resolve source: try silo store first, then built-in packs
    let sourceClaims = this._resolveSource(source);
    if (!sourceClaims) {
      throw new Error(`Collection or pack "${source}" not found`);
    }

    // Filter by type if requested
    if (types && types.length > 0) {
      sourceClaims = sourceClaims.filter((c) => types.includes(c.type));
    }

    // Re-prefix claim IDs
    const imported = sourceClaims.map((claim, i) => ({
      ...claim,
      id: `${prefix}${String(i + 1).padStart(3, '0')}`,
      importedFrom: source,
      importedAt: new Date().toISOString(),
    }));

    if (dryRun) {
      return { wouldImport: imported.length, claims: imported };
    }

    // Read existing target or create empty
    let existing = [];
    if (fs.existsSync(targetPath)) {
      const raw = JSON.parse(fs.readFileSync(targetPath, 'utf-8'));
      existing = Array.isArray(raw) ? raw : raw.claims || [];
    }

    // Deduplicate by text content
    const existingTexts = new Set(existing.map((c) => c.text?.toLowerCase()));
    const deduped = imported.filter((c) => !existingTexts.has(c.text?.toLowerCase()));

    const merged = [...existing, ...deduped];
    const output = Array.isArray(JSON.parse(fs.readFileSync(targetPath, 'utf-8') || '[]'))
      ? merged
      : { claims: merged };

    fs.writeFileSync(targetPath, JSON.stringify(output, null, 2) + '\n', 'utf-8');

    return {
      imported: deduped.length,
      skippedDuplicates: imported.length - deduped.length,
      totalClaims: merged.length,
    };
  }

  /**
   * Export claims from a sprint's claims.json into the silo.
   *
   * @param {string} sourcePath - Path to claims.json
   * @param {string} name - Name for the stored collection
   * @param {object} meta - Additional metadata
   */
  push(sourcePath, name, meta = {}) {
    if (!fs.existsSync(sourcePath)) {
      throw new Error(`Claims file not found: ${sourcePath}`);
    }

    const raw = JSON.parse(fs.readFileSync(sourcePath, 'utf-8'));
    const claims = Array.isArray(raw) ? raw : raw.claims || [];

    return this.store.storeClaims(name, claims, meta);
  }

  /** Resolve a source name to an array of claims. */
  _resolveSource(source) {
    // Try silo store
    const stored = this.store.getClaims(source);
    if (stored) return stored.claims;

    // Try built-in packs
    const packPath = path.join(__dirname, '..', 'packs', `${source}.json`);
    if (fs.existsSync(packPath)) {
      const pack = JSON.parse(fs.readFileSync(packPath, 'utf-8'));
      return pack.claims || [];
    }

    return null;
  }
}

module.exports = { ImportExport };
