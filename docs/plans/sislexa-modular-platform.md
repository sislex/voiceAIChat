# Sislexa: independent applications, identity, and usage accounting

Status: the first contract foundation is deployed in production 0.1.310.
The three tool repositories were extracted in core release 0.1.311. Managed
dependency and component-permission configuration is deployed in 0.1.312.
Make 1.1.1 corrects a process-bootstrap guard; the host update for 0.1.313 is
being validated before its final production rollout.
Updated: 2026-09-20.

## Confirmed product requirements

- Product name: Sislexa. The owner confirmed a domain purchase; its TLD is unspecified.
- Applications should live in separate repositories with independent releases.
- Each application must run standalone, including locally, using configured URLs
  for its dependencies. Product UI must also be usable within the platform shell.
- Releases declare supported dependency contracts; deployments select exact artifacts.
- API providers manage which consuming components may access their capabilities.
- Chat, Make, and other applications share a user account and available usage budget.
  All user-initiated work must remain attributable to that account across services.
- Users need module-level token consumption and time-spent totals, percentages,
  and comparisons over a selected period.

## Proposed application boundaries

Shell composes applications; Identity owns accounts and sessions; Chat owns
conversations; AI Runtime executes model/agent work. Make, Web Reader, Playwright
Reader, Image Studio, Projects, and Machines own their respective product domains.
Files owns stored artifacts. Usage/Billing owns budgets, reservations, pricing,
and the accounting ledger. UI Kit/Foundation are versioned libraries with a
component development environment, not mandatory runtime services.

An application repository contains its UI, API, contracts, migrations, and tests.
UI and backend may produce separately versioned artifacts. Consumers use published
contracts rather than importing another repository's internal source. Each domain
owns its data; cross-domain access goes through APIs.

Release manifests describe provided/required API versions and capabilities.
Deployment settings describe URLs, expected issuers/audiences, and credential
references. A platform deployment repository pins tested artifact versions and
digests. Compatibility is checked in CI, before rollout, and during connection.
Standalone operation may use remote dependencies; it does not imply offline use.

### Target repositories

