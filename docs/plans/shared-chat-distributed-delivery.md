# Shared chat, skins, application access, and distributed delivery

Plan ID: `shared-chat-v1`

Created: 2026-09-24

Baseline: Core `origin/main` at `cbd8592d`

Document status: implementation specification; orchestration is not installed by this commit.

Amendment 2026-09-25: O01 adds a required worker operations web UI, independently
of B06. The currently imported `shared-chat-v1` run is pinned to the earlier
37-task revision. This document amendment does not mutate that run or its active
attempt. Import O01 through a reviewed plan revision/migration, preserving task
IDs, completed evidence and active assignments, before dispatching the new task.

## Start here: instructions for every machine

The owner wants 1–10 machines, with multiple concurrent agents on each machine,
to implement this plan, share progress, wait for eligible work, release each
stage, test production, fix defects, and only then advance. Every agent is an
independent worker with its own task checkout. Reading this file does not itself
start a persistent worker.

1. Read this document and the target repository's `AGENTS.md`. Preserve existing
   work; create an isolated task checkout from the assigned base SHA.
2. Before the control service exists, only the explicitly designated bootstrap
   worker on the designated machine may implement Stage 0. Other workers must
   report `bootstrap_required`;
   they must not guess task ownership from this file or start competing coordinators.
3. After bootstrap, use the installed delivery worker and its configured control
   endpoint. Register the machine and a distinct worker for each concurrent agent,
   obtain the live run and pinned plan revision, and join the durable queue per
   worker. No endpoint or credential is embedded in this file.
4. Accept work only through an atomic server assignment. Check the active stage,
   dependencies, repository/base SHA, scope, lease, and acceptance criteria.
5. Execute the task, publish progress and evidence, and submit the result. A
   successful Codex response does not itself mark a task complete.
6. If no task is eligible, remain registered in `waiting`. The worker subscribes
   to events, renews its presence, and reconciles periodically. It does not keep
   asking a model whether there is work.
7. Never start the next stage, merge a PR, publish a release, or deploy from local
   assumptions. Use the corresponding authorized control-service operation.
8. On lost connectivity or an expired lease, stop initiating effects and wait for
   reconciliation. Never use an offline Markdown checklist as a substitute lock.

Suggested operator instruction after Stage 0:

> Execute plan `shared-chat-v1` from
> `sislex/voiceAIChat/docs/plans/shared-chat-distributed-delivery.md` using the
> installed delivery worker. Join the configured run, claim only assigned work,
> publish evidence, and remain in the waiting queue between tasks.

The concrete installation and start commands are Stage 0 deliverables, not
commands that already exist. Initial runnable stage is `S0 / bootstrap_required`;
no task in this document is claimed, running, or completed by its publication.
After bootstrap, the control database is the only authority for live status.

## 1. Product outcome and ownership

Ship one reusable chat implementation with identical behavior and settings, a
`widget` skin for Make/Web Reader/Console, and a `kanban` skin. Publish the chat
and skins so an external application can import them, connect to its owner's
Sislexa account through delegated access, and appear separately in usage reports.

Skin selection controls presentation, not authorization, accounting, tool
availability, or settings semantics. Host adapters supply task/page/project
context. Multiple chat instances must coexist without shared mutable singletons.

| Repository | Ownership in this plan |
| --- | --- |
| `sislex/voiceAIChat` | Core transport contracts, conversations, resource access, execution attribution, integration and release composition |
| `sislex/sislexa-core-ui` | Reusable chat runtime/UI packages, both skins, shared settings, Console/Kanban host integration and Core settings navigation |
| `sislex/sielexa-ui` | Generic primitives and design tokens only; preserve this repository spelling |
| `sislex/sdk` | Public connection client and portable application/operation/usage contracts |
| `sislex/identity` | Registered user applications, delegated grants, token lifecycle, account-owned management UI |
| `sislex/billing` | Authoritative application-attributed reservation/settlement ledger and financial report contracts |
| `sislex/analytics` | Reporting projections, application filters and optional activity summaries |
| `sislex/make`, `sislex/webreader`, `sislex/playwrightreader` | Owned host adapters and adoption of released chat packages |
| `sislex/llm-runner` | Preservation of verified operation attribution in execution receipts |
| `sislex/desktop` | Compatibility of the released renderer and SDK with the Desktop host |
| `sislex/delivery-control` (proposed new private repository) | Coordinator API, database migrations, worker supervisor, CLI/dashboard, task compiler and release/QA adapters |

Creating `delivery-control` is a bootstrap deliverable, not an existing resource.
The product remains in its owning repositories. Do not move chat implementation
back into Core or put orchestration state into product databases.

Current baseline has independently owned UI and service artifacts, a partial
chat-package boundary, and durable model accounting. Core chat accounting expects
`actorClientId = core`; existing reports primarily group by module and day.
Existing component service grants do not replace end-user application delegation.
Verify owner implementations during S1 before changing public contracts.

