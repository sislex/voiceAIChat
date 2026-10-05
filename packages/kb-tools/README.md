# @sislexa/kb-tools

Dependency-free Node.js (20+) CLI for Markdown knowledge bases. Run from a
repository root: `sislexa-kb check|index|log|touch|prepare|verify|search|context|impact`.
No arguments runs check and index. `check --strict` fails on stale topics,
missing package instructions or broken links. Search/context accept `--json`.

Configure `kb.config.json` at the repository root:

```json
{
  "kbDir": "knowledge",
  "packageGlobs": [],
  "indexTitle": "Module knowledge base",
  "logDir": "knowledge/journal",
  "indexPath": "knowledge/INDEX.md",
  "generatedIndexPath": "generated/knowledge"
}
```

All paths are relative to the repository root. `indexPath` is the generated
Markdown index; `generatedIndexPath` is the directory of prepared JSON search
artifacts (replaced by prepare). Keep that directory separate from source files.
Package globs support `*`, `?`, and `**` directory segments; matching packages
with package.json require AGENTS.md. An empty array disables this check.
Topics have YAML frontmatter with title, updated, checked (Git SHA), and areas
(a list of repository-relative source paths). The log and generated index are
excluded from search. `impact` compares origin/main and the working tree;
repositories without origin/main still report working-tree changes.

Without config, Core defaults remain docs/kb, apps/* and packages/*,
"База знаний voiceAIChat", docs/kb/log, docs/kb/README.md and generated/kb.
Release owner: `npm run pack:kb-tools -- <output-directory>` in Core produces
an npm archive and integrity.json. Consumers pin that archive in vendor/.