| Repository | Owned responsibility |
| --- | --- |
| `sislexa-shell` | Web/desktop composition, navigation, and module loading |
| `sislexa-identity` | Accounts, login, sessions, registered clients, and token exchange |
| `sislexa-chat` | Conversation storage, message UI, and chat API |
| `sislexa-ai-runtime` | Model/agent execution, tool dispatch, and cancellation |
| [`sislex/make`](https://github.com/sislex/make) | Workspace editing, preview, and publication |
| [`sislex/webreader`](https://github.com/sislex/webreader) | Web Reader UI and API |
| [`sislex/playwrightreader`](https://github.com/sislex/playwrightreader) | Playwright Reader UI and API |
| `sislexa-image-studio` | Image generation, editing, and galleries |
| `sislexa-projects` | Projects, membership, boards, and tasks |
| `sislexa-machines` | Machine registration, execution, terminals, and permissions |
| `sislexa-files` | Artifact storage and access |
| `sislexa-voice` | Recording integration, speech recognition, and synthesis |
| `sislexa-usage` | Authoritative consumption ledger, budgets, and settlement |
| `sislexa-analytics` | Activity ingestion, report projections, and analytics API |
| `sislexa-ui` | UI Kit and UI Foundation packages plus component previews |
| `sislexa-platform` | Pinned installation manifests and deployment tooling |

The owner supplied the three tool repositories; they were verified accessible
and initially empty on 2026-09-20; their first independent 1.0.0 releases are now published. Other repository names remain a proposed extraction map,
not a list of created remote repositories.
Each provider publishes its own versioned contract/client artifacts. Common
operation metadata initially lives in shared; its standalone publishing ownership
must be chosen before extraction without duplicating the contract in each repository.

### Standalone installation contract

Each application supplies a documented install/build/test/start path and a sample
configuration containing its public URL, dependency endpoints, expected identities,
and secret references. For example (illustrative schema, not a working config):

```yaml
application:
  publicUrl: http://localhost:8790
  environmentId: development
dependencies:
  identity:
    url: https://identity.dev.example
    issuer: https://identity.dev.example
    clientId: make-local
    clientSecretEnv: SISLEXA_IDENTITY_CLIENT_SECRET
  aiRuntime:
    url: https://runtime.dev.example
    audience: ai-runtime
  usage:
    url: https://usage.dev.example
    audience: usage
```

Dependency version requirements are part of the release manifest, not editable
claims in this installation config. Startup checks dependency API/capability
compatibility and connection grants. Readiness identifies unavailable mandatory
dependencies; optional capabilities can be disabled independently. Browser UI
never receives configured server secrets. Local development registers its own
client/callback URLs and should select a development budget explicitly.

## Identity and delegated access

Use a central Identity authorization server and OpenID Connect login. Each
application is a registered client with its own callback URLs and local session.
An existing Identity login enables sign-in to another application through a
redirect without requiring shared cookies between application domains.

Accounts have immutable internal user IDs; nicknames are mutable display/login
attributes. Map the validated issuer and subject to this ID. Configure first-party
clients consistently or maintain explicit mappings if subject IDs differ by client.
Never join accounts merely because they present the same nickname or email.

Each API provider controls client grants, scopes, and resource restrictions.
Identity provides the common token issuance/exchange mechanism. A component's
credential authenticates that component; it cannot independently assert an
arbitrary user ID. Issue separate credentials per application instance/environment.
Long-lived credentials stay on the backend and support rotation and revocation.

For delegated calls, exchange verified user authority plus authenticated component
identity for a short-lived, audience-specific access token. Preserve the user as
subject and the calling component as actor. Each hop may narrow authority and
must satisfy both component grants and user/resource permissions. A service-only
credential is insufficient to charge a user's balance or access their resources.

Each protected endpoint validates issuer, signature, algorithm, audience, expiry,
scopes, and resource authorization. Gateways may add checks but cannot replace
checks on independently reachable services. Never trust client-supplied user IDs,
billing IDs, or tracing headers as authorization evidence. Use an access token,
not an OIDC ID token, to authorize an API request.

Logout/revocation policy must specify the maximum validity of already issued
tokens. Token exchange alone does not revoke downstream tokens. Sensitive
operations and new paid runs recheck account/grant status; use bounded token
lifetimes and online revocation checks where immediate enforcement is required.

## Request context

Build a verified server-side context at each trust boundary:

| Field | Meaning |
| --- | --- |
| userId | Immutable account initiating the work |
| actorClientId | Authenticated calling application instance |
| sessionId / grantId | Interactive session or authorized background delegation |
| projectId | Optional resource scope, checked against permissions |
| billingAccountId | Server-resolved payer; personal account initially |
| operationId | Durable logical task across retries and services |
| requestId / traceId | Individual request and distributed diagnostic correlation |
| reservationId | Budget allocation for metered work, if applicable |

Tracing identifiers are diagnostic metadata, not credentials. Store resource
ownership using immutable identity. Permission checks bind each requested resource
to that identity or to explicitly authorized project membership.

User-created background jobs retain the initiating user, payer, operation ID, and
a bounded delegation grant. Workers obtain fresh short-lived access tokens and
recheck permissions instead of persisting the browser's bearer token. WebSocket
subscriptions and inbound actions enforce the same resource scope and session
expiry rules. Reconnection does not create a new billable operation.

Health checks, login attempts before authentication, maintenance, and provider
callbacks have explicit system, service, or anonymous principals. They must not
be assigned a fabricated user. Callbacks resolve an existing operation and payer
from trusted server records after validating the sender.

## Shared balance and paid operation lifecycle

Usage/Billing is the authoritative budget owner. Applications may display cached
balances, but must not authorize new spending from a cache or a balance claim in
a JWT. Keep authentication tokens distinct from model usage tokens and credits.
Preserve raw model/provider usage and a versioned pricing rule; heterogeneous model,
image, audio, and compute usage should not silently be treated as identical tokens.
The customer-facing denomination remains a product decision.

For each metered operation:

1. Verify user, component, resource permissions, account status, and operation limits.
2. Atomically reserve an enforceable maximum budget from the payer's available balance.
3. Bind the reservation to the payer, user, operation, executing service, and limits.
4. Execute within those limits; only trusted execution services may report usage.
5. Atomically settle actual usage and release the unused reserved portion.

Available balance is ledger balance minus active reservations. Parallel requests
from Chat and Make contend on the same transactional budget, not on independent
balance copies. An agent run may allocate child budgets to tool calls; child
allocations must stay within the parent budget without reserving or charging it twice.

Before extending a run beyond its allocation, reserve more budget. If this fails,
stop before the next paid step. A provider call must have an enforceable upper cost
bound, including input/output and other priced units. Post-hoc metering alone cannot
guarantee prepaid limits. Charge actual billable usage already incurred on cancellation.

Use durable operation/idempotency IDs, request fingerprints, unique ledger event
keys, and transactional state transitions. A replay with the same key and payload
returns the existing operation; reuse with a different payload is rejected.
Scope idempotency to the authenticated payer and operation type. Provider retries
need provider idempotency support or explicit reconciliation; a timeout does not
prove that execution never started.

Model reservations with explicit reserved/running/settled/released/uncertain states.
Unstarted expired reservations may be released; running or uncertain operations
need execution fencing/cancellation confirmation or provider reconciliation before
funds become spendable again. Record usage durably with an outbox and deduplicate
delivery, so a transient Billing outage cannot lose or double-count usage.
Billing unavailability blocks new paid work. Existing bounded work may finish and
queue settlement while its reservation remains held. Non-metered authorized reads
should remain possible without a positive spending balance.

## Audit and support

Record user, caller, operation, service, action, resource, authorization result,
reservation, usage, and ledger event IDs. Keep the accounting ledger authoritative;
sampled traces are not billing records. Do not log bearer tokens, client secrets,
or conversation content by default. User history shows consumption by Chat, Make,
and other applications against one shared account balance.

## Personal usage analytics

Expose a personal Usage dashboard in the account module. An Analytics service
owns activity ingestion and reporting projections; Usage/Billing remains the
authoritative source of consumption and charges. Losing analytics availability
must not interrupt accounting or authorize spending. Reports show their freshness
and distinguish pending usage from finalized measurements.

Every metered operation records a server-assigned `originModuleId`, executing
module, application instance/environment, initiating user, payer, project, model,
operation/parent operation IDs, usage time, and pricing version. The origin is
established by the authorized entry application and preserved across child calls.
Make invoking Chat/AI Runtime is attributed to Make in the primary product report;
the executing service remains a separate drill-down dimension. Do not count one
usage event in both module totals or sum a parent aggregate with its children.

Show two separate consumption views: raw model tokens and billed credits/cost.
Keep input, output, cache-read, cache-write, and other provider measurements with
explicit normalization rules; avoid counting cache tokens twice when a provider's
input count already includes them. Explain that token counts across models do
not imply equal cost. Images, audio, and compute have their own units and contribute
to the credits/cost view rather than becoming invented text tokens. Refunds and
adjustments are separate from raw consumption; usage shares use nonnegative gross
consumption, while net financial totals are separately labelled.

For a selected user, environment, period, and metric:
`moduleShare = moduleTotal / allModulesTotal * 100`.
Use the same filters for numerator and denominator, include an Unknown category
for unattributed legacy events, and show No usage when the denominator is zero.
Only rank comparable finalized measurements; identify unreported/pending usage
instead of treating it as zero. Use deterministic rounding for chart labels.

Activity SDKs in standalone applications and the shell send authenticated,
deduplicated time intervals with session/device/instance IDs and sequence numbers.
Identity is resolved on the server, not accepted from a telemetry payload. Record
focus, visibility, module activation, user interaction, and heartbeat state without
capturing keystroke contents, document content, or message text.

Proposed initial active-time rule: the document is visible and focused, the module
owns the user's current interaction surface, and the last interaction was within
60 seconds. Emit bounded intervals approximately every 30 seconds and flush on
blur, hide, navigation, and logout. These thresholds are design defaults, not
implemented behavior. Passive reading beyond the idle threshold is not counted;
label the result as estimated active time. Show foreground dwell/waiting time and
background AI execution duration separately, rather than adding them to active time.

In a split layout, the last explicitly interacted product surface owns attention;
merely moving the pointer over another panel does not switch ownership. Standalone
windows use the same activity contract. Resolve overlapping intervals across tabs
and devices using a deterministic account-level attention lease: the most recent
accepted explicit interaction wins until expiry or a later interaction. Clamp
intervals to lease validity, idle limits, and plausible server receipt windows.
An offline replay cannot overwrite already accepted attention ownership; report
unresolved coverage as missing rather than inventing activity. The user may work
on several devices, but primary total active time is a deduplicated wall-clock
estimate, with each interval attributed to one module.

Split intervals at report boundaries using a selected account time zone. Activity
reports cannot prove actual human attention and must never be used as authority
for model-token billing. Viewing one's own analytics requires authentication;
viewing another user's report needs an explicit administrative permission.
Define raw-event retention and aggregate retention before rollout, with bounded
client buffering and a visible data-gap indicator for disconnected periods.

The dashboard shows consumption and active-time shares, absolute totals, daily
trends, and drill-down by project, model, and operation. Filters include the time
zone, period, and environment so local development does not silently mix with
production. Additional acceptance tests cover nested tool attribution, duplicate
usage events, concurrent tabs/devices, split panels, idle/background tabs, crashes,
offline replay, time-zone boundaries, zero totals, missing data, and access isolation.

## Current implementation and migration

### First implementation slice

`packages/shared/src/platformOperation.ts` introduces version 1 operation metadata
with immutable user ID, identity issuer, caller, payer, environment, product origin,
project, and operation ancestry. Structural parsing returns a frozen defensive
copy; child operations preserve origin and ownership across service hops. These
helpers do not authenticate callers, validate JWTs, or migrate existing accounts.

`packages/shared/src/platformUsage.ts` introduces finalized leaf-consumption events
and a pure module report. It isolates user/issuer/environment, applies half-open
period and optional project/payer filters, deduplicates identical event deliveries,
rejects conflicting replays and invalid/overflowing counters, and returns normalized
token counts plus per-module percentage shares. Provider adapters must supply
disjoint token categories; zero consumption produces no percentage. This function
is not a persistent ledger and does not authorize or reserve spending.

These contracts are staged in the existing shared source of truth so the current
repository has a tested migration boundary before repositories are extracted.
They are exported publicly but are not yet wired into production routes, runners,
or account screens. Active-time ingestion and summaries remain unimplemented.

The first full consumer gate exposed an existing Administration boundary violation:
`PerformanceDashboard` subscribed directly to browser globals. The connectivity
subscription now lives behind UI Kit's public `useOnlineStatus` / `OnlineStatusSource`
API, with a default browser implementation and an injectable host source. Dedicated
tests cover offline/online changes, unknown state, source replacement, and cleanup.
The original boundary test remains unchanged.

### Delivery sequence and completion criteria

The owner requested this execution order on 2026-09-20: finish the current slice,
publish/deploy a new production release through Release Center (or complete its
support first), and verify the live system; then extract Make, Playwright Reader,
and Web Reader to the supplied repositories, publish/deploy another release, and
verify it; afterward implement configurable dependency endpoints and component
token-grant settings. Release work includes the necessary commits and repository
publication. Use the existing release checks and deployment path rather than
bypassing them. Preserve the already externalized LLM runner deployment.

The owner explicitly selected the standard server-side `voicechat-deploy` fallback
when authenticated Release Center access was unavailable. The first production
checkpoint uses a versioned release branch and the tested commit, preserves the
existing Compose override chain, and verifies the deployed version and commit.
This manual deployment must not be represented as a successful Release Center run
unless the center actually created and completed that run.

| Stage | Deliverable | Completion criterion |
| --- | --- | --- |
| 0 | Architecture and migration plan | Requirements, data ownership, trust boundaries, metrics, and recovery rules documented. |
| 1 | Shared operation and usage contracts | Unit tests cover attribution, isolation, replays, filters, and numeric boundaries; repository gate passes. |
| 2 | Immutable user identity migration | Existing users/resources retain ownership; renaming an account cannot split usage history. |
| 3 | Authenticated context propagation | HTTP, WS, runners, tool calls, and queued jobs retain verified user/origin context; spoofed IDs are rejected. |
| 4 | Durable usage ledger | Finalized measurements persist exactly once despite delivery retries; existing usage maps to an explicit legacy category where necessary. |
| 5 | Budget reservation service | Concurrent Chat/Make requests cannot exceed allocated budgets; cancellation and uncertain execution reconcile safely. |
| 6 | Activity ingestion and analytics API | Authenticated time intervals obey focus/idle/overlap rules, reporting filters, and access isolation. |
| 7 | Account analytics UI | User can inspect absolute totals, percentage shares, and daily trends with empty, partial, and error states. |
| 8 | Standalone Identity and token exchange | Independent Chat/Make login and delegated service calls work with restricted audiences, scopes, expiry, and revocation. |
| 9 | Repository extraction and releases | Each application installs/builds/tests/starts without neighboring source trees; dependency versions and configured URLs are checked. |
| 10 | Platform integration and rollout | A pinned installation passes end-to-end identity, accounting, upgrade, and rollback scenarios. |

Stage 9 is performed per application after its contracts stabilize; it need not
wait for all product features. The production cutover needs explicit migration
and rollback validation. Existing identifiers and endpoints remain supported until
their consumers have migrated.

Implementation checklist:

- [x] Record the architecture and delivery sequence.
- [x] Add operation metadata and child-attribution helpers in shared.
- [x] Add finalized usage events and module percentage aggregation in shared.
- [x] Add contract tests for isolation, retries, attribution, and invalid inputs.
- [x] Complete the full selected repository gate for this slice (`gate:fast`, exit 0).
- [x] Deploy the foundation as production 0.1.310 through the authorized server deploy flow.
- [x] Publish independent Make, Playwright Reader and Web Reader repositories at 1.0.0.
- [x] Complete host integration and deploy production 0.1.311 through `voicechat-deploy`.
- [x] Complete runtime dependency/token configuration and its integration gate.
- [ ] Deploy and verify production 0.1.313 with managed component credentials and the Make startup fix.
- [ ] Execute the remaining identity, accounting and analytics stages with integration and release evidence.

### Inspected baseline

At the inspected baseline `7ed88f46`, `apps/server/src/users/auth.ts` returns
`req.user.name` from `uid()`. `apps/server/src/turns.ts` compares monthly usage
with `account.llmLimitUsd` before execution. Existing session, permissions, and
limit behavior is documented in `docs/kb/data-auth.md`. This proposal adds immutable
identity and distributed accounting; these mechanisms are not present merely
because a module has a separate package or deployment.

- [ ] Introduce immutable IDs and migrate ownership references while retaining login aliases.
- [ ] Define Identity, delegation, resource-permission, and request-context contracts.
- [ ] Define Usage/Billing units, reservations, settlement, and recovery contracts.
- [ ] Integrate one complete Chat -> AI Runtime -> Billing flow.
- [ ] Integrate Make with the same user and payer, including concurrent operation tests.
- [ ] Require these contracts in each extracted standalone application.

Acceptance scenarios include cross-application sign-in, rename without ownership
loss, forged-user rejection, audience/scope rejection, simultaneous budget
reservations, duplicate deliveries, cancellation with partial usage, lost provider
responses, Billing downtime, session revocation, and authorized background jobs.

## Standards informing the proposal

- [OpenID Connect Core](https://openid.net/specs/openid-connect-core-1_0.html): login and subject identity.
- [RFC 8693](https://www.rfc-editor.org/rfc/rfc8693.html): token exchange and subject/actor delegation.
- [RFC 9068](https://www.rfc-editor.org/rfc/rfc9068.html): JWT access-token claims and validation.

The budget lifecycle and service boundaries above are Sislexa design proposals,
not guarantees supplied by these authentication standards.
