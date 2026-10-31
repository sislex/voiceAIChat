---
title: Данные и доступ: SQLite, пользователи, роли
updated: 2026-11-01
checked: 15683f3af
areas:
  - packages/component-runtime/src/index.ts
  - packages/component-runtime/src/runtime.test.ts
  - packages/component-runtime/src/sharedServices.ts
  - apps/server/src/auth/delegation.ts
  - apps/server/src/makeBridge/proxy.ts
  - apps/server/src/routes/internal.ts
  - apps/server/src/routes/applicationTickets.delegation.test.ts
  - apps/server/src/billing
  - apps/billing
  - packages/shared/src/llmAccounting.ts
  - apps/server/src/db
  - apps/server/src/users
  - apps/identity
  - packages/identity-client
  - packages/identity-contracts
  - apps/server/src/uploads.ts
  - apps/server/src/server.ts
  - apps/server/src/routes/rest.abuse.test.ts
  - apps/server/src/routes/admin.ts
  - packages/shared/src/types.ts
  - packages/shared/src/admin.ts
  - packages/shared/src/deploymentProfiles.ts
  - packages/component-runtime/src/sharedServices.ts
  - packages/component-runtime/src/sharedServices.test.ts
---

# Данные и доступ: SQLite, пользователи, роли

## File storage metadata and quotas

Upload sessions are persisted in `storage_uploads` through both metadata
adapters. Creation reserves the full declared size against the space owner's
quota, including other sessions and ordinary writes; replacements conservatively
reserve their entire size until completion. The same serialized metadata
transaction checks revision conditions and publishes the final entry.
Parts never appear in file listings. Abort removes node parts and any unpublished
composed blob before releasing the quota reservation. Expiry cleanup retries
offline nodes without releasing their reservations prematurely.


`fileStorage/metadata.ts` implements the library's `StorageMetadataStore`
over Core's public SQL adapter. The additive schema creates `storage_spaces`,
`storage_space_refs`, `storage_entries`, `storage_shares`, `storage_acceptances` and a singleton
`storage_lock` row on both SQLite and Postgres. Entry/share/acceptance foreign
keys cascade on deletion. The storage domain owns these tables.

Every metadata transaction first updates the lock row, before reading any
permissions, revision or owner usage. This serializes coordinators across SQL
connections, rolls back failed callbacks and never retries node I/O.
`VoiceChatDb.storageMetadata()` waits for migrations and enters the reentrant
domain lane before SQL. Nested Identity quota reads reuse that lane, avoiding
a deadlock with unrelated repositories waiting for the storage transaction. The common metadata contract runs against memory and SQL;
`VC_TEST_DB_URL` selects an isolated Postgres schema for the SQL tests.

Quota lookup calls `db.identity.getUserStorageQuota(userId)` when that optional
Identity method exists, then normalizes through `storageQuotaBytes()` with
`VC_FILE_STORAGE_DEFAULT_QUOTA_BYTES` (100 MiB by default). Collaborator writes
charge the space owner. Direct shares and accepted links are checked on every
operation; revoking a link deletes its acceptances immediately.

Thumbnail blobs are derived from `(source blobId, size, format)` and have no
`storage_entries` row, so they do not affect owner usage or file count. Replacing
a file changes its blob ID and therefore invalidates the cache key; replacement,
file deletion and space deletion remove the source plus all supported derived
variants. Thumbnail generation accepts at most 32 MiB of source bytes even
though ordinary files may be larger.

### Idempotent chat and Make spaces (SISL-808)

The file-storage coordinator's public `createSpace` delegates to
`StorageMetadataTransaction.createSpace`; application code must not implement a
separate find-then-`putSpace` sequence. For `chat` and `make-project`, the
identity is `(ownerId, kind, ref)` and a repeated or parallel call returns the
existing canonical space. Omitted and null refs are equivalent, while an empty
string is distinct; kind and owner remain separate scopes. Personal spaces are
always new. Existing titles, IDs, timestamps, entries and shares are preserved.
The chat upload path calls this same coordinator method to ensure its chat space.

SQL stores canonical identities in `storage_space_refs`, with the unique
`storage_space_refs_unique` index on `(owner_id, kind, ref_key)` on SQLite and
Postgres. JSON encoding of ref avoids NULL uniqueness differences. An insert
uses `ON CONFLICT DO NOTHING`, then reads the winning space and removes its
unused candidate if another identity won. The shared transaction lock still
serializes coordinators. Low-level `putSpace` is for metadata updates/imports;
application creation must use `createSpace`.

No duplicate merge runs at startup. On first create, an existing group is
adopted by oldest creation time, then ID. All legacy spaces remain available
through `listSpaces`, but the registered canonical identity is returned first;
without one, creation time then ID is the fallback. The memory store persists
the same identity choice. The identity foreign key cascades when its space is
deleted; merge cleanup rebinds it to the survivor in the same transaction.

Owner cleanup is exposed by `POST /api/storage/spaces/:id/merge-duplicates`.
Send `{}` to preview and `{"previewToken":"<returned token>"}` to apply;
`dryRun:true` always previews, while apply without the matching current token
returns 409. The survivor has the most files (ties use oldest creation time,
then ID). For each repeated path, the entry with greatest `updatedAt` wins,
then revision, survivor preference and space ID. Older versions are preserved
under `.duplicates/<sourceSpaceId>/`; numeric subdirectories avoid occupied
archive paths, and overlong source paths use a SHA-256 archive filename. Preview
moves and conflicts expose these destinations through `toPath`.

Apply rechecks the complete group snapshot inside the metadata transaction.
Changed spaces, entries or shares invalidate the token without mutation. Entry
metadata is moved without copying or deleting blobs and retains blob identity,
size and revision. Duplicate spaces and their shares/acceptances are removed,
the survivor's canonical identity is rebound, and owner usage includes all
preserved versions. The action is owner-only; admin status alone does not grant
access. Saved attachment references to removed IDs are not rewritten and must
be reviewed before apply. Contract and HTTP tests cover conflicting versions,
archive collisions, maximum-length paths and canonical ordering for memory and
Core SQL stores.

For manual cleanup: back up metadata and node blobs, inventory duplicates by owner,
kind and ref, preview the server plan, and review files, archive destinations,
revoked shares and saved attachment references before applying its token. Do not
bulk-delete duplicate rows: space deletion cascades metadata and old attachments
use the original space ID. Verify canonical file reads and owner usage afterward.
No startup or production data cleanup runs automatically.

### Make service storage authorization

An enabled local Make with both `VC_APPLICATION_MAKE_TOKEN` and
`VC_APPLICATION_MAKE_SERVICE_TOKEN` participates in ticket delegation, as does
external Make. The Make proxy replaces browser credentials with the trusted
Core ID, Core-to-Make token and a five-minute delegation of `req.user`.
Client-supplied Core IDs, MCP tokens, cookies and delegation headers are removed.

Shared Make calls `/internal/whoami` with its Make-to-Core credential and the
delegation. Core ignores forwarded identity headers on this path and resolves
the current user through the outer authenticated delegation. Missing or revoked
delegations cannot authorize a user.

Make ticket delegations may access `/api/storage/*`; ordinary Identity chat
delegations still cannot. The credential must belong to Make, no cookie may be
mixed in, and the live account/tenant must match. Storage resolves space ACLs for
that user on every request, including reads, writes and shares. Tests in
`routes/applicationTickets.delegation.test.ts` cover the cookie proxy, delegated
whoami, file creation/readback, wrong credentials and revocation.

#### data-storage lookup and repository ownership

This Core checkout has no `docs/kb/data-storage.md`. The service-backend
authorization entry is this section; Make API/UI and project storage belong to
the `make` module listed in [the ownership map](modules.md). Consult
`make:README.md` for owner documentation rather than assuming a Core-local
data-storage topic exists.

#### Browser cookie, shared registry and managed transport

The browser cookie is verified by Core before proxying. The proxy in
`apps/server/src/server.ts` supplies `x-sislexa-core-id`,
`x-sislexa-delegation` and the Core-to-Make bearer. The delegation lasts five
minutes and is issued with `sid: null`; do not describe it as bound to the
browser session's SID. The return call uses the distinct Make-to-Core credential
with the delegation. `TrustedCoreRegistry` in
`packages/component-runtime/src/sharedServices.ts` resolves the Core URL and
credential from the selected `coreId`, validates the target origin and refuses
unknown cores. Its `CoreDelegationClient` attaches the session's delegation and,
when present, tenant. Core's shared `/internal/whoami` authenticates the outer
headers, so identity headers embedded in the forwarded body cannot override the
delegated user.

Removing an explicit internal bearer from a cookie-based storage client is
insufficient if its underlying managed transport is still `fetchImpl`.
`ComponentRuntime.dependency()` in
`packages/component-runtime/src/index.ts` overwrites Authorization with the
component grant on that transport. Its `publicFetchImpl` performs the same
dependency verification but preserves supplied user credentials without adding
the component bearer. User-authenticated Storage API calls need that preserving
transport; shared ticket calls must preserve the intended Make credential and
delegation together. This is not permission to mix a cookie into a ticket call:
Core explicitly rejects that combination. Core's Make browser proxy already
uses `managedMake.publicFetchImpl`. Credential preservation and redirect behavior
are covered by `packages/component-runtime/src/runtime.test.ts`.

#### Verification boundary

The Core integration test
`apps/server/src/routes/applicationTickets.delegation.test.ts` intercepts the
outbound Make request and then exercises delegated whoami and Storage API calls
directly. With two fake storage nodes it creates a `make-project` space, writes
and reads a file, lists that space through the browser cookie, and rejects
another user's access, a wrong application credential, mixed cookie/delegation,
missing or invalid grants and revoked delegations. It does not run two Make
servers or open the Core storage UI.

At merge SHA `49b74141`, the installed `@sislexa/make` source still has the
shared guard rejecting requests without a shared session, MCP context or
single-Core fallback in `apps/make/src/standalone/sharedServer.ts`; its
`standalone/server.ts` constructs the local Make module. This checkout therefore
proves the Core-side authorization contract and transport behavior, not inclusion
of `fix/storage-cookie-session`, the updated Make service-backend wiring, or
successful two-instance stand acceptance. Those require the matching Make owner
revision and its evidence.

Core admin quota management is exposed by `PATCH /api/admin/users/:name`
with `{ storageQuotaBytes: number | null }`. Values must be non-negative safe
integers; zero disallows additional bytes, and null restores the deployment
default. Quota changes are separate from role/LLM-limit changes (mixed bodies
return 400). The route uses the existing admin guard, checks that the user exists,
and calls Identity's `setUserStorageQuota`. The pinned Identity 1.5.2 archive
does not provide FS-3 methods: the setter returns 503 when absent instead of
reporting a successful no-op. Deployments need an FS-3-capable Identity to persist
quota overrides.

`AdminUserInfo.storageQuotaBytes` is the nullable override from Identity's user
row, so listing users does not call a new RPC method on older Identity releases.
When file storage is enabled, `storageUsage` contains the storage service's
`StorageUsage`, including current owner bytes/file count and effective
`quotaBytes` after the deployment fallback. Disabled storage omits usage rather
than reporting zero. Both embedded and standalone admin servers pass the storage
service to the admin routes. Shared IPC declares `admin:setUserStorageQuota`
with `{ name, storageQuotaBytes }` and an `AdminUserInfo` result; Core UI wiring
is a separate consumer change after contract publication.
Route tests in `rest.auth.test.ts` exercise the Identity port, persisted storage
metadata usage, validation, null reset, authorization, missing users and the
pre-FS-3 compatibility response.

## Shared-service ticket redemption diagnostics

`TrustedCoreRegistry.redeem` maps a successful HTTP response that fails
`isEnterTicketRedeemResponse` validation to `ticket_invalid`. Besides requiring a
live session and a valid `sxd_` delegation token, the validator requires the
delegation expiry to be no later than the enclosing session expiry. A fixture
that calculates these two expiries with separate `Date.now()` calls can therefore
fail intermittently when the second clock read advances. Redeem fixtures should
derive both fields from one timestamp, as in
`packages/component-runtime/src/sharedServices.test.ts`.

## Project integration tokens

User API tokens are separate Identity sessions for external agent REST/WS
access. They use bearer authentication without CSRF, retain current user
permissions, support fixed expiration and read-only access, and can be revoked.
See [External agent access through API tokens](agent-api-access.md) for issuance,
administrative management and limits. Core verifies the pinned Identity
integration in `apps/server/src/routes/rest.apiTokens.test.ts`.

Core owns `integration_tokens` through `db.projects` and the table ownership
manifest. Bootstrap adds the table and project index to existing SQLite and
PostgreSQL databases; PostgreSQL uses the DDL generated from `schema.ts`.
Each row keeps its management project in `project_id` and its authorization set
in JSON `project_ids`. Bootstrap backfills legacy rows to `[project_id]` on both
engines.
Deleting a project cascades to its tokens. Records retain creator, creation,
last-use and revocation timestamps; scopes are stored as JSON text.

Only project owners can GET or POST `/api/projects/:id/integration-tokens`
or DELETE it with `{id}` (also supported at `/:tokenId`). Membership or system
administrator status alone does not grant access. POST accepts a nonempty name
of at most 200 characters and nonempty, unique scopes limited to `tasks:external`.
Optional `projectIds` contains 1–50 unique project ids, must include the URL
project, and requires the caller to own every project. The server normalizes the
URL project to the first entry. Omitting it creates a single-project token.
It returns the token view plus `token` once, with `Cache-Control: no-store`.
GET lists active token views without credentials or hashes. DELETE revokes the
record; it never deletes audit metadata. The random 256-bit `sit_` credential is
stored only as a SHA-256 hash.

The existing component/legacy-service authentication boundary on POST
`/internal/whoami` is unchanged. The caller forwards the integration credential
in the RPC body's `headers.authorization` as `Bearer <token>`. The response is
`{ok: true, principal: {kind: 'integration', projectId, projectIds, scopes}}`, without a user
session. Resolution atomically checks revocation and updates `last_used_at`;
unknown or revoked tokens return `{ok: false, status: 401, error: 'unauthorized'}`.
Ordinary user responses retain the existing `user` shape. Consumers must handle
the integration principal explicitly; it is never an ordinary user identity.

The only non-internal entry for an integration is the ingress
`PUT /integrations/v1/projects/:id/external-tasks/:source/:externalId`
(`routes/integrationIngress.ts`), outside `/api/` because the session auth guard
needs a user. Core resolves the token (401 unknown or revoked, 403 when the URL
project is absent from `projectIds` or without `tasks:external`) and forwards the JSON body with the same
credential to Kanban `PUT /api/projects/:id/external-tasks/...`, which re-checks
it through `/internal/whoami`; 503 when Kanban is not remote, 502 when it is
unreachable. Delivery Control board sync (environments-v3 C21) calls this path.

