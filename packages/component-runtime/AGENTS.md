# Component runtime

Keep pure contracts in `packages/shared`. Keep Node persistence, private file I/O,
network verification and the provider CLI here. Never expose token plaintext through HTTP, logs or CLI output;
the CLI writes a newly issued secret only to an explicit exclusive output file.

Preserve lazy loading of `node:sqlite`: legacy desktop still embeds Node 20.
Test scope, expiry, revocation, provider/environment binding, origin and redirect
restrictions, public-user credential preservation and real HTTP integration.
Run this workspace's typecheck/tests and the canonical host gate. Update the
relevant `docs/kb/data-auth.md` and `docs/kb/deploy.md` behavior documentation.
