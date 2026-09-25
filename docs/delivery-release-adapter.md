# Core delivery release adapter v1

B05 provides a tooling boundary for `delivery-control`; it does not install a
production release, publish packages, merge branches, or accept a stage. Pin the
Core commit containing these scripts when installing the adapter. JSON results
have `schemaVersion: 1`; `describe` identifies the adapter's protocol version.

```sh
node --import tsx scripts/delivery-release.mjs describe
SISLEXA_DELIVERY_GATE_WORKER=1 node --import tsx scripts/delivery-release.mjs gate /private/gate-input.json
node --import tsx scripts/delivery-release.mjs validate /private/release-set.json
node --import tsx scripts/delivery-release.mjs observe /private/observe-input.json /etc/sislexa/release-adapter.json
python3 scripts/delivery-release-lock.py deploy /private/effect.json /etc/sislexa/release-adapter.json "$(command -v node)"
python3 scripts/delivery-release-lock.py reconcile /private/effect.json /etc/sislexa/release-adapter.json "$(command -v node)"
```

Run `gate` only on an isolated, unprivileged implementation/test worker with no
release-host credentials, Docker administration access, or deployment secrets in
its home directory. Candidate npm scripts are executable code, so an environment
filter is not a sandbox. The explicit `SISLEXA_DELIVERY_GATE_WORKER=1` marker
acknowledges that commissioned worker context; root, an inherited deployment lock
and `VC_REPO_DIR` release context are rejected. Only a small execution environment
allowlist reaches Git/npm (PATH, HOME, identity/locale and task temp paths); token
and release variables are not inherited. Keep the worker's original HOME and
isolate credentials through the worker account/container, not by pointing HOME
at another account. B06 must enforce this placement when scheduling owner gates.

Run deployment commands on the separate trusted release host. Run from this exact
installed Core checkout so `tsx` resolves to its pinned installation. Use an operator-owned immutable installation and private configuration;
do not execute a worker-modified adapter with deployment credentials. Python 3
and POSIX `flock` are required. The launcher holds an inherited kernel file lock
through Node. `delivery-release-command.py` also holds that same lock while each
Docker command runs, so killing the adapter cannot unlock an in-flight command.
The lock is released when the last holder exits. The adapter re-acquires the
inherited descriptor with nonblocking kernel flock before effects: an open FD
pointing at the right file alone is insufficient. Configure `hostLock` to the
same absolute file as `VC_DEPLOY_LOCK` for `voicechat-deploy` and
`voicechat-ui-deploy` (normally `/var/lock/voicechat-deploy.lock`). Never unlink or
replace that lock file. All release callers must use that lock and the shared
adapter state directory. The exported JavaScript function assumes this host lock
is already held; it is not an alternative unlocked deployment entry point.

## Detached source deployment authority

Source deployments use `voicechat-deploy`, not the OCI launcher. The trusted
broker creates a private immutable JSON envelope outside candidate workspaces and
calls `voicechat-deploy --operation-id <id> --expected-commit <sha>
--delivery-fence /protected/input.json`. The envelope has exactly these fields:

```json
{
  "schemaVersion": 1,
  "expectedCommit": "<40 hex target Core commit>",
  "expectedPreviousCommit": "<40 hex observed Core commit>",
  "lease": {
    "id": "effect-id",
    "epoch": 1,
    "leaseId": "lease-id",
    "expiresAt": 1790200000000,
    "action": "deploy",
    "runId": "shared-chat-v1",
    "environment": "production",
    "releaseSetId": "candidate-id",
    "manifestHash": "<64 hex canonical candidate hash>"
  },
  "verifyLeaseCommand": ["/opt/delivery-control/bin/verify-release-lease"],
  "environment": {}
}
```

The broker must validate the candidate's exact source transition and owner gate
evidence before writing this envelope. Worker input cannot set verifier commands,
environment or file paths. Install the verifier outside worker-writable paths;
its command accepts the same stdin/receipt protocol as B05. Only `PATH`, `HOME`,
`DELIVERY_CONTROL_URL` and `DELIVERY_RELEASE_VERIFIER_TOKEN_FILE` are permitted in
its explicit environment. Keep credentials in the protected token file. The
envelope is a regular mode-0600 file with canonical, root/operator-owned ancestors
that are not group/world writable. Do not place it under `/tmp`.