## 2. Shared control system

Use **a Git repository for orchestration code and a PostgreSQL database for live
coordination**. Store large sanitized evidence in a private artifact store.
For 1–10 machines a single control API and PostgreSQL are sufficient; Redis and
a separate message broker are not initial requirements.

| Information | Canonical location |
| --- | --- |
| Product intent and stage/task specification | This document in Core, pinned by full commit SHA and content hash |
| Executable task manifest and protocol schemas | `delivery-control`, recording the exact source plan revision |
| Active stage, assignments, leases, queue, defects, release attempts | Control PostgreSQL database |
| Immutable progress/audit events and evidence metadata | Control database, linked to artifact hashes |
| Command logs, screenshots, reports, release manifests | Shared private artifact storage with retention policy |
| Code changes and review evidence | Owner repository branches/PRs and immutable commit SHAs |

A run pins both the plan revision and compiled task-manifest hash. A mismatch
blocks activation. Plan changes require a reviewed revision and an explicit
migration of pending tasks; never silently reinterpret running tasks. Generated
status views, GitHub issues, and exported Markdown are projections, not locks.

Host the coordinator independently of the product release being tested, so a
Core/Identity outage or rollback cannot destroy the queue. Workers authenticate
with revocable machine credentials. Only the API accesses the database. Include
backups, a tested restore procedure, health monitoring and an operator pause.

### 2.1 Minimum records and interfaces

Implement records for `runs`, `stages`, `tasks`, `task_attempts`, `machines`,
`workers`, `workspaces`, `resource_allocations`, `waiters`, `leases`, `events`,
`artifacts`, `defects`, `release_sets`,
`deployments`, `qa_batches`, and `operation_intents`. Use server timestamps.

Every task contains:

- Stable ID, plan revision, stage, kind, owner repository, allowed paths and
  published contract dependencies.
- Preconditions and dependency task IDs; priority; required machine capabilities;
  repository/resource concurrency key; acceptance and required gate profile.
- Assigned base SHA, branch/PR/head SHA, attempt number, machine/worker/session
  IDs, workspace paths, lease epoch, expiry and heartbeat; result and evidence
  references.
- Limits for runtime, no-progress interval, retries and execution spend, plus a
  typed blocking reason. A blocked task is visible and never treated as done.

Minimum API operations: register/update machine and worker, reserve/release local
resources, join/leave waiting queue, read
run/status, atomically dispatch/claim next assignment, renew lease, append event,
submit result, report defect, subscribe after event cursor, and read artifacts.
Coordinator-only operations compile QA batches, validate/accept results, merge,
prepare/reconcile release sets, deploy, and advance stages. Every mutating request
has an idempotency key; stale epochs and illegal transitions are rejected.

Expose a human-readable dashboard/CLI showing stage, ready/running/blocked/done
tasks, worker queue positions grouped by machine, machine capacity, workspace
paths, lease age, latest progress, PRs, logs, deployment
versions, QA coverage, and unresolved defects. Every authorized worker can read
this shared view across repositories.

### 2.1.1 Worker operations web UI (O01)

Provide a browser UI owned by `sislex/delivery-control`, using the coordinator's
shared status/events and authenticated read-only monitoring APIs. A CLI alone
does not satisfy O01. The first version is for observation; pause, cancellation,
retry and deployment controls remain outside this task.

- Overview: current run/stage, paused state, task totals, active/available worker
  counts, queue length, blockers and last successful refresh.
- Group workers by machine, including multiple slots on the same host. Show
  machine/worker IDs, connectivity, current task/repository/attempt, execution
  phase, elapsed time, latest sanitized progress, heartbeat age, queue position
  and a link to shared task evidence/logs. Make task details easy to open.
- Distinguish running, preparing, checking, waiting, blocked and cancelling where
  reported. Display drained/revoked machines separately from connectivity. A
  worker with a live coordinator/review lease is occupied even if its transport
  state says waiting. Derive availability from authoritative capacity, roles and
  reservations, not from an absence of log lines.
- Show declared host capacity and task reservations separately from measured
  load. Collect timestamped host CPU utilization, used/total RAM and free disk;
  show per-worker process-tree CPU/RAM when supported, occupied/free slots and
  reserved resources. Define CPU percentage normalization so values are comparable.
  Unsupported or stale measurements display unknown/stale, never zero. Host load
  includes unrelated processes and must not be attributed entirely to workers.
- Extend the versioned supervisor/monitoring contract with bounded optional
  metrics and documented sampling, staleness and retention limits. Older workers
  remain compatible; failed metrics collection cannot stop leases or task work.
  Metrics are observational and must not silently change scheduling limits.
- Subscribe to durable events with reconnect/cursor recovery and periodic status
  reconciliation. On connection loss, retain the last snapshot with an explicit
  stale indicator. Never present an expired heartbeat as a healthy worker.
