<p align="center">
  <img src="site/wordmark.svg" alt="Silo" width="400">
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/@grainulation/silo"><img src="https://img.shields.io/npm/v/@grainulation/silo?label=%40grainulation%2Fsilo" alt="npm version"></a> <a href="https://www.npmjs.com/package/@grainulation/silo"><img src="https://img.shields.io/npm/dm/@grainulation/silo" alt="npm downloads"></a> <a href="https://github.com/grainulation/silo/blob/main/LICENSE"><img src="https://img.shields.io/badge/license-MIT-green" alt="license"></a> <a href="https://nodejs.org"><img src="https://img.shields.io/node/v/@grainulation/silo" alt="node"></a> <a href="https://github.com/grainulation/silo/actions"><img src="https://github.com/grainulation/silo/actions/workflows/ci.yml/badge.svg" alt="CI"></a>
  <a href="https://deepwiki.com/grainulation/silo"><img src="https://deepwiki.com/badge.svg" alt="Explore on DeepWiki"></a>
</p>

<p align="center"><strong>Reusable knowledge for research sprints.</strong></p>

Instead of starting every sprint from scratch, pull in battle-tested constraint sets, risk patterns, and decision templates. Grab a starter pack in one command:

```bash
npx @grainulation/silo pull compliance --into ./claims.json
```

## Install

```bash
npm install -g @grainulation/silo
```

## Built-in packs

11 knowledge packs with 131 curated claims:

| Pack               | Claims | What's inside                                                              |
| ------------------ | ------ | -------------------------------------------------------------------------- |
| `api-design`       | 13     | REST conventions, versioning, pagination, error formats, GraphQL tradeoffs |
| `architecture`     | 12     | Monolith vs micro, build vs buy, SQL vs NoSQL decision claims              |
| `ci-cd`            | 12     | CI/CD pipeline patterns, caching, rollback strategies                      |
| `compliance`       | 14     | HIPAA, SOC 2, GDPR constraint sets with regulatory citations               |
| `data-engineering` | 12     | ETL patterns, data quality, warehouse design                               |
| `frontend`         | 12     | Frontend architecture, performance, accessibility patterns                 |
| `migration`        | 10     | Database/cloud/framework migration risks and patterns                      |
| `observability`    | 12     | Logging, metrics, tracing, alerting patterns                               |
| `security`         | 12     | Security constraints, threat models, authentication patterns               |
| `team-process`     | 12     | Team workflow, code review, incident response patterns                     |
| `testing`          | 10     | Testing strategies, coverage, test architecture                            |

## Quick start

```bash
# See available packs
silo packs

# Pull compliance constraints into your sprint
silo pull compliance --into ./claims.json

# Pull only GDPR constraints
silo pull compliance --into ./claims.json --type constraint

# Search across stored claims
silo search "encryption at rest"

# Store your sprint's findings for reuse
silo store "q4-migration-findings" --from ./claims.json

# List everything in your silo
silo list
```

## CLI

| Command                                   | Description                     |
| ----------------------------------------- | ------------------------------- |
| `silo list`                               | List all stored collections     |
| `silo pull <pack> --into <file>`          | Pull claims into a claims file  |
| `silo store <name> --from <file>`         | Store claims from a sprint      |
| `silo search <query>`                     | Full-text search across claims  |
| `silo packs`                              | List available knowledge packs  |
| `silo publish <name> --collections <ids>` | Bundle collections into a pack  |
| `silo install <file>`                     | Install a pack from a JSON file |
| `silo fetch <url> [--mode auto|concise|full|meta-only]` | Size-efficient web fetch with semantic extraction |
| `silo cache stats|clear|purge <domain>`   | Manage the smart-fetch cache    |

## Testing

```bash
npm test             # unit + extraction tests (no network)
npm run test:live    # includes live regression fixtures (FETCH_LIVE=1)
```

## How it works

Silo uses your filesystem for storage (`~/.silo` by default). No database, no network calls, no accounts.

When you `pull`, Silo re-prefixes claim IDs to avoid collisions, deduplicates against existing claims, and merges into your claims.json.

When you `store`, Silo hashes the content for versioning, saves to `~/.silo/claims/`, and updates the search index.

## Programmatic API

```js
const { Store } = require("@grainulation/silo/lib/store");
const { Search } = require("@grainulation/silo/lib/search");
const { ImportExport } = require("@grainulation/silo/lib/import-export");

const store = new Store().init();
const search = new Search(store);
const io = new ImportExport(store);

const results = search.query("encryption", { type: "constraint" });
io.pull("compliance", "./claims.json");
io.push("./claims.json", "my-sprint-findings");
```

## Zero dependencies

Node built-in modules only. Filesystem-based storage. Works offline.

## Part of the grainulation ecosystem

| Tool                                                         | Role                                                        |
| ------------------------------------------------------------ | ----------------------------------------------------------- |
| [wheat](https://github.com/grainulation/wheat)               | Research engine -- grow structured evidence                 |
| [farmer](https://github.com/grainulation/farmer)             | Permission dashboard -- approve AI actions in real time     |
| [barn](https://github.com/grainulation/barn)                 | Shared tools -- templates, validators, sprint detection     |
| [mill](https://github.com/grainulation/mill)                 | Format conversion -- export to PDF, CSV, slides, 24 formats |
| **silo**                                                     | Knowledge storage -- reusable claim libraries and packs     |
| [harvest](https://github.com/grainulation/harvest)           | Analytics -- cross-sprint patterns and prediction scoring   |
| [orchard](https://github.com/grainulation/orchard)           | Orchestration -- multi-sprint coordination and dependencies |
| [grainulation](https://github.com/grainulation/grainulation) | Unified CLI -- single entry point to the ecosystem          |

## License

MIT