The parent verifies current authority and pins the envelope's byte hash. The
detached child rejects changed bytes and independently verifies authority. Under
the existing host lock it compares the live previous Core commit before any Git
or Docker mutation; every Docker call and successful completion verifies again.
The envelope and its immutable transition are recorded by hash/identity only;
credentials and verifier output are never journaled. Verification has a ten-second
timeout and rejects expired leases, errors and mismatched receipts. Losing
authority does not kill an already-running Docker operation: the host lock stays
held until it exits, and further commands stop. This prevents a replacement
operation from overlapping it; it is not instantaneous cancellation.

Use `--reconcile-operation <id> --delivery-fence /protected/new-input.json` with
new live `reconcile` authority and the same run/environment/candidate/hash/source
transition. Unknown command completion still requires explicit owner recovery;
reconciliation never launches deployment or rollback. This contract covers only
the Core source transition. OCI composition and independent UI generation have
their own owner contracts. Installing this tooling is not deployment acceptance.

## Owner gate and manifest

Gate input is `{ "repository": "sislex/make", "commit": "<40 hex SHA>",
"checkout": "/absolute/disposable-owner-clone" }`. The clone must already contain
its pinned dependencies. The adapter checks origin, exact HEAD and cleanliness
before and after running the existing owner's `gate:release`, or `gate` when no
release gate exists. Failed gates emit no passing evidence. It does not substitute
Core tests for another owner's internal tests. B06 must install the correct
artifacts and run the complete affected-owner/compatibility matrix; one owner's
gate is not evidence for the whole composition. Gate subprocess output stays in
bounded memory and is not published as raw logs. Passing evidence records the
command, exact SHA, timestamp and zero exit code; retain its canonical content hash
and store the evidence itself in the restricted control artifact store.

A release-set input has these fields (see `parseReleaseSet` and the fixture in
`scripts/delivery-release.test.mjs` for the executable schema):

- `schemaVersion: 1`, unique `releaseSetId`, `runId`, nonnegative `stage`,
  `environment: staging|production`.
- `previous`: the full observed `ApplicationEnvironment` public contract.
- `releases`: existing `ApplicationReleaseManifest` objects with exact OCI digests,
  owner commit, implementation/API/data versions, capabilities and dependencies.
- `owners`: one entry per repository with `repository`, `commit`, successful
  `gate: {command, exitCode: 0, evidenceSha256}` and `artifacts` containing
  `{name, version, sha256}` for pinned package/archive inputs. Every changed
  application must match its catalog owner and the owner's gate commit.
- `flags`: boolean flag decisions; `migrations: []` for this adapter version.
- `recovery: {strategy: "artifact-rollback", evidenceSha256}` referencing a tested
  recovery report. Changed data formats and new installations are rejected.

`validate` returns the canonical manifest hash. Release-set IDs are immutable in
the deployment journal; changing any field requires a new candidate and new
applicable gate evidence. Evidence hashes are references, not signatures: B06's
trusted verifier must validate the stored reports and exact candidate authorization.
Workers cannot self-attest a release by handing the adapter arbitrary hashes.

## Trusted host configuration and fencing

`release-adapter.json` contains:

```json
{
  "hostLock": "/var/lock/voicechat-deploy.lock",
  "deployment": {
    "projectId": "sislexa",
    "environment": "staging",
    "projectName": "sislexa-staging",
    "composeFiles": ["/srv/sislexa-staging/compose.yml"],
    "stateDir": "/var/lib/sislexa-release/staging",
    "health": {"voicechat": {"port": 8799, "path": "/api/health"}}
  },
  "policy": {
    "schemaVersion": 1,
    "runId": "shared-chat",
    "environment": "staging",
    "actions": ["deploy", "reconcile"],
    "repositories": ["sislex/voiceAIChat", "sislex/make"]
  },
  "verifyLeaseCommand": ["/opt/delivery-control/bin/verify-release-lease"]
}
```

The verifier path above is a commissioning placeholder, not an installed B05
program. B06 supplies that trusted executable and its private connection
credentials. Configure a health endpoint for every catalog service used by the
Compose environment. The existing deployment config also supports `envFile` and
health `tokenEnv`; secrets remain on the release host.