- Support filtering by run, machine, worker state, repository and task. Provide
  readable mobile/desktop layouts, keyboard navigation and text labels alongside
  colors. Expose no machine/admin tokens, private credentials, raw model reasoning
  or customer data. Use authenticated operator access with read-only scope;
  privileged credentials must not be shipped to the browser.

Acceptance covers one worker, multiple workers on one machine and ten simulated
hosts; waiting/running transitions, live role occupancy, offline/stale workers,
reconnect with missed events, absent metrics from older clients and reservations
that differ from measured load. Owner API/UI tests and an observed staging check
must match the coordinator and supervisor facts. Release this dashboard as part
of delivery-control without redeploying unchanged product applications.

### 2.2 Atomic claims, queue order and leases

Dispatch under a database transaction with row locks/compare-and-swap. Assign the
oldest **eligible** waiting worker by `(waiting_since, worker_id)` and the highest
priority eligible task by `(priority, ready_since, task_id)`. Eligibility includes
capabilities, stage, dependencies, access, machine capacity and resource locks.
An offline or incompatible worker cannot block the queue. Task completion returns the worker
to the tail; transient reconnect preserves its position while its presence lease
is valid. A worker has one active assignment; a machine may host several workers
up to its configured slot and resource limits. Queue positions belong to workers,
not hostnames. Enrollment limits who may add slots, so spawning new agent processes
cannot bypass the configured machine capacity or create duplicate queue entries.

Defaults for the initial implementation: heartbeat every 15 seconds, work lease
120 seconds, waiting-worker presence 90 seconds, and event reconciliation at most
every 30 seconds with jitter. Make these settings configurable and test expiry
using the server clock. A healthy supervisor renews leases while Codex/tests run;
progress timestamps are separate from liveness. A configurable 15-minute absence
of meaningful progress raises an alert; long gates report their live process/log
status instead of fabricating model progress.

Each assignment increments a fencing epoch. Expiry marks an attempt `lost`; a new
worker gets a new epoch. Late results and effects from the old epoch are rejected.
Duplicate messages may occur; exactly-once side effects must not be assumed.

Repository work is isolated per attempt. Start with one implementation task per
repository; enable disjoint-path work only when its scopes/contracts are proven
independent. Parallelize across repositories first. Reviews and read-only tests
can run concurrently. Acquire multi-resource locks in a canonical order.

Workers may prepare local commits but do not hold unrestricted merge/deploy
credentials. A trusted publication/merge/release adapter checks the current epoch,
allowed repo/branch, exact artifact and durable operation intent before effects.
Persist external operation IDs and reconcile uncertain outcomes before retrying.
For GitHub, a merge whose response was lost is resolved by reading the actual
merge SHA. For deployment, lease expiry never authorizes a second deploy until
the existing environment operation is reconciled under the deployment lock.

### 2.3 Persistent worker and shared logs

Install a versioned worker supervisor as a system service (`launchd`/`systemd`
as appropriate), independently of the interactive Codex window. It owns machine
registration, subscriptions, heartbeat, process lifecycle, task checkouts,
artifact upload, cancellation, and restart recovery. Enrollment checks repository
access, installed tools, Codex authentication, disk capacity and capabilities.
One host supervisor manages the configured worker slots; each slot has independent
assignment, execution session, process group, working directory and event cursor.
Starting another supervisor on the same host must attach to the existing service
or fail its host lock, not double the registered capacity.

