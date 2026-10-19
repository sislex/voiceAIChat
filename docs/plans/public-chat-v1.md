# Sislexa Chat v1 public launch

Status: implementation and acceptance in progress, 2026-10-19. This is a launch
plan, not a claim that the public site or all listed changes are deployed.

## Approved scope

- Public site: `https://sislexa.by`, open registration with verified email and
  password recovery. Real outbound mail is commissioned on the public site;
  local acceptance uses an SMTP capture mailbox.
- Chat only, with Identity account settings needed for passwords and daily quota.
  The deployment selector is `chat,identity`; no other product app is enabled.
  Voice is off; Caddy remains. Core, PostgreSQL and Caddy form the
  product stack, with external Identity/Billing/LLM infrastructure as required.
- Available models: Codex Luna, Terra, Sol. Current shared catalog IDs are
  `gpt-5.6-luna`, `gpt-5.6-terra`, `gpt-5.6-sol`; verify all against the installed
  runner account before opening access.
- Each authenticated user has a $5 calendar-day admission threshold, reset at
  midnight Europe/Minsk. An answer admitted below $5 can finish above it. New
  requests are denied after the threshold. Unresolved work keeps one user slot.
- Production uses a separate service Codex account. The existing M2 login is
  used only for local acceptance. The operator will configure domain DNS on
  2026-10-20; public commissioning remains separate from stand readiness.
- Acceptance uses the existing M2 Docker stand `dev-m2`, gateway port 23001.
  Preserve data and the existing stand-only empty passwords. Production accounts
  must not inherit the stand's password setting.

## Audit baseline

The gateway served Core 0.1.479 with native development overrides over the Docker
base. It did not expose the deployment application manifest. Registration was
open with tester role and no configured mail. Model access was unrestricted;
managed Billing returned 503. The base still contained voice and other apps.
These are observed baseline facts, not the desired deployment configuration.

