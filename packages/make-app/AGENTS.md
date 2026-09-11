# @voicechat/make-app — Make UI

Standalone panel for the shared web and desktop host. `frontend.tsx` registers the
panel, `panelContract.ts` defines its props, and `panel.css` belongs to it. Change
panel source, unit/DOM tests, and stories in this package.

## Language

Write all code comments, JSDoc, Markdown documentation, and generated code comments
or Markdown files in English. Use English for new test descriptions and examples.
Preserve application behavior when translating comments. Communicate with the user
in English.

## Interface localization

Make supports Russian and English independently of the host. Put interface text in
`src/i18n/messages.ts` or `commonMessages.ts`; use `mt` and subscribe with
`useMakeLocale` in each surface. Use the wrappers in `src/i18n/ui.tsx` for dialogs,
errors, confirmations, and notifications so shared defaults do not leak through.
Translate known server/shared metadata with `localizeMakeText`; preserve project
content, paths, and technical diagnostics. Preview-language emulation is a separate
setting. Add both languages and matching interpolation parameters in the same change.

The Monaco control adapter uses the upstream MIT Russian catalog. After upgrading
Monaco, run `node packages/make-app/scripts/update-monaco-locale.mjs` from the root
and verify find/menu controls in Chromium. Do not translate editor source or remount
its model when switching language. `src/i18n/*test*`, the Monaco adapter DOM test,
and `e2e/make.e2e.test.ts` cover localization and draft preservation.

Localized dialogs and notifications require host API 1.1.0. Keep the minimum in
`release.json` aligned with any shared host UI ports the panel consumes; an older
host must reject the new artifact instead of ignoring translated labels.

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
