# Component runtime

Node-only integration for the pure `@voicechat/shared` component configuration
contract. Managed providers require Node 22 or newer. Importing the package without
creating a provider does not load `node:sqlite`, preserving legacy Node 20 desktop
imports. The runtime owns no user accounts, workshop data or billing records.

`createComponentRuntime` loads a release-owned contract and an installation config.
`register` exposes static metadata, authenticated grant introspection and dependency
readiness. `dependency(id).fetchImpl` authenticates internal RPC with that provider's
credential; `publicFetchImpl` verifies compatibility but preserves the user's headers
and returns redirects without following them. `authorize` checks exact incoming
scopes against a private, provider/environment-bound SQLite registry on every call.

The provider CLI issues, lists and revokes tokens. Issue writes an exclusive 0600
file and returns only public token metadata. Registries retain SHA-256 digests of
random 256-bit credentials, never their plaintext. Expiration is mandatory. Policy
changes take effect after restart; CLI revocation is immediately visible to running
processes. Successful outgoing version/grant checks cache for at most five seconds;
credential rotation invalidates the cache. Readiness is diagnostic and does not
replace provider authorization.

See `docs/kb/deploy.md` and `deploy/components/*.example.json` in the host repository
for installation, isolated mounts, local URLs and compatibility boundaries.