Identity had signup, verification, recovery, throttling and personal tenants.
A verification link could create a user after signup was disabled: fixed in
[sislex/identity#35](https://github.com/sislex/identity/pull/35), owner gate passed.

Billing had durable monthly accounting and reconciliation but no per-user daily
threshold. [sislex/billing#10](https://github.com/sislex/billing/pull/10) adds the
approved semantics, immutable spending, cross-tenant enforcement and account
balance. Its owner gate passed, including contention and restart tests.

Core now has a deployment model allowlist and an explicit tool-free request
selector in the task branch. Codex previously rejected text-only execution;
runner support is implemented in its owner branch. Offline checks passed on
Codex 0.154.0/Docker and 0.156.1/Mac for all three model fixtures, resume and
unsolicited shell rejection. The local Docker mailbox is operational on
loopback web port 23025 and SMTP port 23125; Core SMTP wiring is pending.
A read-only sandbox by itself does not establish user-data isolation.

## Work and acceptance order

| Work item | Required evidence | Status at audit |
| --- | --- | --- |
| Stand composition | Chat-only application manifest, voice off, Caddy and PostgreSQL healthy; prior data preserved | Pending |
| Registration and recovery | New ordinary account, one-use verification/reset links, closed signup rejects existing links, no account enumeration | Owner fix ready; stand acceptance pending |
| Model selection | Exactly Luna/Terra/Sol visible and enforced at execution; a real answer from each | Core tests and direct real CLI probes passed; Core stand acceptance pending |
| Daily quota | Below-limit admission, final overage, next request blocked, midnight reset, no parallel/tenant/restart bypass | Billing owner gate passed; installation pending |
| Chat lifecycle | First answer, streaming, cancel, retry, reload and history; network interruption does not double-charge | Pending |
| Public UI | Chat navigation only, visible spending/reset and clear quota errors, desktop/mobile acceptance | Pending |
| User isolation | Two synthetic users cannot access each other's chats, files or sessions; CLI exposes no host tools | In progress |
| Release operations | Clean immutable owner pins, full gates, restore drill, health/metrics and rollback evidence | Pending |
| Public commissioning | Domain/TLS, real mail delivery, verification/recovery links use the canonical domain | Awaiting public-site setup |

Kanban epic: `de61c6e3-d53e-4a3c-be93-458164edb646`; its nine child tasks carry
individual acceptance criteria. A task is not Done merely because a unit gate
passed; deployment and required stand evidence remain part of acceptance.

## Promotion and rollback

1. Finish owner changes and review their PRs. Publish clean immutable artifacts;
   update Core pins through the existing release mechanism.
2. Back up the stand configuration and PostgreSQL data, record current images
   and dev overrides. Update only this stand through managed operations.
3. Configure the local mailbox, managed Identity/Billing, model allowlist,
   tool-free execution and daily threshold. Verify no accidental production
   credentials or public mail recipients enter synthetic fixtures.
4. Run acceptance with two new synthetic accounts. Save sanitized evidence and
   machine-readable results in the operator state directory. Delete only the
   test fixtures created for this run when cleanup is needed.
5. Run release gates and a restore drill. Commission domain/TLS and real email,
   then verify real signup/recovery before opening registration publicly.
6. Observe the first public canary cohort before expanding traffic. On failure,
   close new admission, drain ongoing answers, retain Billing receipts/outbox
   and restore compatible application images. Never roll back to a Billing
   binary that silently ignores an already enabled daily policy.

## Launch metrics

Track successful signup and email delivery, first-answer success and latency,
stream interruption/retry rate, quota denials, unsettled accounting operations,
daily spend per stable user, 5xx rate, memory/disk use and backup age. Report
source readiness separately from stand acceptance and public commissioning.
No completion time is claimed until real model, accounting and isolation
acceptance has passed; a local unit gate is insufficient for that estimate.

## Dependency audit during candidate assembly

The initial `npm audit --omit=dev` reported 18 affected package entries
(1 critical, 14 high, 3 moderate), including transitive owner packages. These
counts are package advisories, not proof that every vulnerable path is exposed.
Core's compatible lock refresh covers MCP SDK, proxy-addr, fast-uri, ip-address,
brace-expansion, nanoid, source-map-js, Hono and qs. Image decoding is pinned to sharp
0.35.5 throughout the Core dependency graph; the complete gate must validate it.
Identity removes unused Nodemailer declarations; its actual mail implementation
is `users/mailer.ts`. The final production-dependency audit reports zero critical/high and two
moderate package entries (esbuild and its Make consumer). Re-audit after any
further pin changes before public promotion.

Maintainer references: [proxy-addr trust subnet fix](https://github.com/jshttp/proxy-addr/security/advisories/GHSA-jqcg-44mw-7w3h)
and [sharp native decoder updates](https://github.com/lovell/sharp/security/advisories/GHSA-f88m-g3jw-g9cj).

The remaining esbuild advisory concerns its development HTTP server. Public
Core runs the static published UI and uses esbuild only for bundling; it does
not start that development server. Development preview services are outside
the public chat composition. Preserve this boundary when commissioning.

The separate all-dependencies audit also flags test/development tools (Vitest,
Vite, Electron and their transitives). They are installed for Core validation
but are not started as services in the public candidate. Track their major-version
upgrades separately; do not describe this runtime-focused audit as a clean audit
of every installed development package.

## Real model availability probe

The candidate Runner image completed direct real CLI requests for Luna, Terra
and Sol in 5.258 s, 5.371 s and 4.904 s respectively. All returned the requested
synthetic word. The probe mounted the existing M2 Codex login read-only and used
ephemeral container profiles; it did not exercise Core or Billing admission.
The existing stand has shared-auth configuration but no source authorization
file. Stand credential provisioning remains part of acceptance. The user selected
a separate production service account; its login must be installed and all three
models rechecked before public commissioning.
