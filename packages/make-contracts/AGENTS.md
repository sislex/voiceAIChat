# Make contracts and clients

MakeCore/MakeService ports, RPC, events, and scope tokens. Do not import the
application implementation or workshop filesystem code here. Remote core depends
on this package; embedded composition imports `@voicechat/make` separately.

Write all code comments, JSDoc, Markdown documentation, and new test descriptions
in English. Preserve contract identifiers and behavior when translating comments.
Communicate with the user in English.

Public-surface changes require contract checks for Make and
`apps/server/src/makeBridge`. Run `npm run gate:app -- make-contracts`.

The `./localization` subpath owns the pure Russian/English system-message catalog,
locale resolution, and interpolation helpers shared by Make UI and HTTP responses.
Add both translations with identical placeholder names. Preserve status codes,
identifiers, and user-supplied details; contract tests cover those boundaries.
