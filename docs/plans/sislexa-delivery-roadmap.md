# Sislexa delivery roadmap

Updated: 2026-09-21.
Status: implementation in progress; no new end-to-end milestone is production-complete.

## Baseline and repository ownership

Core 0.1.316 / Identity 1.1.1 already provides personal tenants, system roles
separate from product capabilities, configurable tariffs and live access checks.
This is the baseline, not completion of the accounting and team milestones below.
The detailed accounting design remains in `sislexa-modular-platform.md`.

The owner supplied four repositories, all accessible and empty when checked:

| Repository | Responsibility |
| --- | --- |
| `https://github.com/sislex/billing` | Authoritative usage ledger, budgets, reservations, settlement and later prices/payments |
| `https://github.com/sislex/analytics` | Reporting projections, active-time ingestion and account analytics UI |
| `https://github.com/sislex/sdk` | Versioned common contracts, dependency integration and verified operation context helpers |
| `https://github.com/sislex/sielexa-ui` | Shared UI Kit/Foundation libraries and component examples |

`sielexa-ui` is the exact supplied repository name; do not silently rename it.
Identity retains identity, tenant membership, system roles and entitlement policy.
Billing owns commercial pricing and financial state. Analytics is never authority
for spending. SDK helpers validate shapes but cannot authenticate arbitrary
client-supplied principals. During extraction, shared remains the canonical
contract source until an explicit versioned ownership cutover; do not maintain
independent copies of the same evolving public contract.

## Fifteen deliverables

The numbers preserve the three previously discussed groups of five. Dependencies
can change implementation order; an unchecked item is not production-complete.

| # | Deliverable | Completion evidence |
| --- | --- | --- |
| 1 | Monthly budgets, request and concurrency limits | Persisted versioned policy, period rollover and concurrent admission tests; existing accounts preserve access during migration |
| 2 | Verified user/tenant/module operation context | HTTP, WS, tool and background paths retain trusted attribution; spoofing and cross-tenant tests pass; stable user identity survives login-name changes |
| 3 | Reservation and settlement | Transactional concurrent reservations, durable idempotency, bounded work, partial cancellation and uncertain execution reconciliation; no duplicate debit or premature release |
| 4 | Personal usage dashboard | Balance, history, module shares, raw units versus cost, consistent filters, zero/pending/error states and access isolation |
| 5 | Active-time reporting | Focus/visibility/idle rules, bounded intervals, overlap deduplication across devices, retention and offline gaps; activity cannot authorize charges |
| 6 | Team tenants | Invitations, membership roles, shared budgets and explicit resource ownership migration; cross-tenant isolation and revocation |
| 7 | Prices, subscriptions and payments | Versioned offers, subscription transitions, provider sandbox flow, verified webhooks, idempotent credits and reconciliation; live activation requires actual provider configuration |
| 8 | Remaining application extraction | Independent source ownership, clean installs, local startup, pinned dependencies and release checks; Core retains only adapters and shell responsibilities |
| 9 | Component Release Center | Compatibility preflight, exact artifact selection, deployment evidence and tested rollback per component |
| 10 | Operations | Cross-service trace correlation, metrics and alerts, automatic backups with restore drills; sensitive content excluded from telemetry |
| 11 | Chat-to-tool product flows | First acceptance flow: describe a site in Chat, build it in Make and inspect the result with shared operation status and correct charging |
| 12 | Automation | Saved workflows, schedules, signed webhooks, bounded background delegation, retries/cancellation and live permission/budget checks |
| 13 | Shared knowledge | Document ingestion, indexing and retrieval with file/project/tenant authorization, deletion propagation and isolated search |
| 14 | Third-party tool SDK | Documented extension contracts, declared permissions, compatibility checks, install flow and an independently built sample tool |
| 15 | Public-launch readiness | Onboarding and demos, feedback flow, measured capacity targets, load/failure tests and recovery evidence; launch exposure follows the agreed product configuration |

Progress: 0/15 new deliverables complete. Existing foundation code is reused but
does not satisfy the end-to-end acceptance criteria on its own.

## Delivery sequence

1. Establish Billing/SDK boundaries and migrate stable identity/context first.
   Deliver a tested Chat accounting path with limits and reservation/settlement,
   then Make and the other tools, covering milestones 1-3 together.
2. Deliver Analytics account views and active time (4-5).
3. Add team ownership (6), then commercial subscriptions/payment integration (7).
4. Continue extraction throughout; complete independent releases and operational
   controls (8-10) before widening the product surface.
5. Deliver the concrete Chat-to-Make flow, automation, knowledge, extension SDK
   and public-launch readiness (11-15).

Each releasable increment needs affected typechecks/tests/builds, the canonical
Core gate when integrated, immutable component pins, migration/rollback review,
backup, deployment via the existing release flow and production smoke checks.
Do not wait until all fifteen deliverables to validate migrations or deployment.

## External prerequisites

The four supplied repositories are sufficient to start. Later extraction needs
the proposed `chat`, `projects`, `machines`, `files`, `automation`, `knowledge`
and `platform` repositories or an explicit alternative ownership decision.
Do not claim these repositories exist until verified.

Implement provider-independent payment contracts and sandbox tests before live
integration. Provider, merchant account, currency, prices, renewal/refund rules
and production credentials are product/operator inputs; do not invent them or
activate real customer charges merely to complete a checklist. Missing future
inputs do not block accounting, analytics, team development or isolated tests.

There is no fixed total-time commitment: estimates should follow completion of
the first vertical accounting slice and validation against real execution paths.

## Foundation increment

SDK 1.0.0, Identity 1.2.0 and Billing 1.0.0 are published independently. They provide
portable operation contracts, stable user IDs and a transactionally tested ledger.
Core 0.1.317 deployed this integration on 2026-09-21 with managed dependency
configuration and authenticated account proxies. Production acceptance passed
session continuity, tenant isolation, reservation/settlement replay and browser
checks; see `docs/kb/deploy.md` for evidence. This does not complete milestones 1-3: model execution bounds, durable
usage delivery, reconciliation and production acceptance remain required.

Image Studio 1.0.5 adds an independently owned standalone browser entry and
bounded API shutdown. Core pins its immutable archive for the same foundation
increment. Its production frontend remains the host-loaded panel; the standalone
local UI uses explicit Core and Image Studio origins.


## Chat accounting increment

Core 0.1.318 deployed SDK 1.1.0/Billing 1.1.1 with Runner 0.2.1 on 2026-09-21.
Production acceptance covered two real Chat turns, resumed-session usage deltas,
exactly-once settlement, stable attribution and pre-execution finite-policy
rejection. Existing CLI execution remains unbounded; finite monetary policies
therefore refuse it. This advances milestones 1-3 but does not complete their
cross-tool/background or bounded-execution acceptance. Dashboard and active-time
work remain pending. See `chat-execution-accounting.md` and `docs/kb/deploy.md`.
