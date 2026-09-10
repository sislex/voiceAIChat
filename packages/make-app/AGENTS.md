# @voicechat/make-app — Make UI

Standalone panel for the shared web and desktop host. `frontend.tsx` registers the
panel, `panelContract.ts` defines its props, and `panel.css` belongs to it. Change
panel source, unit/DOM tests, and stories in this package.

## Language

Write all code comments, JSDoc, Markdown documentation, and generated code comments
or Markdown files in English. Use English for new test descriptions and examples.
Preserve application behavior when translating comments. Communicate with the user
in English.

## Development boundaries

- Gate: `npm run gate:app -- make-ui`; internal edits select the application.
- Build: `npm run -w @voicechat/make-app build`; use `dev` for the watcher.
- The host loads the artifact through its manifest and SRI. Pass runtime API
  dependencies through props and ports; do not import `@voicechat/ui` or other
  product implementations.
- The host API supplies React, UI kit, and the shared command/route registry.
  Shared editors and dialogs live in `ui-foundation`. Browser DOM access is
  allowed; HTTP/WS transport does not belong in the product panel.
- Public contract changes add targeted host checks. The `make-ui` release uses
  `release.json`, `compatibility.mjs`, and the shared build/matrix/deploy tools.
- `e2e/applicationFrontend.e2e.test.ts` checks the real artifact, shared React,
  desktop URLs, versioning, and integrity without rebuilding the shell.

See the [UI knowledge base](../../docs/kb/ui.md) and
[application releases](../../docs/kb/features/releases.md).
