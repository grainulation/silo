# Silo Knowledge Packs

A knowledge pack is a portable bundle of claims that can be loaded into any wheat sprint. Packs let you reuse research findings, share domain expertise, and bootstrap new sprints with established knowledge.

## What Is a Pack

A pack is a directory containing a `pack.json` file and optional supporting files. The `pack.json` holds a claims array and metadata describing the pack's origin, scope, and version.

When you load a pack into a sprint, silo merges its claims into your `claims.json` with prefixed IDs to avoid collisions.

## Pack Schema

```json
{
  "name": "postgres-connection-pooling",
  "version": "1.2.0",
  "description": "Research findings on Postgres connection pooling strategies",
  "author": "your-name",
  "schema_version": "1.0.0",
  "created": "2026-01-15T10:00:00Z",
  "updated": "2026-03-10T14:30:00Z",
  "tags": ["postgres", "database", "performance"],
  "claims": [
    { "id": "r003", "type": "factual", "tier": "documented", "status": "active",
      "text": "pgBouncer supports transaction-level pooling",
      "source": "https://www.pgbouncer.org/config.html", "created": "2026-01-15T10:30:00Z" }
  ],
  "metadata": { "original_sprint": "connection-pooling-eval", "claim_count": 42, "compilation_hash": "sha256:abc123..." }
}
```

### Required Fields

| Field | Type | Description |
|---|---|---|
| `name` | string | Unique pack identifier, lowercase with hyphens |
| `version` | string | Semver version of the pack |
| `schema_version` | string | Grainulation schema version (currently `1.0.0`) |
| `claims` | array | Array of claim objects |

### Optional Fields

| Field | Type | Description |
|---|---|---|
| `description` | string | Human-readable summary |
| `author` | string | Pack author |
| `tags` | array | Searchable tags |
| `created` | string | ISO 8601 creation timestamp |
| `updated` | string | ISO 8601 last-updated timestamp |
| `metadata` | object | Arbitrary metadata about the pack's origin |

## Built-in Packs

Silo ships with these packs ready to use:

| Pack | Claims | Description |
|---|---|---|
| `security-baseline` | 28 | OWASP top 10 risks and standard mitigations |
| `api-design` | 34 | REST/GraphQL design constraints and trade-offs |
| `ci-cd-patterns` | 22 | Common CI/CD pipeline patterns and failure modes |
| `data-migration` | 19 | Data migration risks, estimates, and checklists |
| `accessibility` | 31 | WCAG 2.1 AA constraints and testing recommendations |

Load a built-in pack:

```bash
npx @grainulation/silo load security-baseline
```

## Creating Custom Packs

Export claims from any wheat sprint into a pack:

```bash
npx @grainulation/silo pack --name my-findings --from ./claims.json
```

This creates a `my-findings/` directory with `pack.json` inside. You can filter which claims to include:

```bash
silo pack --name db-risks --from ./claims.json --type risk --topic database
silo pack --name tested-only --from ./claims.json --min-tier tested
```

### Editing a Pack

After creation, you can prune or annotate claims before publishing:

```bash
silo pack edit my-findings --retract r015
silo pack edit my-findings --tag "postgres,performance"
silo pack validate my-findings
```

The `validate` command checks schema conformance and flags broken references.

## Publishing Community Packs

Packs are published as npm packages under the `@grainulation-packs` scope:

```bash
cd my-findings/
npm init --scope=@grainulation-packs
npm publish
```

Others can then load your pack by name:

```bash
silo load @grainulation-packs/my-findings
```

### Pack Resolution Order

When loading a pack by name, silo checks these locations in order:

1. Local directory (`./<name>/pack.json`)
2. Silo cache (`~/.grainulation/silo/packs/<name>/`)
3. Built-in packs (bundled with silo)
4. npm registry (`@grainulation-packs/<name>`)

The first match wins. Use `--source npm` to force registry lookup.
