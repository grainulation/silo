'use strict';

/**
 * silo -> harvest edge: cross-library analytics.
 *
 * Feeds silo's stored claim collections to harvest's analyzer
 * to surface patterns, evidence quality trends, and type distribution
 * across the entire knowledge base. Graceful fallback if harvest
 * is not available.
 */

const fs = require('node:fs');
const path = require('node:path');

const HARVEST_SIBLINGS = [
  path.join(__dirname, '..', '..', 'harvest'),
  path.join(__dirname, '..', '..', '..', 'harvest'),
];

/**
 * Try to load harvest's analyzer module from a sibling checkout.
 * Returns the analyze function or null.
 */
function loadHarvestAnalyzer() {
  for (const dir of HARVEST_SIBLINGS) {
    const analyzerPath = path.join(dir, 'lib', 'analyzer.js');
    if (fs.existsSync(analyzerPath)) {
      try {
        const mod = require(analyzerPath);
        if (typeof mod.analyze === 'function') return mod.analyze;
      } catch { continue; }
    }
  }
  return null;
}

/**
 * Run cross-library analytics on all stored claim collections.
 * @param {import('./store').Store} store — an initialized silo Store instance
 * @returns {{ available: boolean, analysis?: object, collectionCount?: number }}
 */
function analyzeLibrary(store) {
  const analyze = loadHarvestAnalyzer();
  if (!analyze) {
    return { available: false, reason: 'harvest analyzer not found in sibling directories' };
  }

  const collections = store.list();
  if (collections.length === 0) {
    return { available: true, analysis: null, collectionCount: 0, reason: 'no collections stored' };
  }

  // Convert silo collections into the sprint format harvest expects
  const sprints = [];
  for (const entry of collections) {
    const data = store.getClaims(entry.id);
    if (!data || !data.claims) continue;
    sprints.push({
      name: entry.name || entry.id,
      claims: data.claims,
    });
  }

  if (sprints.length === 0) {
    return { available: true, analysis: null, collectionCount: 0, reason: 'no valid claim data' };
  }

  const analysis = analyze(sprints);
  return {
    available: true,
    collectionCount: sprints.length,
    analysis,
  };
}

module.exports = { analyzeLibrary, loadHarvestAnalyzer };