The supported Codex building block is non-interactive `codex exec`, with `--json`
for events and `--output-schema` for structured final results. See the
[official OpenAI documentation](https://learn.chatgpt.com/docs/non-interactive-mode).
The durable distributed queue and supervisor described here are our implementation,
not an implied built-in Codex feature. Pin/test the CLI version and use each
machine's provisioned credentials and permissions; do not copy login tokens into Git.

Use durable event cursors with SSE or long polling plus periodic reconciliation.
A dropped notification must not lose a ready task. On restart, reconcile existing
processes and assignments before launching anything. If the service is unavailable,
retain local logs, stop new work/effects, and reconnect with bounded backoff.

Each log event includes run/stage/task/attempt/machine/worker/session IDs,
sequence, timestamp,
event type, summary and optional artifact reference. Publish progress at task
start, meaningful milestones, gate start/end, blockage and handoff. Upload command
output incrementally; show exit codes and exact tested SHAs. Shared logs must omit
credentials, customer conversation content and private model reasoning. Filter
raw JSONL events before publication; keep only required restricted local diagnostics.
Use idempotent chunk IDs, redaction, access control and a retention policy.

Rate limits, expired authentication, exhausted budgets and repeated failures
produce explicit blocked/backoff states, not infinite retries. After three failed
automatic attempts at the same task, require coordinator triage. Operators can
pause intake, cancel attempts, drain a machine, or stop a run without losing evidence.

### 2.4 Coordinator is a role, not a permanently special machine

The service enforces scheduling and invariants deterministically. A coordinator
task uses Codex for planning/review/bug triage and is assigned to the first eligible
free worker. Use an exclusive role lease per run; record all decisions durably.
If that machine disconnects, another resumes from records, not conversation memory.

After it creates the QA tasks or triages a defect, the coordinator releases its
role/assignment and returns to the queue. This avoids reserving the only worker.
With one worker, implementation, review and QA use separate clean invocations.
With several workers, prefer a reviewer/tester other than the implementation
author, while avoiding starvation when no other capable machine is available.

### 2.5 Multiple agents on one machine: workspace and resource isolation

`machineId` identifies the enrolled physical/virtual host. `workerId` identifies
one independently queued agent slot on that host. `workerSessionId` identifies a
particular worker process incarnation; a restarted process cannot renew an old
session's lease without reconciliation. `attemptId` identifies one task attempt.
Neither the hostname nor the Codex conversation alone is a sufficient lock key.

Every attempt receives a new exclusive directory, for example:

```text
<deliveryRoot>/machines/<machineId>/workers/<workerId>/runs/<runId>/
  tasks/<taskId>/attempts/<attemptId>/
    repos/<owner>/<repository>/
    runtime/
    tmp/
    logs/
    artifacts/
```

Each repository path is a separate clone by default, with its own `.git`, index,
branch, dependencies and build outputs. Multiple agents may work on the same
remote repository, but never in the same writable checkout. A task that needs
several repositories gets a separate clone for each under its own attempt root;
cross-owner implementation changes still require explicitly assigned scope.
Use a unique branch such as `delivery/<runId>/<taskId>/<attemptId>` and bind its
publication to the attempt's fencing epoch.

Before executing a command, bind its working directory to the allocated canonical
path and verify repository origin/base identity against the assignment manifest.
Do not run tasks in the user's current checkout, another worker's checkout, a
shared `main` checkout, or the production data checkout. Branch switching, stash,
reset, cleanup and dependency installation must never affect another agent.
Shared Git worktrees are an optional later optimization only with supervisor-owned
locking around shared refs/config/pruning; separate clones are the initial rule.
Immutable download caches may be shared through a concurrency-safe cache service;
writable `node_modules`, build directories and test output must not be shared.

Allocate ports atomically through the host supervisor and confirm binding at
process start; a failed bind requests a new allocation. Give each attempt unique
Compose project/container/volume names, test database/schema or file, browser
profile, temporary directory and service socket. Preserve the user's environment
and configure task-specific paths rather than repurposing `HOME`. Reserve CPU,
memory, disk and browser/GPU/exclusive-device capacity before dispatch. Serialize
native UI/performance tests when they share a physical display or measurement
environment; separate folders alone do not isolate those resources.

The supervisor owns process groups and a durable resource manifest per attempt.
Lease loss or cancellation terminates only that attempt's processes and containers;
never use broad process-name kills or system-wide Docker cleanup. Reconcile live
process/container identity before releasing resources after restart. Keep logs and
unpublished changes until uploaded/recovered; remove an attempt directory only
after proving ownership, terminal state and absence of live processes. Validate
canonical paths and reject symlink escapes outside the attempt root. Use a
container or OS isolation when filesystem/process enforcement is required; folder
naming is not itself an access-control boundary.

Resource reservations and workspace records are visible to all workers. One worker
crash must leave sibling agents running; losing the host makes all its worker
leases recoverable independently. Repository scope locks from section 2.2 still
apply globally across hosts: filesystem isolation does not resolve conflicting
changes to the same source or incompatible public contracts.

## 3. State machine and release barrier

Task flow:

```text
blocked(dependencies) -> ready -> leased -> running -> submitted -> reviewing -> done
                                      |                  |
                                      +-> lost/retry     +-> changes_requested -> ready
```

Code tasks become `done` only after acceptance, required owner gates and merge at
the recorded SHA. Review, release, QA and incident tasks have explicit evidence
criteria instead of a merge requirement. Dependencies require accepted results,
not merely an open PR. For package dependencies, `done` also requires a usable
immutable artifact when a downstream task needs to install it.

Stage flow:

```text
implementing -> integrating -> release_ready -> deploying -> production_qa -> accepted
                     ^                            |               |
                     |                            v               v
                     +---------------------- recovery <-------- fixing
```

`paused`, `blocked` and `deployment_uncertain` suspend transitions. A stage is
code-complete at `release_ready`; it is finished only at `accepted`. S(n+1) tasks
cannot be dispatched before S(n) is accepted. Defect fixes and recovery tasks
stay in the current stage and take precedence over ordinary ready work.

### 3.1 Before and during deployment

1. Integrate all accepted owner changes and pin immutable archives/images in their
   consumers. Record a release-set ID with all owner commit SHAs, package hashes,
   image digests, contract versions, migrations, flags and previous versions.
2. Run every affected owner's required gate and Core's applicable integration /
   release gates on that exact composition. Validate in an isolated environment
   before production. Production QA is additional acceptance, not the first test.
3. Freeze the candidate and validate forward/backward compatibility. Include
   unchanged but dependent services in the compatibility matrix. If any artifact
   changes, create a new candidate and rerun affected checks.
4. Execute one deployment workflow for the affected release set. Libraries are
   published and pinned; deploy their affected consumers. Update every affected
   service/UI, without unnecessarily restarting unrelated services. Use existing
   owner release flows and Core deployment locks, not a second SSH deploy system.
5. Deploy providers before dependent consumers, or use additive expand/contract
   migrations and feature flags where a mixed-version interval is unavoidable.
   Do not claim that multiple service replacements form an atomic transaction.
6. Record actual health, release metadata and active artifacts through the live
   gateway. Browser-only releases use their independent activation path. Keep the
   previous exact release set and a tested rollback/recovery procedure.

Deploy credentials belong to the release adapter, not every worker. A configured
run authorization names repositories, environments and permitted release actions;
valid standing authorization permits automatic stage releases without repeated
confirmation. Publishing this plan does not deploy production. Infrastructure
credentials and that run policy must be configured during enrollment/bootstrap.

For an irreversible data migration, specify the backup/restore or forward-repair
path before release. Failed health triggers the established rollback policy.
Unknown outcome holds the environment lock and stage; reconcile actual state
before any retry. Never edit the production data checkout to fix application code.

### 3.2 After deployment: test creation and bug loop

On verified deployment, enqueue exactly one `Sx-QA-PLAN` task for the first eligible
free worker. It becomes coordinator temporarily and materializes the QA matrix
below into repository-owned test tasks. The service enforces uniqueness by
`(stage, release_set, suite, target)` and rejects a QA plan missing required suites.

Waiting workers claim those tasks, fetch the specified repositories and exact
release SHAs, and test the actual deployed versions. A local build is not evidence
that production runs it. Use dedicated synthetic accounts/projects and isolated
test resources; destructive/fault-injection scenarios run in staging. Production
checks record cleanup and avoid real customer data.

A failure is reported with expected/actual behavior, reproduction, release-set
ID, affected repository/surface, logs/screenshots and severity. Reporting creates
a durable triage item immediately. The next coordinator deduplicates it, opens a
linked defect and scoped fix task in the responsible repository, and places the
fix at the appropriate queue priority. Workers do not exchange private bug notes.

The first eligible waiting worker implements the fix, obtains review and gates,
and updates the release candidate. Deploy the corrected affected composition,
verify the reproduction and affected regression suites, and rerun common smoke
checks. Previous evidence can be retained only for unchanged artifacts/contracts
with an explicit coordinator decision; never reuse it across an affected change.

P0/P1 failures stop rollout and invoke rollback/recovery; P2 requirement failures
block stage acceptance. Lower-severity unrelated findings require explicit owner
deferral with rationale. The coordinator cannot waive an unmet acceptance criterion.
Close a bug only after a test verifies the fix on the corrected release set.

Only the service's acceptance transaction may set a stage to `accepted`: all
required tasks and QA results accepted, exact production release confirmed,
no unresolved blocking bugs or uncertain deployment, evidence complete. It then
activates the next stage and wakes the queue. The final stage completes the run.

## 4. Execution stages and task backlog

The tables define task specifications, not live assignments. Stage dependencies
are implicit: every row in S(n) requires acceptance of S(n-1). Within each table,
`Depends on` adds finer dependencies; independent rows can run on separate workers,
including workers on the same machine with isolated resources.
Each task includes owner tests, relevant documentation and immutable handoff
evidence. Repository aliases below refer to the exact owners in section 1.

### S0 — Build and commission distributed delivery

This one-time bootstrap must precede parallel product work. The owner designates
one bootstrap worker on one machine and provides the private repository, control
hosting, PostgreSQL/artifact storage, machine enrollment and release access. That worker
implements B01–B03 sequentially; after B03 passes, it imports this backlog and
enrolls the other machines to execute the remaining S0 tasks through the service.
Before that handoff there is no automatic waiting subscription to promise.

| ID | Owner | Depends on | Deliverable and acceptance |
| --- | --- | --- | --- |
| B01 | delivery-control | — | Repository, versioned schemas including separate machine/worker/session/workspace identities, migrations, pinned plan compiler and task DAG validator; invalid/cyclic/mismatched manifests cannot activate |
| B02 | delivery-control | B01 | Authenticated API, FIFO eligible dispatch, machine resource reservations, task/role leases, fencing, durable events, idempotency and state transitions; simultaneous claims yield one winner and cannot exceed host capacity |
| B03 | delivery-control | B02 | Host supervisor with multiple worker slots, isolated per-attempt repository clones/runtime resources, enrollment/start instructions, Codex adapter, logs and restart recovery; sibling workers demonstrate claim/wait/wakeup and independent failure recovery |
| B04 | delivery-control | B03 | Shared status/log dashboard or CLI with worker queues grouped by machine and workspace/resource visibility, worker/host draining, pause/resume, retry budgets and database/artifact backup/restore drill |
| B05 | Core | B03 | Versioned tooling adapters for existing owner gates, release manifests, deployment locking and observed-version evidence; use published interfaces without changing product runtime; demonstrate isolated no-op and failed-release recovery |
| B06 | delivery-control | B04, B05 | Trusted publication/merge/release adapters, coordinator role, QA generation and defect loop; rehearsals with 1 worker, at least 3 real concurrent workers on one host, and 10 simulated hosts with multiple slots, including stale effects, sibling isolation and coordinator failover |

**Release/acceptance:** deploy the control service separately; do not redeploy
unchanged product services. Prove queue fairness, missed-event recovery, expired
lease fencing, control outage behavior, single-worker progress, duplicate deploy
rejection, restore recovery and complete shared evidence. On one host, demonstrate
isolated clones of the same remote repository, simultaneous installs/builds/tests,
noncolliding ports/databases/Compose/browser resources, capacity enforcement and
termination/cleanup of one attempt without affecting siblings. Exercise both a
worker crash and host-supervisor restart. Then accept S0 and open S1.

### S1 — Freeze contracts and compatible foundations

| ID | Owner | Depends on | Deliverable and acceptance |
| --- | --- | --- | --- |
| O01 | delivery-control | B06 | Required authenticated worker operations web UI and compatible load telemetry: machine/worker availability, assignments, queue, live role occupancy, measured CPU/RAM/disk versus capacity/reservations, stale/reconnect handling and tests from section 2.1.1; independent of chat contract tasks |
| C01 | core-ui | — | Inventory current chat features/settings in every host; define reusable runtime, skin/slot boundary, ownership of settings and migration matrix; approve shared parity fixtures |
| C02 | SDK | — | Versioned registered-application/delegation and origin-application attribution contracts; distinguish origin from executor, token and module; old payload fixtures remain supported |
| C03 | Core | C01, C02 | Additive REST/WS chat/settings and verified application context contracts; permission/capability semantics and reconnect rules; publish immutable contract artifact |
| C04 | Identity | C02 | Publish delegated-principal/introspection and application-management contracts, scope/resource model, expiry/revocation semantics and client fixtures |
| C05 | Billing | C02 | Publish reservation/settlement/report attribution contracts and historical-record policy; establish trusted source and idempotency fixtures |
| C06 | core-ui | C03, C04, C05 | Freeze consumer package API and cross-owner compatibility matrix using released contracts; build fixture host that installs public packages without source aliases |

**Release/acceptance:** publish additive contract artifacts, update affected
consumers, and deploy changed foundations with existing behavior preserved.
No external-application access is enabled yet. All existing chat/auth/accounting
flows pass against the mixed-version and candidate matrices.
O01 deploys the delivery-control dashboard separately and verifies its observed
worker states and metrics; unchanged product services are not restarted for it.

### S2 — One complete chat, two skins, all internal hosts

| ID | Owner | Depends on | Deliverable and acceptance |
| --- | --- | --- | --- |
| U01 | sielexa-ui | — | Required neutral layout/settings primitives and design tokens, with public exports; no chat state or account logic in the primitive library |
| U02 | Core | — | Persist/validate the canonical settings semantics defined in S1, including migration and revision/conflict handling; same conversation yields the same settings across hosts |
| U03 | SDK | — | Stable chat client ports for transport/reconnect, attachments, settings and capability discovery; two independent clients do not leak state |
| U04 | core-ui | U01, U02, U03 | Publish complete chat runtime/UI and common settings component with widget and kanban skins; functional parity, multiple-instance lifecycle, mobile and keyboard checks |
| U05 | Make | U04 | Replace owned chat composition with released widget skin and Make context adapter; files/tools/settings and streaming work through public APIs |
| U06 | Web Reader | U04 | Adopt widget skin and page/selection adapter; preview lifecycle and chat settings remain correct |
| U07 | Playwright Reader | U04 | Adopt widget skin where chat is embedded; preserve browser-session context and cleanup |
| U08 | core-ui | U04 | Adopt widget skin in Console and kanban skin in task views; main chat and other existing embedded hosts use the shared implementation; delete superseded behavior copies |
| U09 | Desktop | U08 | Consume released renderer and verify preload/session/voice compatibility without source imports |
| U10 | Core | U05, U06, U07, U08, U09 | Pin the complete owner artifact set and run host/resource/transport acceptance with the exact builds |

Common behavior includes message rendering, streaming, cancellation, queues,
attachments, voice where available, tools/progress, errors and reconnect. Settings
have one schema, defaults, validator and UI implementation. Account preferences
are shared; conversation overrides belong to the conversation; device-specific
microphone/output choices stay local to the device. Skins add no semantic settings.
Unsupported host capabilities show consistent availability states rather than
silently dropping settings. Context-dependent tools remain host/resource-scoped.

**Release/acceptance:** deploy all affected UI/host consumers and any Core changes.
Test both skins and every migrated surface, including switching the same
conversation between surfaces, simultaneous instances, saved settings and active
turn recovery. No legacy duplicate chat implementation remains on a live path.

### S3 — Delegated application access and trustworthy accounting

| ID | Owner | Depends on | Deliverable and acceptance |
| --- | --- | --- | --- |
| A01 | Identity | — | Application registry and grants: stable app ID, owner/tenant binding, scoped resources, issue/hash/rotate/revoke/expire tokens, audit and quotas; one application cannot impersonate another |
| A02 | Billing | — | Persist origin application throughout reservation/settlement/reporting; trusted attribution, idempotency, migration and app-level totals; rename/revoke/delete do not erase historical attribution |
| A03 | llm-runner | — | Preserve verified attribution in claims/receipts and recovery; no caller-controlled origin override and no change to legacy CLI profile identity |
| A04 | Core | A01, A02, A03 | Verify delegated principal on REST/WS and execution, enforce conversation/project scopes, propagate app identity through queue/outbox/child operations; reject spoofing and stale grants |
| A05 | SDK | A01 | Server credential adapter and short-lived browser-session acquisition/refresh; explicit expiry/revocation and reconnect behavior, no long-lived app secret in browser storage |
| A06 | Analytics | A02 | Application report projection/filter and optional activity aggregation; account/app totals reconcile to Billing without double counting child operations |
| A07 | Core | A04, A05, A06 | Exact-composition acceptance for external app execution, revocation, queue recovery and reports; feature-flagged synthetic application completes the whole path |

Use an immutable `originApplicationId` (final field naming belongs to C02) distinct
from `actorClientId`/executor and `originModuleId`. Derive it from verified
delegation and preserve it across service hops and retries. Skin and token IDs
are not billing dimensions. Old records without this evidence remain explicitly
legacy/unattributed; do not invent historical allocations. Removing an app revokes
future access while retaining an audit-safe identity for historical reports.

Initial grants default to application-owned conversations. Access to existing
account conversations/projects requires explicit scopes and resource grants.
Starting a turn requires live delegated access; revocation blocks queued/new work
and closes affected sessions. Define cancellation of already-running work in C04;
settlement of incurred usage must still succeed after token revocation.

Do not expose external access until verified application attribution reaches
Billing end to end. Registration can deploy disabled while dependencies roll out.
Reuse the current accounting outbox and ledger boundaries; avoid a parallel meter.

**Release/acceptance:** deploy compatible Identity/Billing/runner providers before
Core/SDK consumers, then test limited synthetic traffic. Verify token rotation,
revocation, tenant/resource isolation, spoof rejection, duplicate/recovered turns,
and exact application totals. Keep public enrollment disabled until S4 acceptance.

### S4 — Self-service integration and application reports

| ID | Owner | Depends on | Deliverable and acceptance |
| --- | --- | --- | --- |
| E01 | Identity | — | Account-owned My Applications UI: create/name/scope, one-time secret display, rotate/revoke/delete, status and integration instructions; use released grant APIs |
| E02 | SDK | E03 | Published connection API, backend-mediated browser example, public-client authorization-code/PKCE flow for apps without a backend, refresh/reconnect, version compatibility and integration docs |
| E03 | Identity | — | Public-client authorization/consent and PKCE exchange required by E02; redirect validation, session lifetime and revocation fixtures |
| E04 | Analytics | — | Application-filtered reporting API and view model: period, requests, input/output/cache tokens, recorded cost and historical labels; show missing evidence explicitly |
| E05 | core-ui | E01, E04 | Host My Applications UI and Billing application report surfaces via owner APIs; account totals, app totals and filters agree |
| E06 | core-ui | E02, E03 | Publish documented standalone chat/skin entry points and a clean external sample installing exact public packages; both skins, settings, multiple instances and auth expiry work |
| E07 | Core | E03, E06 | Complete browser integration: allowed origins, authenticated REST/WS/upload paths and delegated sessions; live external sample works without the Sislexa shell |
| E08 | SDK | E02, E03, E05, E06, E07 | Validate setup from a clean machine using published artifacts and user documentation; record end-to-end onboarding and usage evidence |

E02 consumes E03's released public-client implementation. Fixture-based design
work belongs to the earlier contract stage and does not bypass this dependency.

**Release/acceptance:** deploy account/UI/API changes, verify external apps using
both supported auth paths, and enable enrollment only after release gates pass.
Create two applications in one account, execute distinct workloads through both
skins, and verify separate statistics whose sum reconciles with the account.
Check rotating a token and changing a skin preserve application history. Final
acceptance includes S0 recovery checks and regression across all internal hosts.

## 5. Mandatory QA task templates per release

The coordinator selects every applicable row and records why any row is not
applicable. A changed transitive contract can make a suite applicable even when
its repository did not change. Split large rows into independent tasks using the
same release-set ID; resource locks isolate accounts, conversations and browsers.

| QA family | Owner/test checkout | Minimum evidence |
| --- | --- | --- |
| Control reliability | delivery-control | Concurrent claim, fairness, wait/wakeup, restart, lost worker, stale coordinator, duplicate effect, restored state and multiple agents on one host with independent checkouts/resources/cleanup |
| Chat/settings parity | core-ui | Both skins, all settings, rendering/stream/stop/queue/attachments, accessible keyboard/mobile flows, isolated instances |
| Product embedding | Each Make/Reader owner and core-ui Console/Kanban | Real host context/tools, no settings divergence, navigation and cleanup |
| Core transport/access | Core | REST/WS parity, reconnect, conversations/resources/tenant isolation, uploads and existing-session regression |
| Credentials/delegation | Identity + Core integration | Issuance, restricted scopes, expiry/rotation/revocation, redirects/origins and spoof rejection |
| Financial attribution | Billing + Core/runner integration | Reservation/settlement/recovery, retry deduplication, app identity persistence and reconciliation |
| Reports | Analytics + account UI host | App/period filters, totals, legacy attribution, zero/missing evidence and renamed/deleted app history |
| External integration | SDK + core-ui fixture/sample | Clean installation, both auth paths, skin import, simultaneous chats, documented setup and version compatibility |
| Desktop/voice | Desktop; released Voice package through chat | Existing login/renderer/audio behavior and device-local settings; owner gates if Voice changes |
| Deployment/regression | Core release adapter + affected owners | Actual versions/digests, live gateway assets, common smoke, unchanged-service health and recovery evidence |

## 6. Definition of done and handoff format

Every submitted implementation result includes repository/base/head SHAs, PR,
changed behavior, owner gate commands and exit codes, test/build reports, public
artifact version/hash, compatibility/migration notes and remaining blockers.
Review verifies the result against task scope and pinned dependencies. Moving to
a newer base invalidates affected gate evidence and requires checks again.

Every QA result includes release-set ID, observed runtime versions, target URL/
environment, suite/scenarios, test account/resource identifiers, outcome,
artifact links and cleanup result. Redact credentials and customer data.

Every defect includes stage, release set, severity, reproduction, expected/actual
behavior, evidence, owning repository, related task, deduplication key, fix PR,
corrected release and verifying QA task. Environment failures are visible blocked
results, not fabricated product bugs or successful tests.

Every accepted stage includes an immutable release manifest, merged task list,
required QA matrix with results, resolved/deferred-defect decisions, production
version evidence, rollback/recovery evidence and an acceptance event. Preserve the
stage history after opening the next stage.

## 7. Initial activation checklist

1. Publish this plan to Core `main` and record its full commit SHA.
2. Designate the single S0 bootstrap worker and its machine; create/configure the private
   `delivery-control` repository and independent control hosting/storage.
3. Configure repository access and run policy for branches, PRs/merges, artifact
   publication and allowed staging/production releases. Respect repository gates
   and platform permissions; keep deployment credentials in the release adapter.
4. Implement and validate B01–B03, install the supervisor, import the pinned plan
   and compile all task dependencies and QA templates. Mark completed bootstrap
   tasks only with their evidence; leave remaining tasks blocked/ready as computed.
5. Enroll 1–10 machines with capabilities, capacity and budgets. Configure one or
   more independent worker slots per machine; validate isolated checkouts/runtime
   resources, authentication and artifact access. Publish actual commands to add
   a worker, join, inspect the queue/logs and drain one worker or the whole host.
6. Complete B04–B06 through the queue, commission and test the control deployment,
   then let the accepted-stage transition open S1 automatically.

Until these steps exist, instructions such as "execute the plan and wait for the
next task" cannot provide durable distributed coordination. The deliverable of
this commit is the shared specification; Stage 0 builds the mechanism that makes
the remaining stages executable by any enrolled machine.

## 8. Repository references

- [Current ownership](../kb/architecture.md#tool-repository-ownership) and
  [Core UI distribution](../kb/clients.md#core-ui-distribution).
- [Existing chat package boundary](../kb/ui.md#фактическая-граница-voicechatchat-app).
- [Identity and accounting](../kb/data-auth.md).
- [Existing release mechanisms and limitations](../kb/features/releases.md) and
  [deployment operations](../kb/deploy.md).
- [Required gates](../kb/testing-operations.md) and
  [repository conventions](../kb/conventions.md).

Older KB sections retain pre-extraction paths. Current owner repositories and
their released public contracts take precedence; this plan is not evidence that
its proposed capabilities already exist.
