/**
 * index.js — Unified entry point for @grainulation/silo
 *
 * Re-exports all public modules so consumers can import from a single path.
 */

const { Store, DEFAULT_SILO_DIR } = require('./store.js');
const { Search } = require('./search.js');
const { Packs } = require('./packs.js');
const { ImportExport } = require('./import-export.js');
const { Templates } = require('./templates.js');

module.exports = {
  name: 'silo',
  version: '1.0.0',
  description: 'Reusable knowledge for research sprints -- shared claim libraries, templates, and knowledge packs',

  Store,
  DEFAULT_SILO_DIR,
  Search,
  Packs,
  ImportExport,
  Templates,
};
