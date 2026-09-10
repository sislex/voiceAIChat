# @voicechat/make — standalone Make application

Make owns project workshops, the component showcase, ZIP/URL imports, publications,
REST `/api/make/**`, previews at `/api/preview/make*/*`, public `/p/*` and `/s/*`
links, and the assistant's `/mcp/make` endpoint.
The extraction history is in `docs/plans/make-standalone.md`.

## Language

Write all code comments, JSDoc, Markdown documentation, and generated code comments
or Markdown files in English. Follow this rule for every new change to Make,
including tests and examples. Keep API identifiers and application behavior stable
when translating documentation. Communicate with the user in English.

## Boundaries

- **Make owns files, not database tables.** State lives under
  `<dataDir>/make/<conversationId>`: workshop files, snapshots, notes, grants,
  comments, and task links. Chat, kanban, user, and machine information comes
  through **`MakeCore`** in `packages/make-contracts/src/core.ts`. Core implements
  it in `apps/server/src/makeBridge/localCore.ts` over `db.*`; standalone Make
  uses `HttpMakeCore` to call `/internal/make/core`.
- **Core accesses Make through `MakeService`**: prompt context, turn snapshots,
  file lists, scoped run sources, statistics, cleanup, and event subscriptions.
  `createMakeModule` in `src/module.ts` composes the implementation. Core's remote
  adapter lives in `makeBridge/remote.ts`.
- **Boundary checks** live in `src/boundary.test.ts` and
  `apps/server/src/makeBridge/boundary.test.ts`. Make must not import core,
  database implementations, or runners. Extend `MakeCore` when core data is
  needed; do not import `db`.
- **Authentication belongs to core.** `src/standalone/auth.ts` forwards request
  cookies and Bearer credentials to `/internal/whoami`; reads are cached for
  30 seconds. Routes read `req.user` structurally through `uid(req)`, without
  augmenting `FastifyRequest` again.
- **Run-scope tokens** use the MCP secret for HMAC signing. Core issues them and
  Make validates them, so both remote processes need the same `VC_MCP_SECRET`.
- **Hub events** are `changed`, `presence`, and `turnSnapshot`. In standalone
  mode, `setListener` batches them to `/internal/make/events`; core replays them
  with `apply` and retains ownership of user sockets and the WS contract.
- **Remote requests have two entry paths.** Caddy routes Make paths directly to
  `make:8788`; requests entering through core on port 8787 use
  `apps/server/src/makeBridge/proxy.ts`.
- The backend runs TypeScript through `tsx`, with `.js` extensions on relative
  imports. Internal dependencies include `@voicechat/shared` and
  `@voicechat/make-contracts`.

## Layout

`core.ts`, `service.ts`, `internal.ts`, `taskScope.ts`, and `hub.ts` retain
compatibility exports for contracts owned by `packages/make-contracts`.
`module.ts` composes the application; `workspace.ts` owns workshops; `library.ts`,
`stories.ts`, `transpile.ts`, `zip.ts`, `zipRead.ts`, and `importUrl.ts` implement
component libraries, previews, and imports. `publicHost.ts` intentionally keeps a
small local SSRF guard. `metrics.ts`, `routes.ts`, and `mcp.ts` expose metrics,
REST/publications, and `make_*` tools.

`standalone/` contains configuration, forwarded authentication, the HTTP core
adapter, `buildMakeServer`, and the process entry point.

## Standalone configuration

Set `VC_INTERNAL_TOKEN` and `VC_MCP_SECRET` to the same values as core,
`VC_CORE_URL` to core's address, `VC_DATA_DIR` to the data volume root, and `PORT`
to the Make listener port, normally 8788. Preserve the existing workshop volume
when moving from embedded mode. Configure core with `VC_MAKE_MODE=remote`,
`VC_MAKE_URL`, and `VC_MAKE_MCP_PUBLIC_BASE`, the Make URL visible to the LLM runner.

## Checks and releases

Tests live next to their source files and run with Vitest. Route and MCP tests use
`app.inject()` with a fake `MakeCore`. Local-versus-HTTP contracts and two-process
integration tests live under `apps/server/src/makeBridge/` because they need a
real core database.

Use `npm run gate:fast` during development and `npm run gate:app -- make` for the
complete Make gate. Internal workshop edits do not select full server or UI test
suites. Contract changes add the relevant integration checks.

`npm run build:app -- make --version X.Y.Z --image REGISTRY/REPOSITORY --requires FILE`
builds Make's npm dependency closure without core, web, or Storybook. Dependency
requirements become image metadata. Published releases require a clean checkout,
an immutable image digest, and a compatibility matrix. See
[application releases](../../docs/kb/features/releases.md).
