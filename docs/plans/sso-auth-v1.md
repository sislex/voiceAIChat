# sso-auth-v1: one sign-in application for independent Sislexa applications

Owner decisions (2026-11-01):

1. Every application (chat/Core, Storage, Make) is independent. It knows only the
   addresses of the applications it uses and works with a token.
2. A user signed in to Sislexa enters any application without signing in again.
3. Without a session the user is redirected to one sign-in application shared by all
   Sislexa applications, signs in there and is redirected back. The sign-in
   application is **Identity** (`sislex/identity`), running as its own service.
4. Chat configures the Storage address; all file access from chat goes through the
   Storage API with a token. Make does the same.
5. Storage owns the quota (not Identity).
6. Applications may run on one server on different ports, on subdomains, or on
   different servers. Nothing may rely on shared cookies or a shared host.

## Protocol (the contract every card implements)

OAuth 2.1 authorization code flow with PKCE (S256), top-level redirects only, so it
works across ports, subdomains and hosts without third-party cookies.

Identity (sign-in application), base URL `AUTH_URL`:

| Endpoint | Purpose |
|---|---|
| `GET /.well-known/openid-configuration` | discovery: issuer, endpoint URLs, `jwks_uri` |
| `GET /oauth/authorize?response_type=code&client_id&redirect_uri&state&code_challenge&code_challenge_method=S256&scope` | uses the Identity SSO session (cookie on the Identity origin); without one shows the login page, then redirects to `redirect_uri?code&state` |
| `POST /oauth/token` | `grant_type=authorization_code` (+`code_verifier`), `refresh_token`, and `urn:ietf:params:oauth:grant-type:token-exchange` (subject token for audience X) |
| `GET /oauth/jwks` | public keys (ES256 or RS256), with `kid` and key rotation |
| `GET /oauth/logout?client_id&post_logout_redirect_uri` | ends the SSO session and all refresh tokens of that session (global sign-out) |
| `POST /oauth/revoke` | revoke a refresh token |

Clients are registered in Identity with `client_id`, exact `redirect_uris`,
`post_logout_redirect_uris`, allowed audiences for token exchange, and whether they
are confidential (server-side secret) or public (PKCE only).

Access token: JWT, lifetime 10 minutes. Claims: `iss` (AUTH_URL), `sub` (user id,
equal to today's login name so existing data keeps its owner), `aud` (client id or
exchanged audience, for example `storage`), `exp`, `iat`, `jti`, `sid` (SSO session),
`name`, `roles` (for example `admin`), `tenant` (optional), `scope`, and `act`
(the calling application after token exchange, RFC 8693).
Refresh token: opaque, rotating, bound to `sid` and client.

Applications verify access tokens locally with the cached JWKS (no call to Identity
per request), check `iss`, `aud`, `exp`; on unknown `kid` they refresh the JWKS once.

Application configuration (every application):
`AUTH_URL`, `AUTH_CLIENT_ID`, `AUTH_CLIENT_SECRET_FILE` (confidential clients),
`PUBLIC_URL` (own origin for redirect URIs), plus addresses of used applications,
for example `STORAGE_URL`.

Browser sessions in applications: after the code exchange the application keeps its
own session (HttpOnly cookie on its own origin, CSRF header for mutations) holding the
tokens server-side, refreshing them before expiry. APIs also accept
`Authorization: Bearer <access token>` directly.

Application to application: the caller exchanges the user's access token for one with
`aud=<callee>` and calls the callee's API with it. No trusted user headers
(`x-sislexa-user`) and no shared service secrets for user actions.

## Shared client package

`@sislexa/auth-client` (in `sislex/identity`, published as an owner archive like other
packages): discovery + JWKS cache and verification, PKCE login redirect and callback
handler, session store interface (memory and SQL), refresh, token exchange with cache,
Fastify plugin (`requireUser`, `/auth/login`, `/auth/callback`, `/auth/logout`),
fetch helper for calling another application with an exchanged token.

## Storage quota

Storage stores per-user quota (default 100 MB, `STORAGE_DEFAULT_QUOTA_BYTES`), exposes
admin API (`GET/PATCH /api/storage/admin/users/:userId`) for users with role `admin`,
and shows usage and limits in its own UI. A one-time migration copies existing
Identity `storageQuotaBytes` values.

## Tasks

| Id | Repository | Task | Depends on |
|---|---|---|---|
| A1 | sislex/identity | Sign-in application: OAuth endpoints above, client registry, SSO session, login page on its own port, global logout, token exchange, key rotation | — |
| A2 | sislex/identity | `@sislexa/auth-client` package | contract above (parallel with A1, tested against an in-memory fake issuer) |
| A3 | sislex/storage | Storage on auth-client: replace Core enter tickets and `x-sislexa-user`; quota in Storage with admin API and UI | A2 |
| A4 | sislex/voiceAIChat | Core: sign-in through Identity, `STORAGE_URL`, chat files via Storage API with exchanged tokens; remove the trusted-header remote mode | A2 |
| A5 | sislex/sislexa-core-ui | Core UI: login and logout redirects to Identity, Files section talks to Storage through Core with tokens | A4 |
| A6 | sislex/make | Make: sign-in through Identity, files via `STORAGE_URL` with tokens | A2 |
| A7 | operator | Stand M2: Identity, Storage, Make, Core on separate ports; SSO, global logout, chat and Make files; then production rollout plan | A1-A6 |

The current Core sign-in keeps working until A4-A6 are released; then it is removed.
