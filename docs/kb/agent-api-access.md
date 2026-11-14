---
title: External agent access through API tokens
updated: 2026-11-14
checked: f30e2a6c0
areas:
  - packages/shared/src/protocol.ts
  - apps/server/src/routes/rest.apiTokens.test.ts
  - apps/server/src/server.ts
---

# External agent access through API tokens

## API моделей

A models API token has `access: "models"` and a required workspace `tenantId`.
The shared Identity creation contract is
`POST /api/session/api-tokens {name, ttlDays, access:"models", tenantId}`;
listing returns token metadata including tenantId, and DELETE by sid revokes it.
Identity owns membership checks, token issuance and one-time secret display.
Until the Identity release supports issuance of this scope, use an existing
`access:"full"` API token; Core does not mint or reinterpret a user-supplied scope.

Core consumes verified Identity `access`, `sid` and `tenantId` metadata.
Absent access is treated as full for compatibility with older Identity releases.
The legacy signed-session path resolves metadata through the Identity session
port, never through an unverified JWT payload. A models token is accepted only
under `/api/model-runner/v1/`; the global preHandler and shared authenticator
return 403 `{error:"token_scope_denied"}` on other Core routes, including
conversations, token management and personal usage. Use the owner's ordinary
session or full token to inspect `GET /api/me/usage`: its `tokens` array groups
confirmed model-API spending by sid and tenantId in integer micro-USD.

Both models and full tokens require Bearer authentication for model execution.
A models token uses its bound tenant (with a membership check if it differs from
the current account context); full uses the user's active tenant. Caller tenant
headers cannot change this selection. The body cannot select the billed user or
CLI profile. The private runner credential never leaves Core.

See [API models transport and accounting](llm.md#api-моделей) for endpoints,
limits, HTTP errors and the no-tools v1 policy. Full-token transport is covered
against the pinned Identity package; models metadata is covered by a simulated
Identity response/session until its issuing release is installed.


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