A root request hook rejects integration credentials on every other non-internal Core
route, including public, MCP and WebSocket routes, even alongside a user cookie.
Internal RPCs still require their service grants; integration tokens alone cannot
invoke them. Kanban's scoped external-task admission is a separate consumer task.
`routes/integrationTokens.test.ts` exercises the same real-adapter suite on SQLite
and PostgreSQL (the latter requires the assigned `VC_TEST_DB_URL`), covering
migration, ownership, hashing, isolation, revocation, whoami and route denial.
Deployment and operator commissioning are separate from this implementation.

## Environment configurations

Core owns `environments`, `environment_configurations`, `environment_operations`
and `environment_settings`.
`db.environments` uses the public Identity SQL adapters on SQLite and PostgreSQL;
PostgreSQL DDL is generated from the shared `schema.ts` definitions. Environment
slugs are unique within a project. All user-facing methods require project
membership (denied access throws); definition upserts also require project ownership.
Managed definitions are created by owners and cannot be overwritten through the
external-definition upsert. Only draft or removed managed rows can be reused.
`activeOperation`, `updateOperation`, `setEnvironmentState`, `managedPorts` and
`readSettings` are internal worker methods without user auth.

Configurations are immutable. A transaction locks the environment with an UPDATE
before computing `MAX(revision) + 1`, so independent PostgreSQL connections cannot
allocate the same revision. Operation creation checks both configuration references
against the project and environment. A partial unique index enforces one operation
in any shared `ACTIVE_ENVIRONMENT_OPERATION_STATUSES` state per environment,
including preparing, building, starting and removing. Bootstrap replaces the
stage-1 index with `idx_environment_active_operation_v2` on both engines. Existing
rows become external/ready, configurations default to no Core selection, and old
operations default to apply. Non-null Compose project names are globally unique.

Configurations optionally store a validated Core selection. Settings writes
require ownership and use one transaction; null deletes a setting. Settings and
operation creation lock the same environment row, preventing writes while an
operation is active. The repository stores opaque ciphertext for secrets and
returns storage records only to its callers; API redaction belongs to Kanban.
Managed port lookup spans projects, filters by machine and excludes removed rows.

The B01 contract archive 0.1.14 is pinned in `dependency-snapshots.json`; Core uses
the matching Shared source workspace. The workspace manifest stays at 0.1.10 to
satisfy installed Chat owners' exact peer requirements, as in the existing
independently versioned contract release workflow. `scripts/environment-contracts-snapshot.py`
creates a deterministic local handoff archive whose provenance explicitly records
an uncommitted worktree, its base commit and hashes of every payload file. It does
not claim a committed or registry-published release. Integration can publish a
committed release with `scripts/core-contracts-release.mjs` after review.

`database.environments.test.ts` runs the same repository suite on SQLite and on
PostgreSQL when `VC_TEST_DB_URL` points to the assigned test database. It includes
a separate-connection PostgreSQL revision race, stage-1 database migration and
active-operation uniqueness across environments-v2 statuses. Service deployment,
Kanban/UI integration and production commissioning remain separate tasks.

## Identity repository and request authentication

Identity PR #35 is merged at `67435604554cb27b1442c711c63f200531aaf380`.
Core's Identity 1.5.2 archive `sislexa-identity-1.5.2-d3e0e16d58cd.tgz`
declares source `b71a98ec8ee2bb7ecedc2128a8c7f3184c3ff14e` in
`release-source.json`; its `apps/server/src/users/auth.ts` matches that
merged owner implementation. Archive suffixes are not source commit IDs.

In Identity `users/auth.ts`, POST `/api/session/verify` checks
`signup.enabled` before redeeming a pending token: closure returns 404,
does not create a user/session and leaves the token available after reopening
within its lifetime. Signup requires string name/email/password and returns 400
for other field types; malformed resend email remains a neutral 200 response.
Resend rotates an unexpired pending verification token, invalidating the earlier
link. Verification lifetime is 24 hours; reset lifetime is one hour. Expired
verification returns 400 without a user/session; an expired reset returns 410
on first redemption and 400 on reuse. Successful reset revokes user sessions.
These behaviors live in Identity, not Core's historical users paths below.
Identity `auth.signup.test.ts` at `3a66930564c3bb2baebfc8d3e85a04d15867fa41`
checks all 15 combinations of name/email/password with null, number, boolean,
array and object values, and asserts that closed verification returns neither
cookie nor response token. Its mailbox is an injected in-memory capture;
these tests do not establish SMTP delivery on a deployed stand.


### Core delegated chat adapter

External delegated REST/WS access is disabled by default. Controlled synthetic
acceptance must explicitly set `VC_DELEGATED_CHAT_ENABLED=true`; other values,
including `1`, leave it disabled. The gate applies even when an introspection
client is injected or managed Identity is configured. Ordinary user sessions
continue through their existing authentication path. Compose forwards the flag
with a default of `false`. Enabling it does not itself prove accounting acceptance.

Core accepts `x-sislexa-delegation` on resource-addressed conversation REST
reads and the WebSocket upgrade, including server clients without a browser cookie. The
Identity introspection client verifies the opaque grant for audience `core` on
admission, each command/event and again before execution. Core resolves the live
subject and selected tenant through Identity's account store. When a user session
is also supplied, its account context must match. A project-bound conversation requires both the
conversation permission and the corresponding project permission; scopes remain
paired with resources. Unsupported REST/WS operations fail closed.

`GET /api/chat/context?conversationId=...` and `chat.connect` v1 with
`conversationId` return a versioned connection snapshot (`chat.ready` on WS).
Snapshots contain only the selected conversation grant and no account settings;
reconnect requires resynchronization. REST mutations, settings, list/create/upload,
attachments and child tools remain disabled pending resource-specific adapters.
Execution additionally requires read access to conversation history and project
context. Delegated prompts do not inherit account personalization or instructions.

Application attribution in client bodies is rejected. Queue payloads contain an
opaque server reference with user, tenant, application and grant IDs, never the
bearer. Execution re-introspects the original grant; after process restart the
credential is unavailable and replay is denied. Queues with different references
cannot be merged. Billing reservations and settlements, Core outbox records, and
Runner receipt contexts retain the same immutable origin and executor application
snapshot. Runner normalizes its legacy module field to the authenticated Core
service owner; Core compares application identity separately from that field and
rejects a missing or changed snapshot during recovery. Billing
reports distinguish legacy unattributed work from each application. Delegated sockets do not resume every user queue and
their outbound conversation events are authorized independently. They subscribe
only to the turn feed: account-wide auth, machine, project, CI, preview and tool
feeds are never attached, so filtering at the transport is not the sole isolation
boundary. Closing the socket also discards its in-memory bearer reference.

Standalone credentials support paid text turns through Billing's component-only
delegated admission. Core sends the original opaque grant as a Bearer credential
in `x-sislexa-user-authorization` and `x-sislexa-delegated-billing: 1` on reserve
and start; the managed transport authenticates Core separately. Billing rechecks
the live grant and account with Identity. Core binds its in-memory reference to
the stable account subject, tenant and grant, and rechecks exact conversation and
project scopes before reserve, start and dispatch. The outbox keeps that binding
without a session ID or bearer. Queue replay requires the original in-memory
reference; restart or socket close denies new admission while incurred usage can
still settle through executor authorization. No user session is manufactured and
no unmetered fallback is allowed. REST/WS connection snapshots advertise text
execution only when accounting is configured and the resource permits execution.
MCP/child operations remain explicitly disabled until resource-specific adapters
exist and cannot inherit unrestricted user authority. Legacy session billing is
unchanged. A07 uses an exact owner composition pinned by
`node scripts/a07-composition.mjs`: Identity 1.5.1 `ed6b4009`, Billing `41263c7c`,
Runner `1ccbdeb4`, SDK `f6313db5`, and Analytics `a85d8ff1` (full hashes are in
`vendor/owner-artifacts.json`). Preflight verifies source provenance, archive and
installed bytes, consumer integrity and deployment locks. Passing it alone is
only an artifact check.

Identity's deployed service and embedded Core package must name the same owner
release. Changing only `deploy/tools.lock.json` and Compose leaves the S3 provider
manifest, consumer lock and archive inventory inconsistent. Apply the published
owner archive with `release-composition.mjs`, then reconcile the S3 provider
manifest and A07 exact source before running the Core gate. The 1.5.1 archive is
`sislexa-identity-1.5.1-7e6a30d47be7.tgz`; validation retains the strict source and
integrity checks.

Identity 1.5.1 adds `identity_sign_in_tickets`. Core classifies it as Identity-owned
and excludes its rows from production snapshots alongside sessions, so temporary
stands cannot inherit one-time production sign-in tickets.

`npm run gate:a07` runs a synthetic server-side SDK consumer against published
owner implementations. Runner is a pinned development dependency and its
installed bytes are checked. The harness allocates temporary Core/Runner
loopback listeners, uses the real Identity/Billing/Analytics HTTP handlers and
lets Runner spawn a bounded synthetic Claude CLI child. It verifies one paid
turn, credential rotation/revocation, loss of settlement response, restart and
queue denial, and exact account/application money and token totals. It uses
`DELIVERY_PORTS` and a private attempt root inside delivery attempts, and
otherwise creates disposable local state. The normal tooling gate includes the
loopback command. Identity's billing admission now returns the stable subject
UUID, and Billing's application report supplies the token buckets Analytics
requires. The delegated request remains `textOnly`; pinned Runner accepts this
for Claude but rejects Codex before child startup. Codex support requires a
separately reviewed no-tools execution path and is not certified by A07.
The feature flag remains off by default; passing code acceptance does not claim
production commissioning or deployment.

The synthetic host adapts A05's socket handshake to include the selected
conversation and unwraps Core's scoped connection snapshot for SDK capability
discovery. It is disabled unless explicitly enabled. Core persists admitted
delegated text messages itself, because these clients have no general REST write
permission. A failed queue admission preserves the original payload/reference as
a failed, paused item rather than losing the item after dequeue; a new connection
does not replace the original grant authority.

`server.delegationRegistry.test.ts` exercises Core REST/WS using grants issued,
rotated and revoked by the published embedded Identity repository. It checks
resource isolation, spoof rejection, closed sessions after rotation, stable
application identity after rename/revoke, and disabled execution capability
without Billing. It does not substitute for the SDK/Billing/Runner/Analytics
end-to-end acceptance.

Managed Identity commissioning requires `identity.delegation.introspect` and
`identity.delegation.audience.core` component scopes. The installation template
at `deploy/components/identity.example.json` grants both to Core; existing
installations require a reviewed token update before enabling delegation.
No live credentials are changed by this implementation.

`https://github.com/sislex/identity` owns authentication, registration, recovery,
TOTP, sessions/device trust, the identity SQL repository/schema, login/account UI,
and profile/session packages. Core's `users/*`, identity repository and SQL driver
files are compatibility exports from immutable archives, not local implementations.
`apps/identity` and `packages/identity-*` expose independently gated upstream workspaces.
The pure session-policy archive is separate so importing shared contracts does not
pull React or SQL drivers into Make/Reader builds.

A configured `identity` component dependency replaces Core's public identity port
and `ctx.repos.identity`. Every private HTTP request goes through Identity verify;
Core retains project/resource permission checks. Session endpoints forward IP,
user credentials and CSRF to the protected Identity session RPC, then return its
status/cookies. A service grant authenticates the RPC caller, never the user.
`/internal/whoami` remains the compatibility facade for existing tools, calling the
same verifier. Core WebSocket commands recheck identity; revocation events close
matching sockets. Event cursors include a process epoch to survive Identity restarts.

Identity 1.2.1 preserves `sessionActivity` across RPC as JSON entry tuples; the
client reconstructs the repository Map. Plain JSON serialization of the former
Map produced `{}`, causing both admin user-list requests to fail with
`bulk.activity.get is not a function`. The client rejects malformed or legacy
activity payloads with 503 instead of inventing empty activity. Deploy the
provider before updated Core consumers; no storage migration is needed.

Production migration preserves the existing PostgreSQL identity tables and signing
secret. This retains passwords, active cookies, TOTP and foreign keys. Shared DB
access remains an explicit trust boundary; this extraction does not implement OIDC,
OAuth token exchange or automatic model-cost settlement. Without a
managed Identity dependency, development/tests use the same external implementation
embedded in Core. Historical SQLite migrations stay in Core; current identity DDL
is imported from its owner. PostgreSQL initializers share the schema advisory lock.

Remote user deletion blocks the account/revokes sessions before idempotent Core
cleanup callbacks. A failed callback leaves a blocked, retryable account; credentials
are removed last. This is not a cross-service SQL transaction. Embedded mode retains
its local transaction. Identity currently requires one writer process: login rate
limits and pending TOTP tickets are held in memory.

Identity 1.2.0 adds `identity_subjects`: an opaque stable user ID linked to the
legacy login by a unique foreign key. Existing accounts are backfilled and new
accounts receive the ID in their creation transaction. User deletion cascades;
recreating the same login creates a different ID. The foreign key supports login
updates, but there is no new public rename operation. Live account context returns
`userId`; a changed/missing ID invalidates stale account context. Shared keeps the
field optional for rolling compatibility; Billing requires it and never treats a
login string as a stable identity. The SQL translator preserves both update and
delete foreign-key actions in PostgreSQL.

## Billing reservation service

`sislex/billing` owns the SQLite WAL reservation/settlement ledger. Core's
`apps/billing` delegates to the immutable upstream release. Core accounting
imports portable operation/usage contracts directly from the pinned `@sislexa/sdk`
package owned by `sislex/sdk`; the local SDK re-export workspace is removed. Monetary ledger values
are safe integer micro-USD, separate from raw model tokens. Policies are versioned
per environment and tenant; null is unlimited and zero denies admission. A single
`BEGIN IMMEDIATE` transaction applies monthly budget, request and concurrency
limits before creating a reservation. Request counts include released reservations;
financial attribution stays in the admission UTC month. Active work from an older
month still occupies concurrency slots.

Provider scopes authenticate applications; original user credentials are verified
by Identity at reservation and execution claim time. Billing derives stable user,
tenant, environment and calling application, rejects foreign tenant hints, and
checks product capabilities. Only the owning executor can settle, mark uncertain
or release its operation; settlement remains possible after user logout. Operation
and settlement keys are durably idempotent. Only unclaimed reservations expire;
running or uncertain work requires reconciliation. The execution claim returns a
winner flag, so replay does not authorize a second execution. Actual cost exceeding
the reservation is still recorded; the executor must enforce its own work bound.

Core exposes `/api/billing/account` and `/api/billing/policy` through the managed
Billing dependency. Core checks user authentication and cookie CSRF first, then
forwards a bearer credential without cookies or unrelated headers. Billing policy
mutation requires a system administrator and initially targets only their own
tenant. Missing dependencies return a sanitized 503. SDK/Billing 1.1 add explicit
unbounded admission and immutable provider/estimated usage evidence. Monetary
limits reject unbounded execution, and active unbounded work prevents switching
to a finite monetary policy. Estimates use captured integer micro-USD rates per
million tokens; Billing recomputes the amount and rejects changed replay evidence.

