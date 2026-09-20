# Identity repository extraction

Identity owns registration, authentication, password/2FA policy, user sessions,
credential storage, login/account UI, and reusable profile/session components.
Core owns project/resource authorization and aggregates chat, machine and usage data.
Every receiving service authenticates user credentials; a component grant never
substitutes for a user session. Cross-service checks fail closed.

## Delivery

- Publish source-owned server, client/contracts, login/account and shared profile/
  session packages from sislex/identity, with independent gates and start commands.
- Preserve existing users, password hashes, session cookies, session secret, 2FA,
  device trust, rate limits, CSRF, and websocket revocation behavior.
- Use explicit Core ports for project policy, registration settings and account
  reports. Production initially retains the existing PostgreSQL storage to preserve
  relationships and rollback; shared storage is an explicit trust boundary.
- Core consumes pinned releases through adapters. Remove relocated implementation
  and implementation tests; retain host integration tests and transport adapters.
- Audit earlier extractions for remaining local implementation and record every
  retained integration responsibility. Do not remove working behavior as cleanup.
- Run independent and Core gates; publish and deploy with installed voicechat-deploy,
  backups, zero-build-target preflight and live authorization/registration checks.

## Delivery result

Completed in Core 0.1.315 with independent Identity 1.0.0. Both required Core gates,
the independent Identity gate and production verification passed. Existing accounts
and sessions were retained. Production evidence is recorded in
[deploy.md](../kb/deploy.md#production-01315-verification).

## Next phase requested after this release

After the Identity production rollout is verified, introduce user tariffs and keep
system roles, tariff assignment and product capabilities as separate concepts.
Add tenants and automatically create a personal tenant for every new user, with
an idempotent migration for existing users. This follow-up is queued; it is not
part of the Identity extraction release's implemented behavior.

The next phase must cover:

- Separate system administration privileges, tariff assignment, and effective
  product capabilities in storage and API contracts. A tariff must never grant
  system administration or replace resource authorization.
- Model tenant ownership and membership independently of the system role. Create
  exactly one personal tenant with an owner membership for each user, including
  registration, invitation acceptance, administrative creation, and bootstrap.
- Backfill existing users idempotently, preserving their current access and data.
  Document the migration and rollback boundary before changing resource scope.
- Expose tariff assignment and effective capabilities in account/admin interfaces,
  and enforce applicable capability checks on the server. Component service grants
  remain a separate authentication boundary.
- Verify cross-user and cross-tenant isolation, concurrent user creation, repeated
  migration, and the fact that tariff changes cannot elevate system privileges.
  Prices and payment processing are not specified by the current request.
