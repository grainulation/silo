/**
 * index.js — Unified entry point for @grainulation/silo
 *
 * Re-exports all public modules so consumers can import from a single path.
 */

const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { Store, DEFAULT_SILO_DIR } = require('./store.js');
const { Search } = require('./search.js');
const { Packs } = require('./packs.js');
const { ImportExport } = require('./import-export.js');
const { Templates } = require('./templates.js');
const { Graph } = require('./graph.js');
const { Confluence } = require('./confluence.js');

const pkg = JSON.parse(readFileSync(join(__dirname, '..', 'package.json'), 'utf-8'));

module.exports = {
  name: 'silo',
  version: pkg.version,
  description: pkg.description,

  Store,
  DEFAULT_SILO_DIR,
  Search,
  Packs,
  ImportExport,
  Templates,
  Graph,
  Confluence,
};
