# @grainulation/silo

Reusable knowledge for research sprints. Grab a starter pack in one command:

```bash
npx @grainulation/silo pull compliance --into ./claims.json
```

## What is Silo?

Silo stores and shares research knowledge across projects and teams. Instead of starting every sprint from scratch, pull in battle-tested constraint sets, risk patterns, and decision templates.

- **Shared claim libraries** -- reusable constraint sets (HIPAA, SOC 2, GDPR, etc.)
- **Community sprint templates** -- pre-built research questions with seeded claims
- **Claim import/export** -- pull claims from one sprint into another
- **Knowledge packs** -- version-controlled bundles teams can subscribe to
- **Full-text search** -- find relevant claims across everything you've stored

Zero dependencies. Filesystem-based storage. Works offline.

## Built-in Packs

| Pack | Claims | What's inside |
|------|--------|---------------|
| `api-design` | 13 | REST conventions, versioning, pagination, error formats, GraphQL tradeoffs |
| `architecture` | 12 | Monolith vs micro, build vs buy, SQL vs NoSQL decision claims |
| `ci-cd` | 12 | CI/CD pipeline patterns, caching, rollback strategies |
| `compliance` | 14 | HIPAA, SOC 2, GDPR constraint sets with regulatory citations |
| `data-engineering` | 12 | ETL patterns, data quality, warehouse design |
| `frontend` | 12 | Frontend architecture, performance, accessibility patterns |
| `migration` | 10 | Database/cloud/framework migration risks and patterns |
| `observability` | 12 | Logging, metrics, tracing, alerting patterns |
| `security` | 12 | Security constraints, threat models, authentication patterns |
| `team-process` | 12 | Team workflow, code review, incident response patterns |
| `testing` | 10 | Testing strategies, coverage, test architecture |

## Quick Start

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

## CLI Reference

| Command | Description |
|---------|-------------|
| `silo list` | List all stored collections |
| `silo pull <pack> --into <file>` | Pull claims into a claims file |
| `silo store <name> --from <file>` | Store claims from a sprint |
| `silo search <query>` | Full-text search across claims |
| `silo packs` | List available knowledge packs |
| `silo templates` | List saved sprint templates |
| `silo publish <name> --collections <ids>` | Bundle collections into a pack |
| `silo install <file>` | Install a pack from a JSON file |

## How It Works

Silo uses your filesystem for storage (`~/.silo` by default). No database, no network calls, no accounts. Claims are JSON files organized by collection, indexed for search.

When you `pull`, Silo:
1. Resolves the source (built-in pack or stored collection)
2. Re-prefixes claim IDs to avoid collisions
3. Deduplicates against existing claims in the target
4. Merges into your claims.json

When you `store`, Silo:
1. Reads your sprint's claims.json
2. Hashes the content for versioning
3. Saves to `~/.silo/claims/` with metadata
4. Updates the search index

## Programmatic API

```js
const { Store } = require('@grainulation/silo/lib/store');
const { Search } = require('@grainulation/silo/lib/search');
const { ImportExport } = require('@grainulation/silo/lib/import-export');

const store = new Store().init();
const search = new Search(store);
const io = new ImportExport(store);

// Search for encryption-related claims
const results = search.query('encryption', { type: 'constraint' });

// Pull a pack programmatically
io.pull('compliance', './claims.json');

// Store findings
io.push('./claims.json', 'my-sprint-findings');
```

## License

MIT