With managed Billing configured, Core wraps every model turn in
`billing/chatAccounting.ts`. The stored conversation kind selects the immutable
origin module (`chat`, `make`, `image-studio`, `web-reader`,
`playwright-reader`, `projects`, or `machines`); a client cannot override it.
The authenticated WebSocket supplies stable subject,
tenant and original session reference; the browser message cannot set them. The
login-based CLI profile key remains unchanged. Queue payloads persist only the
session reference. Credentials stay in memory and are rechecked by Identity at
admission/start. A different login session cannot silently reauthorize old queued
work; reconnect the original session or explicitly send a new request. Accounting
errors pause the queue. Existing finite legacy user limits also reject unbounded
Chat execution instead of being silently discarded.

Core's `chat-accounting.sqlite` is a delivery outbox in its durable data directory,
not a second spending ledger. It records the operation before admission, a
pre-dispatch state boundary, target runner, price snapshot and immutable settlement.
Five-second reconciliation and restart recovery use executor-scoped Billing reads
and runner receipts. A missing runner receipt is fenced before resolving no-spawn;
late network delivery cannot execute an already reconciled operation. Running,
unknown-price or incomplete-usage work retains its hold. Codex usage is the
per-turn delta from the runner's authoritative pre-spawn cumulative baseline, with
cached input separated once. Settlements remain deliverable after user logout.
Back up the outbox together with Core data, Billing's ledger and runner receipts.

In a server configured with `VC_CHAT_TEXT_ONLY=true`, Stop on an ordinary Chat
turn stops display immediately and preserves the visible partial answer. After
dispatch, Core keeps the executor stream open and does not send DELETE or abort:
the computation finishes in the background and Billing settles its authoritative
final usage. Late text, session, init, activity and usage callbacks are suppressed;
the hidden answer never replaces the saved partial. The selected model's hidden
continuation can remain in the runner's thread history. New requests remain
blocked for the same stable user across conversations and tenants until settlement.
The queue stays paused after Stop and requires an explicit resume after settlement;
attempts to resume early preserve its messages. Missing final usage keeps the
uncertain hold. Graceful Core shutdown waits for these executions and their
reconciliation before closing its outbox. A stop before dispatch reconciles the
authoritative no-spawn zero charge. Other server modes, internal modules and
delegated application turns retain hard cancellation; a request's `textOnly`
field cannot enable the public Stop policy. Regression evidence is in
`billing/chatAccounting.test.ts` and the public queue case in `turns.test.ts`.
The accounting test fixture releases its gates and drains accounting before
closing the runner. Its Fastify runner uses `forceCloseConnections: true`:
a connected TCP socket that has sent no HTTP headers otherwise keeps
`runner.close()` pending. A regression explicitly waits for server acceptance
of such a socket and verifies that close completes without client cooperation;
its failure path destroys the socket so the test does not strand `afterEach`.
This bounds fixture transport cleanup without cutting off production background
settlement.

Billing 1.2.0 exposes finalized personal usage reports derived from durable
settlements. Analytics 1.2.0 owns active-time intervals and combines those reports
with deduplicated module activity. Core forwards `/api/analytics/account` and
`/api/analytics/activity` with the verified user credential and fails closed when
Analytics is absent. Analytics outages never bypass accounting or authorize work.
Real payment collection remains outside this increment.

