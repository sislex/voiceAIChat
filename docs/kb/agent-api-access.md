---
title: External agent access through API tokens
updated: 2026-10-31
checked: dab1b380
areas:
  - packages/shared/src/protocol.ts
  - apps/server/src/routes/rest.apiTokens.test.ts
  - apps/server/src/server.ts
---

# External agent access through API tokens

## Obtain and manage a token

In the Identity account UI, open the API tokens section, choose a name,
expiration and access level, and copy the newly created token. Keep it in a
secret store: listing tokens returns metadata, not the token value. UI delivery
belongs to the separately published Identity/Core UI artifacts.

An authenticated user session can also call `POST /api/session/api-tokens`
with `{ "name": "External agent", "ttlDays": 365, "access": "full" }`.
The response is `{ token, item }`, with the revocation identifier in `item.sid`.
Administrators with `users:manage` can manage another user's tokens through
the same route with `?user=<URL-encoded username>`; the token acts as that user.
Cookie-authenticated management mutations still require `x-vc-csrf`.

`GET /api/session/api-tokens` returns `{ tokens }` metadata.
`DELETE /api/session/api-tokens/:sid` revokes a token; administrators use the
same `?user=` selector for another user. API tokens cannot create or revoke
API tokens (403); use an ordinary authenticated session for management.

## REST and WebSocket access

Send `Authorization: Bearer <token>` on Core REST requests. No cookie or
`x-vc-csrf` is needed for this bearer authentication, including write requests.
For example, read `/api/me/profile`; administrators can read `/api/admin/users`.
For WebSocket access, pass your API token in the WebSocket URL query parameter named `token`.
Use HTTPS/WSS and keep the query token out of logs and shared URLs.

The Core route map is the `REST` object in `packages/shared/src/protocol.ts`;
token management uses `REST.sessionApiTokens` and `REST.sessionApiToken(sid)`.
Board service routes and their contracts are documented by the Kanban owner
in `kanban:README.md` (its `docs/kb` index; see [module ownership](modules.md)).
Delivery Control uses `/integrations/v1` with its separate project integration
tokens and scopes; see [project integration tokens](data-auth.md#project-integration-tokens).
User API tokens do not replace those integration credentials.

## Ограничения

- A token acts as its user, with that user's current role and project membership.
- The `read` access mode restricts only HTTP methods: GET, HEAD and OPTIONS.
- Token expiration is fixed; activity does not extend it.
- An API token cannot issue another API token; creation requires an ordinary authenticated session.

## Limits, permissions and revocation

Names contain 1–80 characters. `ttlDays` is an integer from 1 to 3650,
defaulting to 365. Expiration is fixed and activity does not extend it.
`access` is `full` by default; `read` permits only GET, HEAD and OPTIONS
and rejects mutations such as `PUT /api/settings` with 403. Do not assume
read-only tokens authorize WebSocket commands merely because a handshake is GET.
Full tokens retain the user's current role, account policy and resource
permissions; they grant no additional access.

Revoked tokens return 401 on subsequent authenticated requests. API sessions
are hidden from device lists but are covered by logout-all, panic and
administrative session revocation. Identity owns token storage and lifecycle;
Core tests its public REST/WS integration in
`apps/server/src/routes/rest.apiTokens.test.ts` against the pinned Identity
archive that provides `/api/session/api-tokens`.