Effect input is `{ "request": { "id": "effect-unique", "epoch": 1,
"leaseId": "lease-unique", "expiresAt": 1790200000000 }, "manifest": {...} }`.
Use the same effect ID and exact manifest to reconcile after an interrupted effect;
renewed authority supplies a newer lease epoch. Epochs are monotonic per deployment
environment/state directory across runs; B06 must not reset them to a new run's
initial role-lease epoch. The trusted command receives a
JSON envelope on stdin including action, run, environment, candidate ID and
manifest hash. It must check the live coordinator's current lease, exact candidate
and permitted action, then return only
`{"valid":true,"epoch":1,"leaseId":"lease-unique"}`. Failure, timeout, revocation,
expiry or epoch mismatch fails closed. No network outage grace period permits a
new release effect. The verifier command is taken from host configuration, never
from a worker's request. Retain the same journal across lease/session changes.

The journal is atomically replaced and fsynced before effects, storing the highest
accepted epoch, immutable candidate hash, active effect, original unaffected
container identities and completed receipts. Exact completed retries return the
stored receipt without deploying twice; changed payloads and stale fences fail.
An interrupted/uncertain operation retains the logical environment barrier even
though its OS lock is released. Do not delete that record to retry. Reconciliation
observes actual state and clears the barrier only when the exact healthy previous
or candidate composition is proved and unaffected containers are unchanged.
Reconciliation does not perform a second deployment. If neither composition
matches, operator recovery remains necessary before a new release is authorized.

The existing Docker adapter verifies immutable image labels, runtime version and
health responses, dependency compatibility, service links and untouched container
identities. It replaces only selected services and attempts the established exact
artifact rollback. Multiple replacements are not an atomic transaction; B06 must
sequence providers/consumers and approve compatibility throughout the mixed-version
interval. Each adapter operation and each Docker subprocess verifies the lease; an in-flight external
command may finish after lease loss, so the journal remains uncertain and must be
reconciled. The host lock prevents another adapter process from overlapping it.
Result evidence re-observes actual versions/digests after release or rollback.
No-op succeeds only when healthy intended and previous compositions already match;
it performs no pull or replacement. CLI exit codes are 0 for successful results,
2 for a failed/recovered or uncertain deployment, and 1 for rejected input or
execution failure. A recovered release failure is never a successful stage release.

## Commissioning and boundaries

B05 tests use disposable directories and deterministic runtime fixtures for no-op,
release, failed health and recovery, rollback failure, lease loss, restart
reconciliation, stale fencing and immutable replay. A real POSIX process test
proves that the lock survives exec, blocks another flock user, stays held when
Node dies during an in-flight command, and releases after the last holder exits. These are isolated control proofs, not production rollout evidence.

The deploy adapter currently supports catalog OCI application releases. Libraries
are immutable manifest inputs deployed through their consumers. Independent
browser archives continue to use the published `voicechat-ui-deploy` interface;
they must not be disguised as OCI service updates. B06 must commission that
activation adapter and capture `/ui/runtime.json`, live gateway assets and Core
container identity evidence using its existing validation/rollback protocol.
Unknown runtime versions, missing owner reports, irreversible data migrations and
unconfigured environments block release. B06 additionally owns authenticated
coordinator integration, provider/consumer release ordering, publication,
production authorization and the QA/defect/stage transition loop.

## Existing Core detached entrypoint

Source deployments through `voicechat-deploy` support `--operation-id <id>` with
`--expected-commit <40-hex-sha>`. Poll `--status-operation <id>`; initial `accepted`
and a zero launcher exit code do not prove completion. The source launcher checks
the clean expected HEAD after its normal fast-forward pull and matches the live
Core application SHA after readiness. A moved branch fails before runtime effects.
The private durable journal deduplicates identical requests and blocks replacement
effects after an uncertain operation. `--reconcile-operation <id>` only observes
under the existing host lock; it never starts another deployment. Unknown Compose
completion requires operator recovery even if a health probe currently succeeds.

This is a separate existing owner entrypoint, not a command to run under the
B05 inherited-lock launcher: it takes the Core/UI lock itself. Delivery-control
retains its own fenced intent, polls the owner operation and verifies the full
composition and unaffected containers before accepting a release. A `recovered`
owner operation is a failed release with proven previous runtime, never acceptance.
See the deployment KB for journal fields and commissioning limitations.
