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
loopback web port 23025 and SMTP port 23125. Core and Identity are wired to it;
stand signup, one-use verification/reset and session revocation checks passed.
A read-only sandbox by itself does not establish user-data isolation.

## Work and acceptance order

| Work item | Required evidence | Status at audit |
| --- | --- | --- |
| Stand composition | Chat-only application manifest, voice off, Caddy and PostgreSQL healthy; prior data preserved | Candidate deployed; 9 existing users and blank stand passwords preserved; management metadata reconciliation pending |
| Registration and recovery | New ordinary account, one-use verification/reset links, closed signup rejects existing links, no account enumeration | Owner gate and two-user stand acceptance passed with Mailpit; live mail pending |
| Model selection | Exactly Luna/Terra/Sol visible and enforced at execution; a real answer from each | All three real Core/Runner/Billing responses and saved history passed; exact three-model browser catalog confirmed |
| Daily quota | Below-limit admission, final overage, next request blocked, midnight reset, no parallel/tenant/restart bypass | Owner gate and real stand overage/rejection/restart checks passed |
| Chat lifecycle | First answer, streaming, cancel, retry, reload and history; network interruption does not double-charge | Reconnect and subsequent turn passed; background Stop implementation and required gate passed, real stand acceptance pending |
| Public UI | Chat navigation only, visible spending/reset and clear quota errors, desktop/mobile acceptance | Desktop quota/reset/overage explanation and Russian rejection passed; voice onboarding and mobile model-menu fixes passed owner gates, combined release acceptance pending |
| User isolation | Two synthetic users cannot access each other's chats, files or sessions; CLI exposes no host tools | Owner sandbox probes and two-user stand API/file/symlink/session checks passed |
| Release operations | Clean immutable owner pins, full gates, restore drill, health/metrics and rollback evidence | Final owner/Core composition gates and 156-table restore drill passed; live acceptance, review and official release pending |
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
The existing M2 login was provisioned into the stand-only shared-auth profile
after backup. Production authorization is separate. The user selected
a separate production service account; its login must be installed and all three
models rechecked before public commissioning.

## Stand acceptance after cutover

Core candidate `3b7a10082838a31207c97572418f130d7789ea77`, Identity `bd5dcc9`,
Billing `cf8df21` and Runner `e3acfdd` are running on the existing dev-m2 stand.
All three actual Core-to-Runner-to-Billing requests returned the synthetic
acceptance text: Luna 3.890 s, Terra 4.320 s, Sol 5.315 s. History survived and a
second account could not read the conversations.

A separately journaled synthetic ledger seed brought the test account just below
$5; one real answer completed at $5.000451, and the next request was denied before
any model token. The other user's balance was unchanged. Stopping Billing closed
new admission; restart retained the policy, spend and exhausted-user denial.
Deleting a test conversation did not reset spending. API checks also denied
foreign files/sessions and workdir/symlink escapes while allowing an owned file.

The real 2026-10-19 to 2026-10-20 midnight transition was observed on the stand.
Both synthetic users received the new $5 daily allowance; prior-period settled
amounts remained intact in the ledger, and the unresolved old test operation
still held its user's slot. This checks the natural Europe/Minsk boundary
without changing system time or clearing accounting records.

The inherited stand configuration used a Runner master token. Receipt ownership
therefore failed Core's strict `core` check. Verified terminal receipts for two
synthetic operations were reconciled idempotently through Billing (zero only for
`not_started`, measured usage for the completed answer). A separate `service:core`
credential now authenticates Core; its subsequent receipts settle automatically.
Master administration remains separate. No ledger/outbox rows were deleted or
edited to release a hold.

The voice onboarding popup was still visible with both voice services absent.
The fix adds explicit configured-module information in the Core contract and an
owner UI visibility check; final browser acceptance awaits that pinned artifact.
Core commit `0e050cbcdc0ecffa1c2fc8263f50f10b6f10cd42` passed the required expanded
full gate (2187 server and 57 enabled browser checks, plus shared/tooling checks).
The published Shared 0.1.42 contract carries optional `configured` independently
of transient service availability. The UI owner implementation and its validation
run on the physical M1; final composition and stand acceptance run on M2.
Managed stand component descriptors still reflect failed base-reset checks, even
though the new candidate containers and gateway are healthy. This metadata needs
reconciliation before declaring the stand fully commissioned.

