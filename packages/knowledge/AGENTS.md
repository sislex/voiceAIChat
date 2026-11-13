# @voicechat/knowledge

Knowledge indexing, search, source lifecycle, scoped visibility, auto-context
and MCP definitions. Read the root AGENTS.md first.

- Inject files, Git, document storage, authorization and model access through
  the ports and service interfaces. Production source must not import Core,
  filesystem/process/network primitives, Fastify or Identity; `boundary.test.ts`
  enforces the dependency boundary.
- Shared owns wire contracts. Core owns HTTP transport, persistent usage tracking,
  operational MCP tools and concrete adapters in `apps/server/src/kb`.
- Failed refreshes preserve the previous successful snapshot. Cover scoped
  visibility and fallback behavior when changing indexing or auto-context.
- Focused checks: `npm run -w @voicechat/knowledge typecheck` and
  `npm run -w @voicechat/knowledge test`.

See [knowledge lifecycle](../../docs/kb/server-internals.md#knowledge-module-lifecycle)
and [repository modules](../../docs/kb/features/project-knowledge-base.md).