The current external runner request contract and CLI adapters do not carry an
enforceable monetary allocation. Its `LlmRequest.userId` selects an existing CLI
profile directory, so a stable accounting ID must not silently replace that key.
Runner >=0.2.1 adds separate accounting context, durable claims, receipts and a
no-spawn fence. These support accounting recovery but do not establish a monetary
execution bound; finite policies remain rejected for these CLI executors.
As checked on 2026-09-21, the [official Codex configuration reference](https://learn.chatgpt.com/docs/config-file/config-reference)
describes `features.rollout_budget` as token tracking under development; it does
not establish a strict monetary cap. Treating that feature alone as a prepaid
spending guarantee would therefore be an unsupported assumption.

Core recognizes Billing's `daily_user_budget_exhausted` and
`daily_user_operation_active` admission errors and returns actionable chat
messages. A daily threshold is a separate Billing policy; it does not change
Core's rejection of unsupported hard monetary bounds. Enabling daily admission
requires a Billing owner release with that feature, managed installation and
end-to-end verification; a Core-only update cannot enable it.

Legacy WebSocket `claude.cancel` without a conversation ID enumerates only the
authenticated user's active turns and checks each conversation against the
selected tenant before cancellation. It must never call the process-global
`TurnManager.cancel()` with an absent ID. Addressed cancellation retains the same
user/tenant checks. The real WebSocket account-access test holds simultaneous
personal, team and foreign-user turns to verify this boundary.

## Personal tenants, tariffs and product capabilities

`packages/shared/src/accountAccess.ts` defines personal tenant, tariff and effective
product capability contracts. `SystemRole` names the existing authorization role;
`UserRole` and the session `role` field remain compatibility aliases. A tariff
contains only validated product capability IDs, never system privileges or provider
scopes. Plan updates use optimistic revisions. `SessionUser.account` and the
optional `RendererSessionBridge.tariffs` client are additive integration points.
The matching session REST paths are declared in protocol.ts.

Identity 1.1.0 owns `tenants`, `tenant_memberships`, `tariff_plans` and
`tenant_tariffs`. Initialization backfills one personal tenant, owner membership
and Standard assignment per existing user without rewriting credentials, sessions,
roles or later tariff edits. Bootstrap, regular creation and email verification
provision these relationships in the user-creation transaction. SQLite foreign keys
and PostgreSQL advisory-lock initialization protect deletion and concurrent startup.
Standard initially enables every current product capability.

`GET /api/session/account-access` returns the caller's live context. Tariff catalog
and assignment routes under `/api/session/tariffs` and
`/api/session/tariff-assignments` require a system administrator; cookie mutations
retain CSRF checks. Account/recovery/admin endpoints remain available with an empty
tariff. A plan cannot grant a role, project access or a provider scope. Existing
monthly LLM spending limits remain independent. Identity's lazy account editor and
host-injected tariff client serve both standalone and Core account screens.

Every protected HTTP request resolves live Identity context. Optional
`x-sislexa-tenant-id` selects one of the caller's current personal or team
memberships; Identity rejects a tenant that the caller cannot use. Core checks conversation mutations against the stored assistant
kind, authenticates every WebSocket command, and checks product capability before
new turns, queued CI stages and Image Studio model generation. Changed role, tenant,
tariff or revision closes stale sockets. Work already executing is not cancelled
solely because a tariff changes. Tool applications forward the original user
credentials, CSRF and tenant hint; Make no longer caches successful authorization.
Provider grants remain separate from user identity.

Identity 1.4.2 adds team tenants without changing personal tenant IDs. A team has
owner, admin and member roles, a shared tariff assignment, explicit memberships,
and invitations addressed to a normalized login or verified email. Identity stores
only an invitation token hash, applies a seven-day expiry, and resolves membership
again on every request. The browser stores only the selected tenant ID; login and
logout clear that selection. REST requests add `x-sislexa-tenant-id`, while browser
WebSockets use the `tenantId` query because the WebSocket constructor cannot set a
custom header. A selection change reloads the shell so every REST client, socket,
and independently loaded panel starts with one consistent tenant context.

Core stores `tenant_id` and the immutable ownership kind on projects, and
`tenant_id` on conversations. Startup backfills legacy projects to the creator's
personal tenant, project conversations from their project, and standalone
conversations from their creator. Team projects and conversations require the
matching selected team. Explicitly shared personal projects remain visible to
their project members in personal context, preserving the established cross-user
collaboration flow; selecting any team hides them. Conversation lists/search,
direct REST access, WebSocket commands and turn-time entitlement checks use the
selected tenant. A project owner may transfer a project only to a tenant where
that owner has tenant owner/admin authority; the project and all attached
conversations move in one database transaction. Project membership remains
explicit and independent from tenant membership: joining a tenant does not
silently expose every project. Losing the tenant membership makes team resources
unselectable even if an old project membership row still exists.

Billing policies and admission are already keyed by `(environment, tenant)`. Team
members therefore consume the same request, concurrency and monetary allowance,
while settlement evidence keeps the stable individual `userId` for personal usage
reports and percentage attribution. The browser cannot choose a foreign shared
budget because Billing accepts only the tenant returned by live Identity
verification. Prices, payment collection and a token-credit wallet remain outside
this release. See the [tenant/tariff plan](../plans/tenant-tariffs.md) for the
delivery checklist.

## Development preview data isolation

The development runtime constructs its own environment allowlist and a new `test-data` volume for each incarnation. It never accepts an external DSN, database host or existing volume through task configuration. Source snapshots exclude dotenv files, CLI/SSH directories, credential documents, database/backup files and symbolic links. They reject pre-existing snapshot roots. No production data directory is mounted.

Core preview initializes its normal SQLite schema in `/preview-data`. The default seed creates the normal admin account using a per-incarnation random password; `VC_DEVELOPMENT_PREVIEW=true` together with `VC_PREVIEW_SEED=none` suppresses that account. Credentials are not returned in preview status or evidence. Other applications remain responsible for their migration/seed startup code inside the isolated volume.

Task preview settings reuse the CI browser-settings JSON record; no schema migration or production database copy is performed. Browser settings updates preserve the preview configuration.

## Схема

В `conversations` добавлен `preview_engine TEXT NOT NULL DEFAULT 'proxy'`:
миграция сохраняет прежние разговоры в быстром режиме. Выбор Chromium принимается
REST preview-url только для собственного web-recorder; обычный URL-save сохраняет
движок через COALESCE. Создание и чтение Conversation возвращают его явно.

`apps/server/src/db/schema.ts` — единая строка DDL, идемпотентная (`IF NOT EXISTS`),
выполняется при каждом старте. Изменение старых схем по-прежнему делает
`VoiceChatDb.migrate()`; таблица `schema_migrations` хранит маркеры одноразовых
операций над данными. `PRAGMA journal_mode = WAL`, `foreign_keys = ON`.

**Запросы живут в доменных репозиториях, а не в одном классе.** `VoiceChatDb`
(`apps/server/src/db/database.ts`) — только ядро: открывает соединение, применяет
схему и `migrate()`, и раздаёт репозитории `db.identity`, `db.settings`, `db.llm`,
`db.chat`, `db.machines`, `db.projects`, `db.tasks`, `db.ci`, `db.qa`, `db.releases`,
`db.kb` (`apps/server/src/db/repos/<домен>.ts`). Вызов на сервере всегда адресный и
асинхронный: `await db.tasks.getBoard(...)`, `await db.chat.addMessage(...)` — по префиксу
видно, в чей домен идёт обращение. Поля `db.<домен>` — это `AsyncPort<Repo>`: прокси
(`asyncPort()` в `repos/base.ts`), который перед вызовом ждёт готовности базы (`db.ready` —
схема и миграции применяются после конструктора) и пропускает методы через полосу SQLite
(см. ниже). Так реализацию домена можно заменить на удалённую или другой движок, не трогая
вызывающих. Тестам, подменяющим метод (`db.impl.tasks.isTaskClosed = async () => true`,
`vi.spyOn(db.impl.kb, …)`), оставлен доступ к реализациям `db.impl.<домен>` (старое имя
`db.sync` — алиас): подмена уходит в сам репозиторий и видна и порту, и соседям.

**Репозитории асинхронны внутри и не знают драйвера (2026-09-07, `docs/plans/db-postgres.md`).**
Каждый репозиторий пишет SQL в диалекте SQLite с `?`-параметрами и выполняет его через адаптер
`this.sql` (`db/sql/types.ts`: `get/all/run/exec/prepare/transaction`), а не через
`better-sqlite3` напрямую; `better-sqlite3` импортируют только `database.ts` и `db/sql/sqlite.ts`.
Один код репозитория предназначен для двух движков: SQLite сегодня и Postgres (круг 2 плана).
Следствия:
- методы репозиториев — `async`, соседи зовутся `await this.repos.<домен>.<метод>()`;
  транзакция — `await this.sql.transaction(async () => …)`: всё внутри колбэка (включая соседей)
  идёт по соединению транзакции через AsyncLocalStorage, вложенная — SAVEPOINT;
- **тело транзакции не ждёт внешних событий**: у SQLite одно соединение, и на время открытой
  транзакции остальные запросы процесса стоят в очереди (иначе чужой запрос оказался бы внутри
  чужой транзакции);
- **полоса SQLite (`db/sql/lane.ts`)**: методы через порты выполняются по одному, в порядке
  вызова, — это восстанавливает атомарность многошаговых методов, которую раньше давал сам
  синхронный драйвер (два запроса не прочитают одно `max(position)`). Свободная полоса запускает
  тело синхронно, поэтому порядок вызовов без `await` равен порядку выполнения; `close()` ждёт
  опустошения полосы и завершения миграций. Повторный вход из контекста полосы не ждёт;
- тест, который трогает сырой драйвер (`(db as { db }).db.prepare(...)`) или открывает второй
  `VoiceChatDb` на том же файле, обязан `await db.ready` / `await db.close()`; тест с изменяемыми
  часами (`now: () => clock`) обязан ждать каждый вызов — иначе тело прочитает уже переставленные часы.

**PostgreSQL schema installation and additive upgrades (2026-09-11).**
`VoiceChatDb.init()` holds the schema advisory lock for the whole transaction.
It creates missing tables first, compares every generated `PG_SCHEMA.columns`
entry with `information_schema.columns`, adds missing columns, and only then
creates indexes, seeds, foreign keys, and PostgreSQL-specific objects. This
ordering prevents a release from starting with code that queries a column which
`CREATE TABLE IF NOT EXISTS` left absent in an older table. The upgrade plan is
derived from the same `schema.ts` definitions as a fresh PostgreSQL schema, so a
future additive column change does not require a second handwritten PostgreSQL
DDL statement. Semantic data transformations still remain explicit; for example,
the task-level manual-QA flag is copied from its project only when that column is
first added. `database.pgBootstrap.test.ts` recreates this production upgrade
path against a real server when `VC_TEST_DB_URL` is set.

**Postgres как движок всей базы (`VC_DB_URL`, 2026-09-07, `docs/plans/db-postgres.md`).** Тот же
`VoiceChatDb`, тот же код репозиториев: `new VoiceChatDb(path, { postgres: { url } })` открывает
`db/sql/pg.ts` (node-postgres) вместо SQLite. SQL репозиториев остаётся в диалекте SQLite —
`db/sql/dialect.ts` переводит его на каждом запросе (`?`/`@name` → `$n`, `INSERT OR IGNORE` →
`ON CONFLICT DO NOTHING`, `IFNULL`, скалярные `MAX/MIN` → `GREATEST/LEAST`, `LIKE` → `ILIKE`,
`ulower` → `lower`, camelCase-алиасы в кавычки, числовые параметры с явным типом, `? IS NULL` в
литерал, `LIMIT -1` → `LIMIT ALL`, `CASE WHEN $n` → `<> 0`, `substr(x, -N)` → `right`, голые колонки в
`DO UPDATE SET` → `таблица.колонка`). Что текстом не переводится — JSON1 (`json_extract`, `json_type`)
и `strftime` — репозиторий собирает по движку сам (`ChatRepo.j`: `num/text/isNumber/isMissing/valid/
truthy/bucket`). Схема Postgres выводится из `schema.ts` генератором `db/schemaPg.ts` (INTEGER →
BIGINT, REAL → DOUBLE PRECISION, AUTOINCREMENT → BIGSERIAL, у каждой таблицы явный `rowid`, FK
отдельными `ALTER` после всех таблиц, сиды через транслятор) плюс `PG_EXTRA_SQL`: полнотекстовый
индекс `messages.text_tsv` (tsvector, GIN; `toPgTsQuery` в `fts.ts`) вместо FTS5 и plpgsql-триггеры
`cost_dirty`. A new column is declared once in `schema.ts`: `migrate()` upgrades
legacy SQLite files, while the generated PostgreSQL column reconciliation upgrades
existing PostgreSQL tables before the server starts accepting requests. Data can
also be copied initially with `db/copyToPostgres.ts` and its CLI. Прод работает
на Postgres с 2026-09-08 (см. deploy.md). Тесты: `VC_TEST_DB_URL=postgres://…` заставляет каждую `:memory:`-базу
открываться свежей схемой `t_<id>` в Postgres и удалять её в `close()` — так гоняется вся матрица
сервера; контейнеру нужен `-c max_locks_per_transaction=1024` (схемы с сотней таблиц дропаются
одной транзакцией). Тесты сырого драйвера и файловых баз помечены `ON_POSTGRES`; тесты
менеджеров идут на обоих движках — синхронизация в них через `turns.idle()`, `vi.waitFor` на состояние в базе
и первый кадр `claude.active` у WS-сессии, а не через `setTimeout(0)` (аудит параллелизма 2026-09-08 в плане
`db-postgres.md`: найдены и закрыты гонка двойного development-рана и потеря кадров при подписке сессии). `VC_SQL_TRACE=1` печатает каждый
запрос обоих движков и вход/выход методов портов — так ищутся зависания.

`DbDeps.ports` по-прежнему принимает фабрики `(ports) => AsyncPort<Repo>` для домена на другой
реализации (удалённый сервис); PoC pglite для `releases` (`VC_DB_RELEASES`) снят — переход на
Postgres идёт для всей базы сразу, одним кодом репозиториев (`docs/plans/db-postgres.md`).
У каждой таблицы ровно один репозиторий-владелец, и только он в неё
пишет; манифест — `apps/server/src/db/ownership.ts`, проверяет `ownership.test.ts`:
все таблицы схемы имеют владельца, репозитории не импортируют друг друга (соседи —
только через `this.repos.<домен>`), записей в чужие таблицы нет вовсе — каскады
(`identity.deleteUserData`, `machines.deleteAgent`) идут вызовами методов владельцев внутри
одной транзакции инициатора, — чужие чтения через `JOIN` не превышают `CROSS_READ_BUDGET`. **Новая таблица без строки в `ownership.ts`
гейт не пройдёт.** Общие типы строк и чистые помощники нескольких доменов — в
`repos/support.ts`; экспортируемые снаружи имена (`hashAgentToken`, `UserRow`,
`LOGIN_LOCK_*`, `DbDeps`…) по-прежнему импортируются из `db/database.js` через
реэкспорт. Зачем так и что дальше — `docs/plans/db-repositories.md`.

Вся схема — один шаблонный литерал (`export const SCHEMA_SQL = \`…\``), поэтому в
SQL-комментариях внутри него **нельзя обратных кавычек**: они закрывают литерал, и
файл перестаёт разбираться (typecheck падает не в комментарии, а где-то ниже — искать
приходится глазами). Имена таблиц и колонок в комментариях пишутся без кавычек.

| Таблица | Смысл |
|---|---|
| `conversations` | разговор: `title`, таймстемпы, `claude_session_id` (для `--resume`), `user_id`, `exec_target` (изменяемая цель новых ходов чата), `permission_mode` (режим прав только этого чата; NULL — из общих настроек), `status` (persistent-статус жизненного цикла, по умолчанию `developing`) |
| `conversation_context_events` | журнал инспектора контекста: кто (`actor`) и когда включил или выключил источник (`item_id`, `enabled`) в разговоре. `actor` отдельно от `user_id` — админ правит и чужие чаты; повторное выставление того же значения записи не создаёт, поэтому журнал показывает изменения, а не нажатия |
| `conversation_draft_requests` | соответствие `(user_id, idempotency_key)` созданному разговору; обеспечивает повтор первой отправки без дубля и удаляется каскадно вместе с разговором |
| `schema_migrations` | выполненные одноразовые операции над данными |
| `messages` | `role` (`u<N>` для говорящих, `ai`), `text`, `engine`, `meta` (JSON `TurnMeta`), `exec_target` (неизменяемый снимок цели выполнения), каскад по разговору |
| `messages_fts` | FTS5-индекс текста сообщений (`content='messages'`, внешнее содержимое) + `fts_state` — состояние бэкфилла |
| `speakers` | метки говорящих внутри разговора |
| `board_views` | вид доски участника в проекте (фильтры, свимлейны, «скрытые», «завершённые») одной JSON-строкой; `PUT` применяет патч поверх сохранённого |
**Новое поле в `Settings` — сразу в `database.test.ts`.** Тест «сохраняет и
читает настройки» сравнивает объект **целиком** (`toEqual`), поэтому любое
добавленное поле роняет его — и это ровно тот сигнал, ради которого он написан:
поле обязано попасть в контракт осознанно, а не просочиться. За два круга я
наступил на это дважды (`contextPresets`, `defaultContextPresetId`): добавляя
поле в `Settings` и `DEFAULT_SETTINGS`, дописывайте его и в ожидание теста.

**Журнал пишет только то, что пришло в запросе.** `PATCH /api/conversations/:id`
записывает событие настройки, лишь если её ключ есть в теле: иначе простое
переименование чата давало четыре записи «изменил → из общих настроек» (у
настройки не было прежнего значения, и первая запись выглядела изменением).

**Журнал пишет и смену настроек разговора, а не только тумблеры.** У таблицы
есть колонка `value` (добавляется миграцией в `migrate()`): `NULL` — событие
тумблера, где состояние выражает `enabled`; строка — новое значение настройки
(`permission-mode`, `knowledge-mode`, `llm`, `machine`). Пишет
`recordConversationSettingEvent` из `PATCH /api/conversations/:id`, и только при
фактическом изменении: иначе каждый заход в настройки давал бы строку журнала.
Раньше на вопрос «кто понизил режим доступа» не отвечал никто.

| `settings` | key-value, значения — JSON-строки; настройки пользователя лежат под ключом `app:<login>` одной JSON-записью, `getSettings` мержит её с `DEFAULT_SETTINGS` (новое поле не ломает старый конфиг), а `PUT /api/settings` применяет **патч** поверх сохранённого — полная замена стирала бы поля, которых не знает вызывающий клиент. Чтение **фиксирует** дефолты полей, которых в записи не было: иначе «поле появилось в релизе» и «человек выбрал это значение» неотличимы, и смена дефолта молча переезжала бы всем |
| `agents` | машины: `token_hash`, `last_seen`, `policy` (JSON), `user_id` |
| `users` | `name` (PK и он же id владельца), `password_hash`, `role`, `blocked` |
| `session_revocations` | SHA-256 отозванного Bearer-токена и время отзыва; deny-list переживает рестарт сервера |
| `llm_engines` | реестр HTTP-исполнителей LLM для админки: `name`, `kind` (`claude`/`codex`), `base_url`, открытый `token`, `enabled`, `allowed_roles` (JSON-массив ролей), `is_default`, `created_at` |
| `model_prices` | поддерживаемые тарифы Codex/OpenAI: USD за 1M обычных, кэшированных, записанных в кэш и выходных токенов; базовые колонки означают Standard/short context, а `tiers_json` хранит дополнительные сочетания Standard/Batch/Flex/Fast mode и short/long context с nullable-ставками; источник и даты тарифа/обновления; стартовые строки обновляются только через `INSERT OR IGNORE` |

**Фиксированный каталог Codex/OpenAI.** Источник продуктового порядка — `CODEX_MODELS` в `packages/shared/src/types.ts`: `gpt-6-astra`, `gpt-6.1-sol`, `gpt-6-sol`, `gpt-6-luna`, `gpt-5.6-sol`, `gpt-5.6-terra`, `gpt-5.6-luna`, `gpt-5.5`. `DEFAULT_CODEX_MODEL` всегда берётся из первого элемента, поэтому модель по умолчанию — `gpt-6-astra`; неизвестная сохранённая модель остаётся отдельным пунктом UI, но не становится частью каталога. При смене движка в настройках CI выбирается первая разрешённая ролью модель, а при отсутствии разрешённой — первый каталоговый Codex-пресет.

**OpenAI catalog check, 2026-10-25.** Shared's catalog and Standard estimator now include GPT-6.1 Sol, GPT-6 Sol and GPT-6 Luna. Official model pages publish input/cached/cache-write/output rates of `2/0.1/2.5/10`, `2/0.2/2.5/10` and `0.1/0.01/0.125/0.5` USD per million tokens. Long-context rates double input/cache and multiply output by 1.5. The schema seeds these exact rates plus Batch/Flex (0.5x) and Fast (2x), for both contexts; existing manually edited rows are preserved. The effective date records this catalog review, not a claimed provider launch date. The REST price editor accepts up to six decimals, including Luna's fractional cache rates. Shared's fallback estimator still supports Standard only. The current contract does not distinguish 30-minute/12-hour cache writes, regional processing or Ultrafast; the seeded cache-write rate is the default 30-minute rate. Specialized audio, image and restricted-access research models are not general Codex presets. Core UI consumers need a published Shared update to receive the new presets.

Sources: [pricing](https://developers.openai.com/api/docs/pricing), [GPT-6.1 Sol](https://developers.openai.com/api/docs/models/gpt-6.1-sol), [GPT-6 Sol](https://developers.openai.com/api/docs/models/gpt-6-sol), [GPT-6 Luna](https://developers.openai.com/api/docs/models/gpt-6-luna).

**Начальные тарифы OpenAI на 08.09.2026.** Точные Standard/short-context ставки и официальный URL хранятся в seed-блоке `apps/server/src/db/schema.ts`; для `gpt-6-astra`, `gpt-5.6-sol`, `gpt-5.6-terra`, `gpt-5.6-luna` это соответственно `10/1/12.5/50`, `4/0.4/5/20`, `2/0.2/2.5/12`, `0.2/0.02/0.25/1.2` USD за 1M токенов в порядке input/cached input/cache write/output. `INSERT OR IGNORE` делает повторное применение схемы идемпотентным: ручная цена не перезаписывается, а удалённая seed-строка восстанавливается. Контракт новой базы закреплён сценариями `TC-INT-1` и `TC-INT-2` в `apps/server/src/db/database.test.ts`.

| `kb_usage_queries` | обращение к базе знаний: `seq` (монотонный курсор внутри разговора — по нему клиент отсекает устаревшие кадры `kb.usage`), `source` (`auto`/`tool_*`), `status`, `chars`/`est_tokens`, `prompt_chars`, `project_id` — СНИМОК проекта на момент обращения, `ci_run_id`/`ci_step_id` — ран и шаг CI-раннера, если обращение случилось в его ходе (NULL — обычный чат); каскад по разговору |
| `kb_usage_sections` | разделы одного обращения (`document_id`+`anchor`, символы и оценка токенов), каскад по обращению |
| `kb_documents` | статьи базы знаний, которые ведут пользователь и модель: `scope` (`usage`/`user`/`project`), `owner_id` для персональных, `project_id` для проектных (каскад по проекту); файловые темы `docs/kb/*.md` сюда не попадают |

Файл БД — `<dataDir>/voicechat.db` (в Docker `/data`). Тесты работают на
`:memory:` через `BuildOptions.db`. Вложения — `apps/server/src/uploads.ts`
(`POST /api/uploads` → id, путь резолвится в промпт для модели).

Приём `POST /api/uploads` в `apps/server/src/server.ts` ограничен в `preHandler` до валидации содержимого, декодирования и обращения к хранилищу двумя процессными скользящими окнами: не более 300 попыток суммарно и 20 попыток на аутентифицированного пользователя за 60 секунд. Пользовательский ключ не зависит от сессии и IP, поэтому повторный вход или смена адреса бюджет не обходят; другой пользователь сохраняет собственный бюджет, пока не исчерпан общий. Невалидные запросы тоже расходуют лимит. Отказ возвращает 429, `Retry-After` и `{ error: 'upload_rate_limit', retryAfterSec }`; отклонённый трафик не продлевает окно, а перезапуск процесса очищает счётчики. Интеграционный контракт вместе с публичными auth-лимитами закреплён в `apps/server/src/routes/rest.abuse.test.ts`.

`llm_engines` живёт в той же схеме без отдельного migration-фреймворка:
`schema.ts` создаёт таблицу и индексы на новых базах, а `VoiceChatDb.migrate()`
добавляет недостающие колонки и индексы на уже существующих. Это важно для
старых инсталляций: тест на legacy-БД фиксирует, что появление `llm_engines` не
ломает чтение старых `conversations` и не требует ручного шага миграции.

В конструкторе `VoiceChatDb` присвоение `this.newId`/`this.now` идёт **до**
`this.migrate()`: миграции тоже пишут строки (например, досоздание системных
workflow-колонок канбана). Инцидент 2026-08-18 (релиз 0.1.74): миграция
вызывала `this.newId()` до его присвоения, прод падал на старте с
`TypeError: this.newId is not a function`, при этом гейт был зелёным — на
свежей `:memory:`-БД у проектов нет недостающих колонок и ветка не выполнялась.
Урок: миграцию, зависящую от данных, тестируй на переоткрытии файла с
искусственно «состаренной» строкой (см. тест «инцидент 2026-08-18» в
`database.projects.test.ts`), а не только на пустой базе.

`createConversationDraft()` в `apps/server/src/db/database.ts` атомарно создаёт
обычный разговор, применяет проект и сохраняет первую реплику. Ключ запроса уникален
только внутри пользователя; повтор возвращает тот же разговор с сообщениями.
Одноразовая операция `cleanup-empty-manual-drafts-v1` удаляет старые пустые ручные
строки только при полном наборе дефолтных признаков. Проект, задача, служебный тип,
CLI-сессия, переименование или любая настройка сохраняют разговор.

У реестра два инварианта на уровне SQLite: индекс
`idx_llm_engines_kind_enabled` обслуживает список по `kind/enabled/created_at`, а
частичный unique-индекс `idx_llm_engines_default_kind` не даёт держать две
default-записи одного `kind`. Сам токен хранится в БД открытым текстом;
ограничение доступа обеспечивается не схемой, а тем, что CRUD и health-check
висят только на `requireAdmin` в `apps/server/src/routes/admin.ts`.

Отчёт `usageSummary(from, to)` агрегирует всех пользователей одной SQL-выборкой: на дашборд возвращаются totals и `byModel`, включая нулевые строки пользователей. Админский `GET /api/admin/users/usage-summary` защищён `requireAdmin` и принимает необязательные timestamps `from`/`to`.

The PostgreSQL summary materializes filtered message metadata as JSONB once,
groups by user/model, and derives user totals from those groups. Repeated casts
of the original text for every sum, followed by a second aggregate query, caused
roughly 19-second monthly reports on production data. Because Core repository
ports share a serialized lane on PostgreSQL too, this also delayed unrelated
settings, conversation and user-list reads. Keep that ordering for existing
multi-step mutations; optimize the report rather than globally enabling
`DbDeps.concurrent`. Large all-history reports can still be expensive and need
separate reporting projections; the monthly optimization is not such a projection.

`usageReport` also materializes PostgreSQL message metadata, filtering by account
and period before the price join. Its four views retain inclusive dates, model
prices, incomplete/interrupted flags and the full period's conversation choices
even when one conversation is selected. Account reports previously occupied the
shared lane for about 26 seconds during the owner-artifact acceptance. Read-only
production probes of the new monthly queries took 2–8 ms for an empty account and
633–1,034 ms per view for the largest account. SQLite keeps the same query path;
both engines run the owner/date/conversation regression in `usageSummary.test.ts`.

Личные API для виджета — `GET /api/me/usage` и `GET /api/me/llm-access`: оба берут владельца только из `uid(req)`, не из query или URL. У первого те же необязательные `unit` (`hour`/`day`/`week`), `from`, `to` и `conversationId`, что у `GET /api/usage`, и он возвращает `UsageReport`; второй возвращает `UserLlmAccess[]`. Старые `GET /api/usage` и `GET /api/llm-access` остаются сессионными алиасами, но web-мост обращается к новым `/api/me/*` путям.

Видимость статей `kb_documents` считает не БД, а слой БЗ (`apps/server/src/kb/scoped.ts`
поверх «вида» из `kb/access.ts`): персональная статья — только владельцу, проектная —
участникам проекта (`db.projects.getProject(uid, projectId)`), «Использование» — всем. В таблице
хранится только принадлежность; см. `features/project-knowledge-base.md`.

Итоги обращений к БЗ считаются ОТДЕЛЬНЫМ запросом по `kb_usage_queries`, без
JOIN с `kb_usage_sections`: иначе суммы размножаются по числу разделов. `prompt_chars`
суммируется по одному значению на `turn_id` — промпт хода общий для всех его
обращений. Изоляция: отчёт по чату начинается с `getConversation(userId, id)`,
проектный, по рану и по задаче — с `isProjectMember` (иначе 404).
Подробности — `features/kb-usage.md`.

Срез отчёта — это только `WHERE`: итоги (`kbUsageTotals`), разделы
(`kbUsageSections`) и лента (`kbUsageQueries`) — приватные хелперы с общим
условием по алиасу `q`, а чат/проект/ран/задача подставляют своё
(`q.ci_run_id = ?`, для задачи — подзапрос по `ci_runs`). Четыре копии одного
`GROUP BY` разъехались бы в мелочах вроде порядка сортировки, и одни и те же
обращения показывали бы разные числа в чате и в карточке задачи.

`ci_run_id`, `ci_step_id` и индекс `idx_kb_usage_ci_run` добавляет только
`migrate()`, а не `SCHEMA_SQL`: на базе, которая старше этих колонок,
`CREATE TABLE IF NOT EXISTS` их не создаст, и `CREATE INDEX` в общей DDL-строке
уронил бы старт. Тот же приём — у CI-полей `projects` (`ci_kb_context_mode`,
`auto`|`manual`|`off`, дефолт `auto`) и у `ci_runs.kb_context_mode` — снимка
этой настройки на момент старта рана.

**У desktop своя копия схемы** (`apps/desktop/src/main/db/schema.ts`) — меняя одну,
проверь вторую (см. `architecture.md`, раздел про осознанную дубликацию).

## Полнотекстовый поиск по сообщениям (FTS5)

`messages_fts` — виртуальная таблица FTS5 с **внешним содержимым**
(`content='messages'`, `content_rowid='rowid'`): текст не дублируется, индекс
читает его из `messages`. DDL лежит отдельно от `SCHEMA_SQL` —
`MESSAGES_FTS_SQL` в `schema.ts`, и выполняется в `try/catch`: сборка SQLite без
FTS5 не должна валить старт (тогда `searchMessages` просто отдаёт пустую страницу).

Синхронизацию держат три триггера (`AFTER INSERT/UPDATE/DELETE ON messages`).
Отсюда правило: **правки `messages` идут обычным SQL**, чтобы триггеры сработали;
массовая вставка в обход них разошлась бы с индексом молча.

Токенайзер — `unicode61 remove_diacritics 2`: складывает регистр кириллицы и
снимает диакритику с латиницы. Кириллическую «ё» в «е» он **не** превращает —
это разные токены.

Бэкфилл истории (боевая база до фичи) идёт порциями по 500 сообщений через
`unref`-нутый таймер: старт сервера не ждёт индексации 100k сообщений
(`backfillMessagesFts` — одна порция, `ensureMessagesIndexed` — всё сразу, для
тестов и bench). Состояние — таблица `fts_state`: `last_rowid` (докуда дошли),
`max_rowid` (граница на момент старта — всё новее уже проиндексировано
триггерами), `done`, `repairs`. Старт с `last_rowid = 0` начинается с
`'delete-all'`, поэтому повторный запуск или потерянное состояние **пересобирают**
индекс, а не удваивают его; по завершении — `'integrity-check'` и одна попытка
пересборки, если проверка не прошла.

`searchMessages(userId, { q, projectId?, conversationId?, limit, cursor })`:
ранжирование `bm25()` (меньше — релевантнее), сниппет
`snippet(messages_fts, 0, '<mark>', '</mark>', '…', 12)`, курсор — непрозрачная
пара `(score, rowid)` в base64url. Владелец фильтруется джойном на
`conversations.user_id`, поэтому чужие сообщения недостижимы при любых
параметрах (в том числе при явном `conversationId` или чужом курсоре).
Пользовательский ввод превращает в MATCH `toFtsMatchQuery` (`db/fts.ts`): слова в
кавычках, спецсинтаксис FTS обезврежен, последнее незакрытое слово ищется
префиксом. Стоимость запроса линейна по числу совпадений (~2.8 мкс на
совпадение): на 100k сообщений типичный запрос — 5–75 мс, слово, встречающееся в
70% сообщений, — около 200 мс. Замер: `db/search.perf.test.ts`
(`VC_SEARCH_BENCH=1`).

## Пользователи и роли

`UserRole = 'admin' | 'developer' | 'tester' | 'observer'` (`packages/shared/src/types.ts`). **Истёкшая сессия гасится по сигналу транспорта.** `createHttpApi` при 401 зовёт
`notifyUnauthorized()` (`packages/ui/src/remote/session.ts`), мост сессии отдаёт
подписку `onUnauthorized`, а `appRuntime` по ней вызывает `session.actions.expire()`
и чистит пользовательские домены. До этого `expire()` существовал, но его никто не
вызывал: человек оставался на рабочем экране, где каждое действие отвечало тостом
«unauthorized».

Проектные полномочия централизованы в `apps/server/src/users/auth.ts`: `admin` разрешены все текущие и будущие операции; `developer` — просмотр, создание и редактирование задач, запуск и повтор workflow, а также merge; `tester` и `observer` пока не имеют отдельных разрешений. Подготовка release, production deploy, управление пользователями и ролями, а также настройки проекта доступны только `admin`. **Работа с рабочей копией — отдельное полномочие `repository:write`** (панель кода: правка файла, checkout, создание ветки, коммит, push). Оно есть у `developer` и `admin`; `tester` и `observer` рабочую копию только смотрят. Растягивать на это `task:update` (он про поля карточки), `task:merge` (он про попадание в main) или `workflow:start` (он про запуск ранов) было бы неверно: иначе нельзя разрешить запуск CI и запретить ручной коммит. Право проверяется глобальным auth-hook по карте URL (`/api/projects/:id/git/*`, любой POST), а поверх него — режим доступа машины проекту «только чтение» и политика машины `allowWrite: false`: эти два барьера право не обходит. **Создание собственного проекта — исключение: полномочие `project:create` есть у любой роли** (набор `ANY_ROLE_PERMISSIONS`), создатель садится владельцем в `project_members`, и дальше его права внутри проекта определяет проектное владение (`isProjectOwner`), а не глобальная роль. Правило `POST /api/projects → project:create` в `projectPermissionForRequest` обязано стоять **раньше** общего правила про `/api/projects`: то возвращает `project:settings`, и создание снова стало бы админской операцией. Порядок закреплён таблицей в `apps/server/src/users/auth.permissions.test.ts`. Там же зафиксировано, что `/api/projects/` со слешем в конце не классифицируется вовсе — это безопасно только потому, что Fastify поднят без `ignoreTrailingSlash` (`server.ts:220`) и такой URL не совпадает ни с одним маршрутом. `projectPermissionForRequest` классифицирует защищённые HTTP-операции в глобальном auth-hook до обращения к данным, а маршрутные `requireProjectPermission(...)` фиксируют требуемое полномочие рядом с обработчиком; прямой HTTP-запрос поэтому не обходит UI. Админский API принимает все четыре роли при создании пользователя и меняет роль через `PATCH /api/admin/users/:name`. Legacy-роль `user` мигрирует в `developer`, а только конкретные существующие аккаунты ChatAI `admin` и `admin1` повышаются до `admin`, поэтому будущие пользователи автоматически привилегий не получают.

Роль по-прежнему отдельно участвует в `llm_engines.allowed_roles`; это не механизм персонального доступа к моделям. Модели разрешаются через `user_llm_access`: каждая строка deny-list — `(user_name, provider, model_id)`, а `model_id = '*'` запрещает весь provider. Отсутствие строк означает полный доступ, поэтому новые пользователи и модели, позднее добавленные в `CLAUDE_MODELS`/`CODEX_MODELS`, не требуют миграции прав. Внешний контракт и чистые проверки (`isProviderAllowed`, `allowedModels`, `clampModel`, `firstAllowedProvider`) находятся в `packages/shared/src/llmAccess.ts`.

`getUserLlmAccess`/`setUserLlmAccess` читают и атомарно заменяют список запретов. Администратор работает через защищённые `GET/PUT /api/admin/users/:name/llm-access`; PUT принимает только `claude`/`codex`, `*` или известный id модели и убирает дубликаты. Пользователь может прочитать только собственный список через `GET /api/llm-access`. При удалении пользователя строки прав удаляются каскадным внешним ключом таблицы.

Первый запуск на пустой БД создаёт `admin`; пароль берётся из
`VC_ADMIN_PASSWORD` (пусто — без пароля). Если БД уже существует, переменная
ничего не меняет — пароль правится в UI (Настройки → Пользователи). Хеширование —
`apps/server/src/users/passwords.ts`.

## Сессии и авторизация запросов

Core also supplies its existing session signing secret to the dev stand proxy.
The proxy derives stable cookie namespace keys with HMAC-SHA256, allowing a
recreated lease to recognize existing stand cookies after a Core restart.
This does not replace session authentication or project membership checks.
See [stand proxy cookie identity](server-internals.md#dev-stand-access-proxy).

`POST /api/session/login` → подписанный токен (секрет — `<dataDir>` файл, либо
эфемерный; в тестах инъектируется `sessionSecret`). Клиент шлёт
`Authorization: Bearer …` во все `/api/*` и передаёт токен в WS. Глобальный
`preHandler` (`users/auth.ts`) наполняет `req.user`, проверяет блокировку; список
публичных путей — функция `isPublic` там же. Админские роуты — `requireAdmin`
(403 для не-админа).

Каждый login получает отдельный токен: `signToken()` в `users/accounts.ts` добавляет
случайный `sid` в подписанный payload. `POST /api/session/logout` принимает только
действующий текущий Bearer, сохраняет его SHA-256 через `IdentityRepo.revokeSession()`
и удаляет preview-cookie. Глобальная проверка сессии и выпуск preview-cookie сверяются
с `session_revocations`, поэтому отозванный токен не действует и после рестарта;
другие сессии аккаунта и новый login остаются рабочими.

Web-мост `packages/ui/src/remote/index.ts` удаляет `vc.session.token` и переподключает
WebSocket только после успешного ответа logout. При ошибке токен и пользовательское
состояние сохраняются, а store показывает уведомление. Успешный выход очищает
сессионное состояние UI и ведёт на экран входа после подтверждения в меню пользователя.
Он не удаляет чаты, проекты, задачи или настройки и не меняет CLI-профили и входы
Claude, Codex и других внешних сервисов.

**Изоляция данных — по логину**: `uid(req)` возвращает `req.user.name`, и разговоры,
машины и ходы фильтруются по нему. Добавляя роут, работающий с данными
пользователя, обязательно фильтруй по `uid(req)` — забытый фильтр открывает чужие
разговоры. В desktop мостa сессии нет → `authRequired = false` и экран логина не
показывается.

## Админка

Access management (CHAT-453): `GET /api/admin/users` accepts `limit` (1–200),
`offset` (non-negative), `q`, `role`, `state` (`online`, `blocked`, `inactive`),
`sort` (`activity`, `login`, `name`, `spend`) and `asc=1`. Filtering and sorting
precede slicing; requests without pagination retain the full array response.
`DELETE /api/admin/users/:name/sessions` revokes the user's sessions in one
repository update; `{ exceptCurrent: true }` preserves the authenticated SID.
If the current SID is unavailable when targeting oneself, the server refuses
with 409 rather than accidentally ending the current session.
Inactive means no login for 30 days; never-used accounts qualify only after
30 days from creation. Login sorting uses `lastLogin`, not session activity.
`IdentityRepo.setUserRole` locks administrators inside a transaction before
counting them; demoting the last one returns HTTP 409 with an explanatory Russian error.

`GET /api/admin/security?user=<login>&group=login` returns the last 50 login
results, filtering in SQL before LIMIT. `group=prices` selects model-price audit
entries (actor, timestamp and changed base rates) from the same existing journal.
New price writes require finite non-negative values with at most two decimals.
Reset codes remain one hash per user: issuing a new one replaces the previous
code. GET on the existing `/reset-code` path returns expiry with an empty code;
DELETE clears the hash and expiry. The plaintext is only returned on issuance.

`/api/admin/users*` (`routes/admin.ts`, типы в `packages/shared/src/admin.ts`):
список, создание/удаление, блокировка, отчёт по использованию
(`UsageReport`/`UsageUnit`), просмотр чужих разговоров и сообщений. Отчёт принимает
`from`, `to`, `unit` и необязательный `conversationId`, возвращает агрегаты по
бакетам, моделям и разговорам. Для сообщений Codex без `meta.costUsd`
`model_prices` редактируются только админом через `GET/PUT/DELETE /api/admin/model-prices`. `usageReport` всегда возвращает две независимые суммы: `costUsd` (что сообщил CLI) и `costFromPrices` (пересчёт по `model_prices`) для Claude и Codex; `meta.inputTokens`
у всех движков — вход **без** кэша (Codex приводится `TurnManager` и разовой
миграцией `migrateCodexThreadUsage`, см. [llm.md](llm.md)), поэтому SQL берёт его
как есть и отдельно платит за `cacheReadTokens`. Таблица содержит
USD за 1M обычных/кэшированных/записанных в кэш/выходных токенов, URL источника и
даты тарифа/обновления. Базовые четыре поля — Standard/short context; дополнительные
официальные сочетания режима (`standard`/`batch`/`flex`/`fast`) и контекста
(`short`/`long`) лежат в обратно совместимом `tiers_json`, где отсутствующая ставка
равна `null` и показывается как «—». Начальные строки OpenAI сидятся
`INSERT OR IGNORE`, поэтому будущее ручное обновление цен переживает рестарт. Неизвестная модель не получает
семейный выдуманный тариф: её известная часть суммы равна нулю, а в `UsageReport`
ставится `costIncomplete`; UI показывает «—», а не ложные `$0.0000`. UI —
`packages/admin-app/src/UsersAdmin.tsx`. Store административного модуля не использует личные `GET /api/llm-access` и `GET /api/usage`: выбранный пользователь загружается только защищёнными admin-операциями. Host adapter после изменения собственной роли обновляет сессию и собственный LLM access; потеря роли admin очищает store и закрывает модуль. Deny-list остаётся отдельным от роли механизмом и заменяется атомарно.

## Чтение файлов с диска сервера (`/api/files/read`)

Нужно для картинок, которые создаёт сам CLI. Роут отдаёт файл **только** если его
реальный путь лежит внутри «своей» области пользователя: профиль CLI
(`<dataDir>/cli-users/<base64url(логин)>`), каталог загрузок и заданный им
`settings.workdir`. Проверка — `apps/server/src/serverFiles.ts`, и делается она
**после `realpathSync`**: иначе симлинк внутри профиля превращается в чтение любого
файла контейнера. Чужой путь, системный файл и несуществующий дают одинаковый 404 —
по ответу не должно быть видно, что где лежит. Лимит `SERVER_FILE_MAX_BYTES` 32 МБ
(больше → 413). Расширяешь список корней — помни, что это единственная граница.

Сам профиль создаёт уже не сервер: `cliProfiles.ts` переехал в
`apps/llm-runner/src/cli/`. Путь совпадает, пока сервер и исполнитель делят один
`VC_DATA_DIR` (сейчас — один контейнер); разъедутся тома — этот роут перестанет
видеть картинки, созданные CLI.

**Проекты** (таблицы `projects`/`project_members`/`project_machines`/`kanban_columns`/`tasks`, доступ по членству, а не по единственному владельцу) — см. [projects.md](projects.md).

**Rate-limit публичной авторизации.** Реализация принадлежит Identity, а Core проверяет её через настоящие HTTP-маршруты в `apps/server/src/routes/rest.abuse.test.ts`. `POST /api/session/login` считает попытки по IP (30 за 10 минут) и по нормализованному имени без учёта регистра и крайних пробелов (10 за 10 минут), поэтому смена IP не обходит бюджет имени. `POST /api/session/register` ограничен пятью попытками за окно даже для невалидного инвайта; `POST /api/session/signup` — пятью попытками с IP за час, причём ранний невалидный запрос не отправляет письмо. Превышение возвращает 429 с `Retry-After`; после окончания окна запрос снова допускается. Лимитеры живут в памяти процесса и обнуляются после рестарта; за прокси нужен корректный `trustProxy`, иначе клиенты разделят один IP-бюджет.

**Политика пароля (auth-roadmap п.2).** `checkPasswordPolicy(password, { name })` из `@shared/passwordPolicy` — общий для сервера и форм: пустой, короче `PASSWORD_MIN_LENGTH` (10), один повторяющийся символ, из списка частых или содержащий логин → текст причины. `POST /api/admin/users` отвечает 400 с этим текстом; в админке placeholder поля пароля напоминает про 10 символов. Опционально `VC_HIBP_CHECK=1` включает `pwnedCount` (`users/pwned.ts`): SHA-1 пароля, наружу — только 5 hex-символов префикса (`api.pwnedpasswords.com/range/`), таймаут 3 с, ошибка сети — fail-open. Пароли, заведённые до правила (в т.ч. пустые), не трогаются: политика проверяется только при установке.

**Блокировка после неудачных входов (auth-roadmap п.3).** В `users` добавлены `failed_logins`, `locked_until` (мс, wall-clock `Date.now()`, а не тестовые часы БД) и `lock_reason`. `recordLoginFailure(name)` инкрементирует счётчик подряд: с `LOGIN_LOCK_FAILS` (5) ставит `locked_until = now + 15 мин`, с `LOGIN_HARD_LOCK_FAILS` (10) выставляет `blocked = 1, lock_reason = 'auto'`. Логин при действующем замке отвечает 423 с `Retry-After` до проверки пароля; успешный вход вызывает `resetLoginFailures` и `forget` окна rate-limit по имени; `setUserBlocked(name, false)` снимает и замок, и счётчик. Rate-limit по IP поднят до 30/10 мин (NAT), по имени — 10. Уведомление админу — предупреждение в лог сервера (`auth: аккаунт заблокирован автоматически…`) и статусы в `AdminUserInfo` (`failedLogins`, `lockedUntil`, `lockReason`), которые админка показывает бейджами; тесты сбрасывают лимитеры через `app.resetLoginLimiters()`.

**Сессии с TTL и отзывом (auth-roadmap п.4).** Таблица `sessions (sid, user_name, created_at, last_seen, expires_at, ip, user_agent, revoked_at)` плюс метаданные устройства: `label`, `device_key`, `trusted_at`, `platform`, `client_version`, `geo` (JSON), `requests`, `last_path`. Новые колонки добавляет `migrate()` (там же индекс `idx_sessions_device`; в `schema.ts` его нет намеренно — на старой базе схема выполняется до `ALTER TABLE`). `sid` — тот же случайный id, что зашит в payload HMAC-токена (`signToken(user, secret, sid)`, `verifyToken` возвращает `{ name, sid }`). Логин пишет строку (`createSession`, TTL `SESSION_TTL_MS` = 30 дней), каждый запрос проверяет её (`getSession`: отозвана/истекла → 401) и продлевает `last_seen/expires_at` не чаще раза в минуту (`touchSession`, он же считает `requests` и запоминает `last_path`); токены без строки (выданы до таблицы) регистрируются лениво с UA `legacy`, а строка с `revoked_at` уже не воскрешается (`hasSessionRow`). Время сессий — настенное (`Date.now`), а не тестовые часы БД: сроки, `Retry-After` и `Max-Age` измеряются в реальных днях; необязательный `at` у методов существует только ради контрактного набора ядра. Logout отзывает и токен (`session_revocations`), и строку; `POST /api/session/logout-all` гасит все, кроме текущей, а с телом `{ includeCurrent: true }` — вместе с текущей и cookie; `DELETE /api/session/:sid` — одну свою; `PATCH /api/session/:sid { label?, trusted? }` — имя устройства и доверие (чужая сессия отвечает 404, как несуществующая); админ: `GET /api/admin/users/:name/sessions`, `DELETE /api/admin/sessions/:sid`. `pruneSessions()` на старте удаляет истёкшие и отозванные старше недели, суточный `accountsSweep` перед этим гасит брошенные (`revokeStaleSessions`, `VC_SESSION_STALE_DAYS`, 90 дней по умолчанию). Лимит одновременных сессий — `app_config` `sessions.maxPerUser`: превышение вытесняет самые давно неактивные с событием `session_evicted`.

**Модуль «сессии и устройства» переносим.** Логика вынесена в пакет без зависимостей `@voicechat/sessions-core`: разбор User-Agent (`parseUserAgent`), стабильный `deviceKey` (класс устройства + браузер + ОС + подсеть — версия браузера в него не входит, иначе автообновление сбрасывало бы доверие), нормализация IP, политики (`ttlFor`, `isOnline`, `isTrusted`, `isStale`, `overLimit`, `isNewDevice`, `findTrustedDevice`) и порт `SessionStore` с исполняемым контрактом (`@voicechat/sessions-core/testing`). Контракт гоняется дважды: на `InMemorySessionStore` и на SQLite-адаптере `apps/server/src/users/sessionStore.ts` — расхождение поведения всплывает в тестах, а не в проде. UI — `@voicechat/sessions-app` (панель, карточка, окно, стор без react); хост-приложение подключает его в `packages/ui/src/components/SessionsDialogHost.tsx` (окно грузится лениво, иначе бюджет чанка `index-` превышается), админка — в `packages/admin-app/src/AdminSessions.tsx` в режиме `readOnly`. Прежние две разные вёрстки списка (окно аккаунта и `<details>` в админке) заменены одной.

**Доверенные устройства и второй фактор.** Доверие привязано к **секрету устройства**, а не к его приметам: при входе сервер ставит `vc_device` (HttpOnly, SameSite=Lax, 400 дней), в `sessions.device_secret` пишет SHA-256 этого секрета, и `findTrustedDevice` сверяет именно хеш. Ранняя версия сверяла `device_key` (браузер + ОС + подсеть) — эту пару подделывает любой, кто украл пароль и сидит в той же сети, и второй фактор обходился. Клиент без cookie (первый вход, приватное окно, чужой браузер) проходит TOTP как обычно. Хеш наружу не отдаётся: `/api/session/list` и админский список вырезают `deviceSecret`, иначе ответ был бы подсказкой для подбора. `device_key` остался там, где угадываемость не опасна: распознавание нового устройства (`isNewDevice`), подсказка «ещё N сессий этого устройства» и группировка. Electron-оболочка опознаётся отдельным клиентом (`parseUserAgent` проверяет `Electron/` раньше Chrome) — иначе приложение неотличимо от вкладки браузера и делит с ней ключ устройства.

**Что ещё умеет список.** `GET /api/session/list?ended=1` добавляет `ended` — недавно завершённые (отозванные и истёкшие) сессии с `endedAt`, пока их не убрал `pruneSessions`; без параметра лишнего чтения из базы нет. `POST /api/session/panic` — «это не я»: гасит все сессии без исключений, ставит `must_change_password` и пишет событие `session_panic`. Лимит одновременных сессий настраивается в админке (`PUT /api/admin/signup { sessionLimit }`, 0 — без ограничения) и хранится в `app_config` `sessions.maxPerUser`.

**Место входа (гео).** `apps/server/src/users/geo.ts`: приватные адреса подписываются «локальная сеть» офлайн, публичные остаются без места, пока установка не задаст `VC_GEOIP_URL` (шаблон с `{ip}`) — адрес пользователя это персональные данные, и наружу по умолчанию не уходит. Ответ кешируется по подсети, ограничен таймаутом 2 с и fail-open; публичный адрес уточняется в фоне уже после выдачи сессии, чтобы вход не ждал внешний сервис.

**Живые изменения списка.** `SessionHub` (`apps/server/src/users/sessionHub.ts`, аналог `BoardHub`) публикует изменения; WS-соединение знает свой `sid` (прокинут из `server.ts` в `createSession`) и получает адресный `session.revoked`, если завершили именно его, иначе — `sessions.update`. Клиент: мост `window.session.onSessionsChanged`; окно сессий слушает только «список устарел», а выход по `revoked` делает `App` через `session.expire()` — сессию могут завершить и при закрытом окне, а серверный `logout` на мёртвом токене ответил бы 401 и оставил человека на нерабочем экране.

**Cookie-сессия и CSRF (auth-roadmap п.5).** Логин, помимо `token` в теле, ставит `vc_session=<тот же HMAC-токен>; Path=/; HttpOnly; SameSite=Strict` (+`Secure`, если `x-forwarded-proto`/протокол https) и читаемую `vc_csrf` (случайная строка, в теле — `csrf`). PreHandler берёт токен в порядке Bearer → preview-cookie (только на разрешённых путях превью) → `vc_session`; если авторизация пришла из обычной `vc_session`, любой не-GET/HEAD/OPTIONS запрос обязан нести заголовок `x-vc-csrf`, равный cookie `vc_csrf`, иначе 403 `{ error: 'csrf' }` — чужой сайт cookie отправит, заголовок поставить не сможет. WS-upgrade принимает `vc_session` из Cookie, если нет `?token=`. Logout гасит обе cookie (и preview). Web-клиент (`remote/session.ts`) держит Bearer только в памяти после свежего входа, `authHeaders()` добавляет Bearer при наличии и `x-vc-csrf` всегда при cookie-сессии; при старте `migrateLegacyToken` отправляет унаследованный localStorage-токен на `POST /api/session/cookie` и удаляет его из localStorage. `WsClient` получает маркер `'cookie'` вместо токена и подключается без query. Desktop и агенты продолжают ходить с Bearer — для них CSRF не требуется.

Stand preview executor retrieval also passes through Core authentication:
`server.ts` forwards the authenticated lease request cookie in the internal
`app.inject` call to `/api/preview/inspector.js`. The lease's prior owner and
membership checks do not bypass authentication of that internal request.
See [Dev stand access proxy](server-internals.md#dev-stand-access-proxy).

На `/api/preview` специальная HttpOnly `SameSite=Strict` cookie имеет приоритет
над общей сессией: HTML-форма и fetch вложенного сайта не владеют CSRF оболочки.
При прежнем порядке вход в собственный sislexa внутри Reader возвращал `csrf`
ещё до запроса к сайту. Это не расширяет область preview-cookie: обычные API
по-прежнему требуют CSRF или Bearer; недействительная preview-cookie не разрешает
запрос. Проверки — `users/auth.previewSession.test.ts`, полный вход через два
iframe и прокси — `e2e/webReaderProject.e2e.test.ts` (нужны сборки web и recorder).

**Ключ изолированного Chromium (`vc_preview_run`).** Браузерная проверка задачи
открывает dev-сервер машины через прокси превью, а у навигации браузера нет
Bearer-заголовка. Сессионный токен пользователя в профиль Chromium не уезжает:
он работал бы Bearer-ом на всём API. Вместо него `PreviewRunKeys`
(`apps/server/src/browser/machinePreview.ts`) выдаёт ключ на пользователя (сутки,
срок продлевается при выдаче), сервер кладёт его в контекст сессии раннера
cookie `vc_preview_run`, а `previewRunUser` в `auth.ts` принимает его **только**
на точном пути `/api/preview` — на любом другом маршруте ключ бесполезен. Что
можно открыть этим ключом, решает прежний `canUse` прокси: машины, доступные
самому пользователю. Подробности транспорта —
[playwright-reader.md](features/playwright-reader.md).

**Имена cookie разведены по схеме, и это не косметика.** По https сервер ставит `__Secure-vc_session`, `__Secure-vc_csrf`, `__Secure-vc_preview_session`, `__Secure-vc_device` (с флагом `Secure` — префикс без него недействителен), по http — прежние имена без префикса; `cookieNameFor`/`readCookie` в `apps/server/src/users/auth.ts` держат оба варианта, чтение всегда предпочитает защищённое имя. Причина — инцидент 31.08.2026 на проде: он виден и как `https://<ip>` (Caddy), и как `http://<ip>:8787` (порт сервера напрямую), а браузер различает cookie по ХОСТУ, не по схеме и порту. После входа по https в браузере осталась `Secure`-cookie `vc_session`, и по правилу «Leave Secure Cookies Alone» (RFC 6265bis §5.4) незащищённый origin не мог ни прочитать её, ни перезаписать одноимённую: каждый вход по http браузер молча выбрасывал, Bearer жил только в памяти страницы, и любая перезагрузка возвращала экран входа. Диагностика снаружи выглядит так: `document.cookie` не содержит `vc_csrf`, запись cookie с НОВЫМ именем со страницы работает и переживает F5, а запись `vc_csrf` молча игнорируется. Лечение прошлых браузеров — `clearLegacySessionCookies`: вход по https дополнительно гасит старую пару обычных имён (защищённый origin это может, http — нет), поэтому один вход по https чинит адрес без ручной чистки cookie. Если cookie всё же не легла, клиент не молчит: мост отдаёт `hasCookieSession()` (по читаемой `vc_csrf`), и `App` показывает несбрасываемый тост «Вход не сохранён в cookie…» вместо загадочного разлогина. Читатели обоих имён есть и вне `auth.ts` — `cookieToken` для WS-upgrade в `server.ts` и `getCsrf` в `packages/ui/src/remote/session.ts`.

**Второй фактор TOTP (auth-roadmap п.6).** `users/totp.ts` — RFC 6238 (HMAC-SHA1, 30 с, 6 цифр, окно ±1 шаг), base32-секрет, `otpauthUrl`; тесты на векторах RFC. Колонка `users.totp_secret` (NULL — выключено; `UserRow.totpEnabled`). Логин с включённым фактором после верного пароля отвечает `{ requires2fa: true, ticket }` (тикет — в памяти процесса, 5 минут, 5 попыток, одноразовый), `POST /api/session/2fa { ticket, code }` выдаёт сессию тем же `issueSession`, что и обычный вход. Настройка: `POST /api/session/2fa/setup` → `{ secret, otpauth, enabled }` (секрет ждёт подтверждения 10 минут), `POST …/enable { code }` включает, `POST …/disable { code }` выключает, `GET /api/session/2fa` — статус. Клиент: `RendererSessionBridge.login` может вернуть `LoginChallenge`, `sessionStore.twoFactorTicket` переводит `LoginScreen` в режим кода (`onCode`/`onCancelTwoFactor`), `runtime.loginCode`; настройка — пункт меню аккаунта «Двухфакторная защита» → `TwoFactorDialog` (QR не рисуем: otpauth-ссылка и ключ для ручного ввода). WebAuthn/passkeys отложены.

**Журнал безопасности (auth-roadmap п.7).** Таблица `security_events (id, at, user_name, type, ip, user_agent, details)`; `db.logSecurityEvent` пишут: вход (`login`, из `issueSession`), неверный пароль/замок (`login_failed`/`login_locked` с деталями), неверный код 2FA, выход, «выйти везде» (с числом отозванных), включение/выключение 2FA, создание учётки администратором (`password_set`), блокировка/разблокировка админом. Хранятся последние ~50 000 записей (чистка вероятностная при вставке). `GET /api/admin/security?user=&limit=` (до 1000, по умолчанию 200) → `{ events: SecurityEvent[] }`; в админке у выбранного пользователя вкладка «Безопасность» (`admin:securityEvents`, `adminStore.loadAdminSecurity`), неудачи и блокировки подсвечены. Типы — `SecurityEventType` в `@shared/admin`.

**Инвайты и саморегистрация (auth-roadmap п.8).** Таблица `invites` и её контракт описаны в `apps/server/src/db/schema.ts` и `packages/shared/src/admin.ts`; админ создаёт ссылку через `POST /api/admin/invites`, получает список через `GET`, отзывает через `DELETE /api/admin/invites/:token`, а создание фиксируется событием `invite_created`. Гость открывает `#/invite/<token>` — `App` до экрана логина рендерит `InviteRegister` (мосты `session.inviteInfo/register`): `GET /api/session/invite/:token` возвращает роль, срок и заметку либо 404 для истёкшего/исчерпанного инвайта; `POST /api/session/register` проверяет логин и пароль, применяет роль инвайта, атомарно расходует использование, пишет `registered` и сразу выдаёт сессию. `pruneInvites()` чистит истёкшие/исчерпанные записи старше недели.

**Системное приглашение по email (auth-roadmap п.9).** У `POST /api/admin/invites` есть необязательный `email`: маршрут обрезает пробелы, приводит адрес к нижнему регистру, проверяет простую email-форму, сначала сохраняет инвайт, затем через общий `Mailer` отправляет письмо «Приглашение в sislexa» с text/html-вёрсткой и ссылкой `<publicUrl>/#/invite/<token>` (`apps/server/src/routes/admin.ts`). База хранит адрес и время успешного завершения `Mailer.send` в `invites.email`/`emailed_at`; миграция старой SQLite добавляет обе колонки в `VoiceChatDb.migrate()`. Без `VC_SMTP_URL` console-mailer из `apps/server/src/users/mailer.ts` пишет письмо в лог и разрешает вызов, поэтому `emailed_at` выставляется; ошибка SMTP только логируется, не отменяет уже созданный инвайт и оставляет `emailed_at` пустым. Админская форма в `packages/admin-app/src/UsersAdmin.tsx` принимает необязательный адрес, а список показывает получателя и состояние «email отправлен»/«email не отправлен»; инвайт без адреса сохраняет прежний ручной сценарий с копированием ссылки.

**Сброс, временный пароль и смена пароля (auth-roadmap пп.10–12).** Колонки `users.reset_code_hash/reset_code_expires/must_change_password`. Админ: `POST /api/admin/users/:name/reset-code` → `{ code (8 символов A–Z0–9), expiresAt (+24 ч) }`, в БД хранится scrypt-хеш кода, событие `reset_code_issued`; кнопка «Код сброса» в карточке пользователя показывает код один раз. Пользователь на экране входа («Есть код сброса от администратора?») отправляет `POST /api/session/reset { name, code, password }`: политика пароля, лимит 5/час с IP, `redeemResetCode` ставит пароль, снимает код/замок/флаг, все сессии отзываются, выдаётся новая (`password_reset`). Временный пароль: `POST /api/admin/users` с `mustChangePassword: true` (флажок включён по умолчанию) → `SessionUser.mustChangePassword` в ответах login/me; preHandler отвечает 403 `{ error: 'password_change_required' }` на любые не-GET запросы к `/api/*` (сессионные роуты публичны), клиент при этом флаге показывает `ChangePasswordDialog` без возможности закрыть (только сменить или выйти). Смена своего пароля — `POST /api/session/password { current, next }` (текущий обязателен, политика, новый ≠ текущему), остальные сессии отзываются, событие `password_changed`; пункт «Сменить пароль» в меню аккаунта. Аватар — поле `UserPersonalization.avatar` (эмодзи или 1–2 символа) на странице персонализации, показывается в кнопке аккаунта сайдбара.

**Email-вариант сброса (auth-roadmap п.10).** На экране входа «Забыли пароль?» вызывает `POST /api/session/reset/request { email }`; адрес нормализуется, запрос одновременно ограничен `SlidingWindowLimiter` по IP (5/час) и по адресу (3/час), а для неизвестного, заблокированного и существующего пользователя возвращается одно нейтральное сообщение. Для пользователя с подтверждённым email сервер создаёт 32-байтовый base64url-токен на час; `password_reset_tokens` хранит только SHA-256, причём новый токен заменяет прежний для того же пользователя (`apps/server/src/db/database.ts`, `apps/server/src/users/auth.ts`). Письмо ведёт на `#/reset/<token>`, где `ResetPasswordScreen` проверяет политику и совпадение паролей и вызывает `POST /api/session/reset/email`. Токен удаляется при первой попытке применения, истёкшая ссылка получает отдельный 410, успешная смена отзывает все сессии пользователя, очищает cookie текущего клиента и пишет событие `password_reset` с деталями «по подтверждённому email»; использованная или неизвестная ссылка отвечает 400.

**UX входа, «запомнить меня», новое устройство, лимиты, обслуживание (auth-roadmap пп.14–18).** `LoginScreen`: кнопка 👁 показать пароль, предупреждение о Caps Lock (`getModifierState`), галка «Запомнить меня» (по умолчанию включена) → `login { remember }`: `issueSession(…, remember)` даёт TTL 30 дней с `Max-Age` либо 12 часов (`SESSION_SHORT_TTL_MS`) и сессионные cookie; `touchSession` продлевает на собственный интервал сессии. Новое устройство: при входе, если среди живых сессий пользователя нет пары UA+IP, пишется `login_new_device`; `/api/session/me` возвращает `notices` (непросмотренные события после `users.notices_seen_at`), клиент (App) показывает тосты и вызывает `POST /api/session/notices/seen`. На подтверждённый `users.email` одновременно отправляется письмо с временем/IP/User-Agent и ссылками `#/security/password` и `#/security/sessions`; `login_device_emails` ограничивает отправку одной попыткой за 24 часа для `(user, IP, UA)`, ошибка SMTP только логируется и не ломает вход. Пользовательский `Settings.loginNewDeviceEmails` (по умолчанию `true`) выключается в разделе «Безопасность» общих настроек. Роль `observer` — только чтение: `turns.start` отвечает `claude.error`. Лимит расхода: `users.llm_limit_usd` (`PATCH /api/admin/users/:name { llmLimitUsd }`, поле в карточке пользователя), `turns.start` сравнивает месячную стоимость из `usageSummary(начало месяца)` (max из costUsd и costFromPrices) и отказывает при превышении. `users.last_login` обновляется при каждом входе. Суточный `accountsSweep` (server.ts, сразу при старте): `pruneSessions`, `pruneInvites`, `blockInactiveUsers(days)` для не-админов без входов дольше `VC_INACTIVE_DAYS` (180 по умолчанию, 0 — выключить) → `blocked=1, lock_reason='inactive'` и событие `inactive_blocked`.

**Переход на cookie-сессию: одноразовый эффект для открытых вкладок.** Старый бандл берёт Bearer из localStorage на каждый запрос. Как только любая вкладка того же origin загрузит новый бандл, `migrateLegacyToken` переносит токен в cookie и удаляет его из localStorage — соседние вкладки со старым бандлом остаются без Authorization, их мутации идут по cookie без `x-vc-csrf` и получают 403 `{ error: 'csrf' }` до перезагрузки (наблюдалось в Release Center сразу после деплоя 0.1.171). Лечится обновлением вкладки; данных не теряет.

**Открытая регистрация с подтверждением email.** Включается администратором: `PUT /api/admin/signup { enabled, role }` (раздел «Открытая регистрация» над инвайтами в админке; хранится в `app_config` как `signup.enabled`/`signup.role`, роль новых по умолчанию developer). Публичный флоу: `GET /api/session/signup` → `{ enabled }` (клиент показывает ссылку «Зарегистрироваться» только при true); `POST /api/session/signup { name, email, password }` — логин `^[a-zA-Z0-9._-]{3,32}$`, email, `checkPasswordPolicy`, лимит 5/час с IP; заявка ложится в `email_verifications` (хеш токена, хеш пароля, 24 ч; повторная заявка на email/логин заменяет прежнюю), уходит письмо со ссылкой `<publicUrl>/#/verify/<token>`; занятый логин — 409, занятый email — тот же `{ ok: true }` без письма (не раскрываем чужие адреса). `POST /api/session/signup/resend { email }` перевыпускает токен ожидающей заявки. `POST /api/session/verify { token }` создаёт пользователя с ролью из настройки и `users.email` (уникальный индекс), пишет `signup_verified` и выдаёт сессию (`issueSession`); клиент `VerifyScreen` затем перезагружает страницу. Письма — `users/mailer.ts`: собственный SMTP-клиент без зависимостей (`smtp://user:pass@host:587` со STARTTLS или `smtps://…:465`, AUTH PLAIN/LOGIN, base64-тело, multipart text+html); без `VC_SMTP_URL` мейлер «консольный» — письмо целиком пишется в лог сервера (`mail (SMTP не настроен…)`), ответ заявки содержит `mailSent: false`, а экран «Проверьте почту» предупреждает об этом. Переменные окружения: `VC_SMTP_URL`, `VC_MAIL_FROM` (`sislexa <no-reply@домен>`), `VC_PUBLIC_URL` (иначе ссылка строится из `x-forwarded-proto/host`). Для тестов `BuildOptions.mailer` подменяет отправку.

**CSRF на сессионных роутах.** Префикс `/api/session/` публичный и общий preHandler его не проверяет, поэтому мутации, авторизованные cookie (без Bearer), проверяют `x-vc-csrf` сами (`csrfOk`): logout, logout-all, смена пароля, 2FA enable/disable, notices/seen. Инцидент 2026-08-28 на проде: вкладка со старым бандлом, лишившись localStorage-токена после миграции соседней вкладки, отправила `POST /api/session/logout` без Bearer — браузер приложил cookie, и общая сессия администратора была отозвана; после фикса такой запрос получает 403 и cookie не трогает.

**Что сессия помнит о втором факторе.** Колонка `sessions.two_factor` отмечает вход, подтверждённый кодом (или доверенным устройством, которое код когда-то проходило). На ней держится правило: `PATCH /api/session/:sid { trusted: true }` отвечает 409, если у пользователя включена 2FA, а сама сессия код не проходила — иначе доверие выдавалось бы входу, который проверку обошёл. Роль укорачивает срок жизни сессии: `observer` и `tester` получают неделю вместо тридцати дней (`ROLE_SHORT_TTL_MS` в `users/auth.ts`), потому что заходят эпизодически. Мутации сессий (`PATCH`, `logout-all`, `panic`) ограничены общим `SlidingWindowLimiter` — 30 операций за 5 минут на пару «пользователь + адрес»; `app.resetLoginLimiters()` в тестах сбрасывает и его. Массовое закрытие входов (`logout-all` с отзывами и `panic`) шлёт письмо на подтверждённый адрес: если гасил не владелец, письмо — единственный оставшийся у него канал. `GET /api/session/:sid/history` отдаёт события журнала этого устройства (сопоставление по User-Agent и адресу — sid в журнале нет), `DELETE /api/admin/sessions/:sid/trust` позволяет админу снять доверие, не выгоняя человека.

**Журнал знает сессию.** У `security_events` есть `session_sid`: события входа, переименования, доверия и отзыва пишутся с идентификатором сессии, и `GET /api/session/:sid/history` строит ленту по нему. Прежняя привязка по паре «User-Agent + адрес» осталась фолбэком для записей, сделанных до колонки, иначе история старых сессий опустела бы. Сессия помнит и причину конца — `sessions.end_reason` (`revoked`, `evicted`, `panic`, `logout_all`, `admin`, `stale`; истечение срока причины не имеет и выводится из отсутствия отзыва), список завершённых её показывает. Вытеснение лимитом попадает в `unseenSecurityNotices` вместе с входом с нового устройства: сессия исчезла не сама, и человек должен это увидеть. Индексы по колонкам, которые добавляет `migrate()`, объявлять в `schema.ts` нельзя — схема выполняется раньше `ALTER TABLE`; на этом уже дважды спотыкались, теперь есть тест-сторож «старая база без новых колонок открывается без ошибок».

**Устройство, а не набор сессий.** Имя устройства живёт на сессии, но человек мыслит устройством, поэтому: новая сессия подхватывает метку по `device_key` (`deviceLabel`), а `PATCH /api/session/:sid { label }` по умолчанию переименовывает все живые сессии устройства (`renameDevice`); одну сессию можно переименовать явным `scope: 'session'`. Доверенных устройств не больше `TRUSTED_DEVICES_LIMIT` (5) — каждое это дырка во втором факторе, и десяток «своих» ноутбуков её обесценивает; `POST /api/session/untrust-all` снимает доверие со всех разом. Админский список сессий отдаёт сводку `stats: { total, trusted }`. В `unseenSecurityNotices` попадает всё, что случилось с сессиями не по воле человека: чужой вход, вытеснение лимитом и действия администратора (отзыв и снятие доверия) — свои собственные действия туда не идут, это шум.

**Причины замка в инспекторе контекста — три.** `safety` (правила платформы и
приложения), `info` (справочная информация без блока в промпте) и `kind`
(инструмент даёт сам вид чата). Все три живут в `contextGating.ts` вместе с
правилом `isContextToggleable`, и попытка выключить такой пункт через
`POST /api/conversations/:id/context/:itemId` отвечает 400.


**Фальшивый тумблер — главная ошибка этого экрана.** Пункт, объявленный
выключаемым, попадает в `disabledContext` даже если ход про его id не знает:
переключатель работает на вид, значение сохраняется, а на промпт не влияет
ничего. Так однажды получил тумблер автопилот ассистента (`assistant-autonomy`),
хотя это настройка со своим переключателем, а не источник контекста.

Ловится это **составом, а не поведением**: тест «список выключаемых пунктов
зафиксирован» в `rest.conversations.test.ts` сравнивает набор `toggleable`-id
целиком. Проверки по поведению тут бессильны — `includedInNextTurn`
пересчитывается для любого пункта (`value.includedInNextTurn && enabled`), а
«блока и не было» бывает законным (персонализация без полей). Расширяешь
список — сначала научи `turns.ts` читать новый id.

Рядом в контракте есть `ContextSnapshotItem.effect` (`prompt-block` | `tool` |
`skill`): он говорит, что именно делает тумблер, и второй инвариантный тест
сверяет объявление с фактом — инструмент обязан попасть в `--disallowedTools`,
блок промпта — исчезнуть.

## CHECK по scope разговоров и его расширение (2026-09-03)

`conversations.scope` в свежих БД создаётся из `schema.ts` с CHECK-списком
значений; в старых БД колонку добавлял ALTER **без** CHECK. SQLite не умеет
менять CHECK через ALTER, поэтому при добавлении нового scope (последний —
`images`) мало поправить schema.ts: в `migrate()` есть пересборка таблицы —
если в DDL из `sqlite_master` есть `scope IN (...)` без нового значения,
создаётся `conversations_new` с тем же DDL и новым списком, данные копируются,
таблица переименовывается, индексы пересоздаются (под `PRAGMA
foreign_keys=OFF`). Забыть про это — «CHECK constraint failed» только на
свежесозданных инсталляциях, старые работают как ни в чём не бывало.

## Provider-issued component tokens

`packages/shared/src/componentConfig.ts` owns validated release and installation
schemas. The Node-only `@sislexa/component-runtime` package implements private
provider/environment-bound SQLite registries, the issuance/revocation CLI,
compatibility checks and Fastify metadata/readiness endpoints. Credentials use
256 random bits; only their SHA-256 digests, public IDs, consumer, scopes, issuance,
expiry and revocation timestamps persist in the registry. Issuance is bounded by
the configured consumer grant, and expiry is mandatory. A copied registry cannot
be opened under another provider/environment. A second CLI connection can revoke
a token while the service runs. Registry format version mismatches fail closed.

Exact Core RPC paths map to scopes in `routes/internal.ts`. A new route inherits
no managed permission. Managed Make/Playwright service RPC rejects the old shared
token. `identity.verify` permits forwarding a user's original credentials to Core;
it does not authorize a caller-supplied user name. User session/CSRF and resource
ownership checks remain in their existing entry paths. Managed Make disables its
legacy read-auth cache so forwarded user authorization is checked each time.
MCP turn tokens remain a separate boundary. Immutable identity migration,
delegation, durable usage accounting and budget reservation are still planned,
not provided by these component tokens.

Private outgoing files are reread for rotation; successful dependency checks are
keyed by credential digest. Readiness exposes the nearest known expiry and a
seven-day warning without credential values. The installation rotator can recover
expired, non-revoked grants by digest; it never renews a revoked grant. Managed
Identity bootstrap does not block Core startup; requests remain denied with 503
until the dependency's grant is restored. Public proxies retain the user's Authorization header
and do not replace it with a component secret. Readiness failures omit secret
values, private paths and raw upstream response bodies. Installation and rotation
commands are documented in `deploy.md`.

The `identity.core` callback exposes only `loginNewDeviceEmails` from user settings
and only `signup.enabled`, `signup.role`, and `sessions.maxPerUser` from application
configuration. Credentials, model settings and private user instructions are not
returned through that callback. Contract tests reject other configuration keys.

## Cross-domain application enter tickets

`POST /api/applications/:id/enter` requires an ordinary Core user session and an
enabled external application. It returns `{ url }` with
`/_sislexa/enter?core=<coreId>&ticket=<opaque>`. Core stores only a SHA-256 digest of
the random 256-bit ticket plus its bound user/account snapshot, application and
core id. Tickets expire after 60 seconds and are consumed synchronously once.
Wrong application/core bindings do not consume them. Expiry returns `ticket_invalid`;
a replay before expiry returns `ticket_used`. Restart invalidates outstanding tickets;
route redemption to the issuing Core process when running multiple replicas.

Each application has its own server-side `VC_APPLICATION_<ID>_TOKEN`, with uppercase
ids and hyphens replaced by underscores (for example `VC_APPLICATION_WEB_READER_TOKEN`).
`POST /internal/v1/tickets/redeem` accepts `{ ticket, application }`, authenticates
that application's bearer credential, and returns only
`{ user, tenantId, capabilities, expiresAt, delegation: { token, expiresAt } }`. The common `VC_INTERNAL_TOKEN` does
not authenticate this endpoint. Configure the matching service registry secret
separately; no credentials are generated or changed by this feature. Replies are
`no-store`; do not log bodies, Authorization, or entry URLs containing tickets.

`TrustedCoreRegistry.redeem` uses an origin-bound request, disallows redirects,
limits each attempt to five seconds, and retries once only for transport/5xx errors.
A lost success response may result in `ticket_used` on retry: obtain a fresh ticket,
never replay its authority. The returned session carries the selected `coreId`.
Consumers must revalidate their local session against that Core on subsequent
requests and enforce their own cookie/CSRF policy. The ticket itself lives 60 seconds;
the redeemed session `expiresAt` is `SHARED_SESSION_TTL_MS` (8 hours) after redemption.

### Core-issued ticket delegation

Redemption also issues a Core delegation (`apps/server/src/auth/ticketDelegation.ts`):
an opaque `sxd_` + 256-bit token, stored only as a SHA-256 digest in memory and bound
to user, tenant, application, `coreId`, the issuing Core session id and that session's
Billing reference. It expires with the redeemed session and is revoked when the issuing
session is revoked, when the application is no longer an enabled external application
with a credential, or by restart (the service re-enters with a fresh ticket).

The service sends it as `x-sislexa-delegation` together with its own
`authorization: Bearer <VC_APPLICATION_<ID>_TOKEN>`; Core rejects it with another
application's credential, without a credential, or with cookies. It is accepted on the
same delegated routes as Identity grants (`/api/chat/session`, `/api/chat/context`,
`/api/conversations/*` reads and the exchanged `/ws`). `ChatDelegation` authorizes
read/write/execute on conversations the delegated user owns in the delegated tenant
(and their project's tenant), without Identity introspection; `/api/chat/session`
requires an explicit `conversationId`. Delegated turns are admitted through the
issuing user session's Billing reference with application attribution
`{ originApplicationId: <application>, executorApplicationId: 'core', delegationId: null }`;
a build without Billing runs them like the user's own turns. Identity grants keep
their existing behaviour.
Identity-delegated turns go to the runner tool-free (`textOnly`). Ticket-delegated turns of a
shared service do not: they keep that application's MCP tools (B21) and run with
`executionDisabled` and no remote machine, because the Codex runner refuses tool-free runs
(`preview_text_only_unavailable`, the connection closes) and a shared service needs its tools.

### Shared-service RPC and MCP (deployment-profiles B17)

**Service→Core.** On its own internal RPC paths an external application may present
`authorization: Bearer <VC_APPLICATION_<ID>_TOKEN>` instead of `VC_INTERNAL_TOKEN` or a
component grant (`apps/server/src/auth/sharedServiceCallers.ts`, hooks in
`routes/internal.ts`). `SHARED_SERVICE_RPC_ROUTES` in `packages/shared/src/deploymentProfiles.ts`
maps each path to its application and each method to an authority:
`{ user: n }` needs a live ticket delegation (`x-sislexa-delegation`) of the same application
and `args[n]` is filled with / must equal the delegated user; `{ userField }` does the same
for a JSON body (`/internal/image-studio/generate`); `'delegated'` needs a live delegation
(`/internal/make/events`); `'service'` is build-level for that application (Make
`conversationOwner`/`conversationProject`/`taskLinks`/`userExists`/`boardChanged`, Reader
`machineOnline`, all Kanban `/internal/kanban/*`). `{ userArg: n, field }` checks and fills
the field of an object argument (Web Reader `context` and `logBrowserEvidence`, user in
`entry.userId`); Reader `projectResource` is `'delegated'` (the forwarded request carries
the user's own cookie). Web Reader may also call `/internal/playwright-reader/service`
(`execute`/`screenshot`/`control`, user filled) when Playwright Reader runs inside the core.
Anything else is `403 method_denied` (for example Make `machineFs.*`, Reader `listPreviews`). A
delegation of another application or an expired one is `401 delegation_denied`; a missing
one on a user method is `401 delegation_required`. Another application's token or an
unknown path falls through to the unchanged internal-token/component-grant check.
Instead of a ticket delegation the service may present the core MCP token of the turn it is
serving in `x-sislexa-mcp-token` (B21): Core verifies it with that application's
`VC_APPLICATION_<ID>_MCP_SECRET` (`verifyCoreMcpTokenWithSecret`), requires the same
application and this `VC_CORE_ID`, and acts for the token's `userId`; both headers at once,
another application's or core's token, a wrong signature or an expired token are
`401 delegation_denied`. A token with a task `scope` claim is read-only: only the route's
`readMethods` are allowed (Make reads; writes, `projectNotesUpdate` and `/internal/make/events`
are `403 method_denied`). This lets tools work on turns Core runs itself, where the runner
has only the MCP URL and no ticket delegation.
A ticket delegation may also `POST /api/conversations` with exactly its application's
`assistantKind` (`APPLICATION_ASSISTANT_KIND`: make→`make`, image-studio→`images`,
web-reader→`web-recorder`, playwright-reader→`playwright-reader`) and no `scope`.

**Core→service.** For an external application with `VC_APPLICATION_<ID>_SERVICE_TOKEN`
Core calls the service with `authorization: Bearer <service token>`,
`x-sislexa-core-id: <VC_CORE_ID>` and, for user-scoped methods, an `x-sislexa-delegation`
minted server-side in the same store (`sid: null`, 5 minutes,
`apps/server/src/sharedServices/externalService.ts`). Today Make uses it: `promptContext`
and `listFiles` carry the conversation owner's delegation, `adminStats`/`metrics`/`sweep`
none; its events arrive on `/internal/make/events`. Services authenticate the call with
`authenticateCoreRequest(registry, req)` against the entry's `serviceCredentialRef`.

**MCP.** For external applications with `VC_APPLICATION_<ID>_MCP_SECRET` (Make `/mcp/make`,
Image Studio `/mcp/image-studio`, Web Reader `/mcp/preview` — also for the Make browser on the
bound reader conversation — and Kanban `projects` `/mcp/kanban`; `EXTERNAL_MCP_PATHS`,
Playwright Reader has no MCP endpoint of its own), Core puts `<service url>/mcp/<app>?k=<token>` in the runner's MCP list instead
of the build-wide `VC_MCP_SECRET` URL, on the user's own turns and on turns delegated by
the same application only. The token is `sxm1.<base64url JSON claims>.<base64url
HMAC-SHA256 over "sxm1.<payload>">` with claims `{ v: 1, coreId, application, userId,
conversationId, turnId?, scope?, expiresAt }` (6 h). Services verify with
`verifyCoreMcpToken(registry, token)` against `mcpSecretRef`. Task design sources of an
external Make get one token per source conversation (`externalTaskMakeSources`):
`conversationId` is the source Make conversation and `scope: { taskId, projectId, mode, paths }`
bounds what the task run may read; the URL is `…/mcp/make?k=<token>&conv=<source>` with no
separately signed `scope` parameter.

**External Kanban.** With `projects=https://…` in `VC_APPLICATIONS` and
`VC_APPLICATION_PROJECTS_SERVICE_TOKEN`, Core treats the shared Kanban host like the remote
Kanban process but through the shared-service contract (`apps/server/src/server.ts`):
`createRemoteKanban` calls the host with the service credential and `x-sislexa-core-id`
(`externalServiceFetch`), the host's `/internal/kanban/core|events|exec-stream` calls are
accepted with `VC_APPLICATION_PROJECTS_TOKEN` (build-level `'service'` routes), and Core does
not proxy `/api/projects*` or the board UI (`VC_KANBAN_MODE` stays off). Without the service
token an external Kanban stays disabled in Core as before.