The cancellation check exposed a release blocker: stopping an active Codex CLI
before output left a terminal receipt without final usage. Core correctly keeps
the user's hold; no zero-cost settlement is justified. The approved first-release
behavior is to stop displaying the answer while the admitted calculation finishes
in the background for actual-cost accounting. New requests remain blocked until
settlement. Implementation passed 568 related server tests and the 129-test
changed-file rerun. The queue remains paused after Stop until explicit manual
continuation; a competing admission cannot discard queued text. Real stand
acceptance is pending; the previous uncertain test hold must remain intact. Reconnect checks already passed
with one saved answer, stable spending and a successful subsequent turn.

There is no supported metadata-only Docker adoption endpoint for the managed
stand. Its frozen base manifest is separate from directly observed candidate
image IDs and HTTP health. After official image publication, use environment
apply for a managed deployment; do not repeat destructive base resets or edit
the registry merely to change status indicators.

Manual Chrome acceptance confirmed the account's daily spend, remaining amount,
midnight Europe/Minsk reset and last-answer overage explanation. The model
catalog contains only the approved three models, and an exhausted request shows
the Russian quota error. At a 360-by-800 mobile viewport the quota error and
composer fit, but the model trigger is visually empty and menu labels wrap into
an excessively narrow column. The menu opens and exposes all three choices;
this is a layout defect, not evidence of a missing model. Mobile acceptance is
not complete until the corrected artifact is deployed and rechecked. The owner
fix adds a visible mobile model icon, readable model columns and a composer-bound
popup. Its regression failed on the old UI and passed on the fix at mobile, wide
desktop and narrow desktop viewports. The complete mobile owner gate passed
3511 UI tests and 45 browser tests. The independent M1 voice owner gate passed
3528 UI tests and 42 browser tests. The intermediate combined `npm run pack:release`
passed 3531 UI tests, 45 browser tests and 8 system tests against immutable Core
`dfbff91864a835461a39dd87743f136f72306eb3`. The candidate UI source is
`979d9c54bb986671a2ae60c660d75a401f4b92fe`; its published archive SHA-256 is
`aeafd21e60a5e7488d818372c073a714fb50c9bee5061765721c3f2ec2004206`, verified
after downloading from the vendor release. The first-account fixes below
supersede this intermediate artifact.


## Fresh-account model selection follow-up

A new account can store legacy `claude/default` settings while deployment
admission falls back to Codex Luna. Source review found that the UI displayed
that raw setting and did not persist a model selected before the first
conversation. Core now projects the effective account provider/model without
rewriting stored preferences; the companion passed its required quick gate
(437 related tests and the final 11-case HTTP/execution rerun).

The model-access contract is a deny-list and does not carry the ordered
deployment fallback. The UI therefore uses Core settings for an account and
the authoritative context snapshot for a denied conversation override. Explicit
draft selection saves only model fields before the first send. Failed/deferred
saves preserve the draft, and navigation/unmount guards prevent a stale send.
The new scenarios failed on the old UI; 111 related tests and independent review
passed on the fix. The final canonical `npm run pack:release` passed 3540 UI
tests, 45 browser tests and 8 system tests against immutable Core
`d3076e73a5f73b234cb64693af7ead0491b3ef27`. Its clean UI source is
`dca609d41698c42e577a4c9bef75c9116ddeeaf3`; archive SHA-256 is
`c57640a2684691cf76ed67a8da7432cd1a2bee37b543e6935988bfae00990e57`.
The required combined Core gate (`gate:quick -- --base 0e050cbcdc0ecffa1c2fc8263f50f10b6f10cd42`,
expanded to `gate:all`) exited 0: 2210 server tests, 1287 shared tests, the other
workspace/tooling checks, and 58 enabled browser checks passed. Existing opt-in
skips remain unchanged. The downloaded vendor archive hash and actual Shared
0.1.42 compatibility metadata were verified before the gate. Final stand
acceptance remains pending; source validation alone does not establish the
deployed behavior.


## Observed UI polish before public commissioning

The stand still exposes legacy ChatAI / voice-chat branding, account plan rows
for modules outside the enabled chat composition, and an unconfigured analytics
section that polls a 503 endpoint. These are observed presentation/integration
follow-ups, not evidence that those product apps are enabled. Record their
resolution or an explicit launch disposition before calling the public UI fully
polished; do not conflate successful chat acceptance with completion of every
account screen.
