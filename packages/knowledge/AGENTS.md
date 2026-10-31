# Knowledge package

Follow the [root instructions](../../AGENTS.md).
Read [knowledge lifecycle and host ports](../../docs/kb/server-internals.md#knowledge-module-lifecycle)
and [project knowledge](../../docs/kb/features/project-knowledge-base.md).

Public exports live in src/index.ts. Preserve the package boundary: Core supplies
filesystem, Git, persistence, authorization and model execution through ports.
Keep indexing, search, scoped visibility and RPC tests beside their implementation.
