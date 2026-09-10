# Make contracts and clients

MakeCore/MakeService ports, RPC, events, and scope tokens. Do not import the
application implementation or workshop filesystem code here. Remote core depends
on this package; embedded composition imports `@voicechat/make` separately.

Write all code comments, JSDoc, Markdown documentation, and new test descriptions
in English. Preserve contract identifiers and behavior when translating comments.
Communicate with the user in English.

Public-surface changes require contract checks for Make and
`apps/server/src/makeBridge`. Run `npm run gate:app -- make-contracts`.
