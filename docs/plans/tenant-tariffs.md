# Personal tenants, tariffs and product capabilities

## Goal and boundaries

Identity extraction shipped as Core 0.1.315 / Identity 1.0.0. This next phase adds
personal tenants and configurable user tariffs without changing existing system
privileges or silently removing existing product access.

System roles remain the existing admin/developer/tester/observer authorization
profiles. `SystemRole` is the explicit name; `UserRole` and the wire `role`
field remain compatible aliases. A tariff never grants administrative or project
permissions. Tenant membership is a third, separate relationship: being the owner
of a personal tenant does not make a user a system administrator.

Identity owns tenants, memberships, the tariff catalog, assignments and effective
capabilities. Core and tool applications consume authenticated account context and
retain their existing resource/project permission checks. Shared public types and
pure capability policy belong to `packages/shared`; Identity consumes a versioned
snapshot of that contract, with no source import from the Core checkout.

## Data model and migration

- `tenants`: opaque stable ID, personal kind, unique owner user, display name and
  creation timestamp. The personal owner has an explicit owner membership.
- `tenant_memberships`: tenant/user primary key, membership role and creation time.
- `tariff_plans`: stable ID, display name, validated product capability list,
  revision and timestamps. No administrative privileges are representable here.
- `tenant_tariffs`: one current tariff assignment per tenant. The initial user
  tariff is the assignment of that user's personal tenant.

Seed a Standard tariff with all currently available product modules enabled.
Backfill exactly one personal tenant, owner membership and default assignment for
all existing users, preserving passwords, roles, sessions and data. Insert missing
rows only; repeated startup must not reset administrator-selected assignments or
plan edits. User creation, bootstrap and email verification must create the user
and personal tenant atomically. Invitation registration uses the same creation
path. Database uniqueness and foreign keys enforce these invariants on SQLite and
PostgreSQL, including concurrent attempts and user deletion.

This release supports personal tenants only. Existing project/resource ownership
by user remains effective; shared organizational tenants and moving resources
between tenants require a separate migration. Incoming tenant hints must match the
server-derived personal tenant, and cannot choose another user's data scope.

## API and enforcement

Resolve current tenant, tariff revision and effective product capabilities from
Identity for authenticated requests. Existing signed sessions remain valid; tariff
information is never trusted from token claims or client input. Product access is
an intersection of live capabilities and existing role/resource permissions.
Administrative/account recovery endpoints remain available independently of product
capabilities, so an administrator can repair an assignment.

Add authenticated account-access reads and admin-only tariff list/create/update,
user assignment and assignment-list operations through Identity session routes.
Cookie mutations retain CSRF checks. Validate IDs, names and capability IDs; reject
unknown fields/capabilities and use revisions for conflicting edits. Provider
credentials remain separate from user sessions and product entitlements.

Enforce capabilities for product HTTP routes, WebSocket commands and LLM execution
entry points. A changed assignment or plan revision invalidates stale socket
handlers. Tests must cover direct tool access and Core-mediated access, blocked
users, tenant spoofing, and inability to obtain system privileges through a tariff.

The existing per-user monthly LLM spend limit stays separate and enforced as before.
Payment collection, monetary tariff prices, token-credit purchases and a distributed
quota reservation ledger are not introduced without a defined commercial model.

## UI and delivery

Show system role, personal workspace, current tariff and enabled modules separately
in My Account. Provide tariff management and user assignment for system admins via
an injected Identity client; components do not access HTTP directly. Load the tariff
editor only when opened so it does not inflate normal account navigation.

- [x] Shared contracts and pure capability policy.
- [x] Identity schema, idempotent backfill and atomic user provisioning.
- [x] Protected tariff APIs and live account context.
- [x] Core/tool HTTP, WebSocket and execution enforcement.
- [x] Account/admin UI, client bridge and independent application behavior.
- [x] SQLite/PostgreSQL migration, isolation and capability regression tests.
- [x] Independent Identity gate, immutable release pins and complete Core gates.
- [x] Backed-up production rollout through installed voicechat-deploy and live checks.
- [x] KB ownership, migration and production evidence updated with the code.

Delivered as Core 0.1.316 / Identity 1.1.1 on 2026-09-20. Production evidence and
backup references are recorded in `docs/kb/deploy.md`.
