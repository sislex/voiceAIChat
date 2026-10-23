# sislexa Chat v1 public launch

Status: local candidate acceptance and public commissioning preparation, 2026-10-20. This is a launch
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

## Deployment separation

The domain `sislexa.by` selects one limited deployment configuration; sislexa
remains the full modular product. The owner explicitly requires the existing
`http://89.125.68.35/` installation to retain its old version, applications,
configuration and data. No deploy, restart, registry edit or migration on that
installation is authorized by this launch plan.

The read-only production baseline is Core 0.1.480 at
`9c44cb0d211cf23b42de0dcb2735c06ffae8507d`, all seven local apps enabled,
Compose project `voiceaichat`, Core ID `localhost`, component environment
`production`. The candidate instead uses project `sx-dev-m2-07fb81fd`, Core and
component identity `stand-dev-m2-public-chat`, loopback gateway 23001/Core 17801,
and isolated stand/operator data. Exact boundaries and the fixed Core volume
name hazard are recorded in the [deployment KB](../kb/deploy.md#public-chat-deployment-isolation).

The public environment is not provisioned yet. Give it its own Core/component
identity, Compose project, ports, Core/PostgreSQL/Identity/Billing/runner state,
credentials and backups. A different Compose project alone is insufficient:
explicitly replace root Compose's fixed `voicechat-server-data` volume name or
use a dedicated bind. Do not share the old Caddy, database, Billing ledger,
component provider registries or release target. DNS, mail and the service
Codex account remain separate operator commissioning work.

## Reviewed publication sequence

At the 2026-10-20 pre-release source freeze, the source route and promotion
requirements are as follows. Final publication and stand receipts are recorded
separately against the clean tested Core commit.

| Owner | Reviewed source route | Remaining publication |
| --- | --- | --- |
| Core | [#768](https://github.com/sislex/voiceAIChat/pull/768) `integration/public-chat-stand-v1` → `feat/public-chat-launch-v1`, then [#767](https://github.com/sislex/voiceAIChat/pull/767) → `dev` | Final combined gates, reviewed `dev` → `main` promotion and immutable Core release artifact |
| Core UI | Reviewed owner promotion through `dev` → `main`; exact 1.5.28 source `f86cdd2db9e4e002f1fd14da36bed6fa1119eb2c` retained in the immutable tag and archive | [1.5.28 published](https://github.com/sislex/sislexa-core-ui/releases/tag/v1.5.28), downloaded archive verified; strict Core install and 24 consumer checks passed, with one existing skip |
| Identity | [#36](https://github.com/sislex/identity/pull/36) and [#35](https://github.com/sislex/identity/pull/35) merged into `main`; `dev` synchronized | [1.5.2 published](https://github.com/sislex/identity/releases/tag/v1.5.2), including verified AMD64 image |
| Billing | Runtime-peer compatibility follow-up [#12](https://github.com/sislex/billing/pull/12), exact source `db6000b7a87cfb200bf7cc697dbafafde6a60171` | [1.2.4 published](https://github.com/sislex/billing/releases/tag/v1.2.4); verified archive accepts runtime `>=1.0.1 <2.0.0` with unchanged ledger implementation |
| Web Reader | Reviewed owner promotion, exact 1.3.4 source `e0ff32cee8ee80da2953bbfe71c982ecec563cd5` | [1.3.4 published](https://github.com/sislex/webreader/releases/tag/v1.3.4); runtime and contracts archives verified, including visual-enabled owner system acceptance |
| LLM Runner | [#28](https://github.com/sislex/llm-runner/pull/28) and [#27](https://github.com/sislex/llm-runner/pull/27) merged into `main`; [#29](https://github.com/sislex/llm-runner/pull/29) synchronized `dev` | [0.3.8 published](https://github.com/sislex/llm-runner/releases/tag/v0.3.8), including verified AMD64 image |

1. Integrate the completed follow-up branches into their reviewed owner PRs and
   freeze the final source SHAs. Run the required owner gates. Publish the new
   optional analytics contract from its exact reviewed Core SHA as Shared
   `0.1.43` before the UI consumes it; retain package provenance and hashes.
2. Use new owner release versions. Existing tags Identity `v1.5.1`, Billing
   `v1.2.2`, Runner `v0.3.7` and Core UI `v1.5.25` already exist and must not be
   replaced with candidate bytes. Choose the next unused patch at publication
   time, run version/KB updates and owner release checks, and review the resulting
   release commit. Existing owner PR bases differ: do not silently retarget the
   Identity/Billing/Runner PRs through `dev`. Synchronize owner `dev` with reviewed
   `main` without force after promotion, resolving divergence explicitly.
3. From clean owner clones use the existing publication adapter
   `node --import tsx scripts/owner-release-publish.mjs --source <owner-checkout>`.
   A canonical UI pack must use the final immutable Core test SHA. Verify each
   remote tag's actual commit, release manifest, archive hashes and image digest.
   Publication uploads artifacts; it does not authorize a service restart.
4. Pin verified owner outputs in the Core integration branch, including the
   polished UI and compatible contracts. Re-run combined Core/consumer release
   checks and local-stand acceptance for that exact composition. Complete the
   stacked Core reviews, then separately review `dev` → `main`; re-gate any
   changed merge result. Retain the current full-deployment regression evidence.
5. Stop at reviewed, published artifacts and local candidate evidence. Do not
   invoke `release-train run`, `run --resume`, `/releases/branches`,
   `/releases/deploy` or `voicechat-deploy` against the existing Release Center
   project. Its production target is the protected old IP, and even train without
   `--deploy` prepares a release there. Commission a distinct public target before
   considering any public environment action.
6. Before and after future public commissioning, compare the old installation's
   health commit, image IDs, mounts, component identities and application manifest
   with the preserved baseline using read-only checks. A release publication or
   PR merge alone is not evidence that either running deployment changed.

### Published owners and prepared stand candidates, 2026-10-20

The following clean source commits passed owner gates and independent review.
Their canonical packages were uploaded under content-addressed names to Core's
vendor release and downloaded again to verify SHA-256. Local ARM64 images were
built from exact Git archives and checked against shipped source and runtime
version metadata. Official AMD64 releases have also been published and their
remote tags, downloaded archives, image digests and runtime configuration
verified. Publication has not replaced the running stand or the protected
production installation.

| Owner | Version and source | Verification |
| --- | --- | --- |
| Identity | 1.5.2, `b71a98ec8ee2bb7ecedc2128a8c7f3184c3ff14e`, [#36](https://github.com/sislex/identity/pull/36) | 502 unit tests, 2 browser tests, smoke and 3 package checks; 5 existing PostgreSQL skips remain |
| Billing | 1.2.3, `a3897238443664a9a49b964bced4f02212e5c7b7`, [#11](https://github.com/sislex/billing/pull/11) | 41 owner tests and package gate; this patch aligns release metadata without changing ledger behavior |
| LLM Runner | 0.3.8 / contracts 0.1.3, `edcfb71a3ddc7b6f8ecf00558a392ec1f85315f4`, [#28](https://github.com/sislex/llm-runner/pull/28) | 528 owner tests, 20 operational and 10 package/release checks; lifecycle details are master-only and contain no prompt or user/session identifiers |

All three stacks were merged child-first with merge commits. Their resulting
`main` trees exactly match the verified source trees, and the original source
commits remain ancestors. Official artifacts retain those verified source SHAs
rather than being relabeled with the merge commits. A read-only check after
promotion still reported protected production Core 0.1.480 at `9c44cb0d211c`.
Identity and Billing `dev` were fast-forwarded to their reviewed `main` commits.
Runner's historical merge-only divergence was preserved through reviewed
main-to-dev PR #29; its resulting tree equals `main`.

Shared 0.1.43 was published from
`6357410e51dc7b2225b83280dc0e17b224648fdf`. Its SHA-256 is
`dcc38d1c194bc762c97250e7022a0c554c19d9196e3a13e0f7874f1bb8e1698a`.
It adds the optional Analytics configuration contract consumed by Core UI
1.5.26. The canonical UI 1.5.26 pack from
`418913b5a7665a8c277ab7b8a766cade445f6796` passed: 3,590 main UI tests,
46 browser tests and eight Core system tests, plus owner workspace/tooling
checks. Its SHA-256 is
`8a271cf3007501f6bb2383f796a2d7329b8c3f212e7912f0ded63db982257b35`.
The downloaded vendor archive was verified and pinned in Core. Official
source promotion/publication is complete: the version tag retains the exact
tested source, and `main`/`dev` share the reviewed tree after merge commits.

The subsequent combined Core browser gate exposed a mobile universal-search
focus regression in 1.5.26. The palette opener became inert when its sidebar
closed. UI 1.5.27 preserves the opener for Escape and moves focus outside the
closed drawer after result navigation, including same-chat navigation. Its
canonical pack from `ec82d0285866329e2af42fced75000d9d499cfe7` passed 3,591 main
UI tests, 47 browser tests and eight Core system tests against the immutable
Shared 0.1.43 Core fixture. The archive SHA-256 is
`353e1e0539ca69808758810ee64c748009197ea967fc8de5ca97b758c25e8a73`;
all 460 file hashes and its clean source provenance were verified. Core now
pins that archive. All 18 Core universal-search checks passed with their original
assertions; each viewport starts a fresh document so the restored mobile drawer
does not leak into the next case. Final combined Core validation and coordinated
stand cutover remain required after this source freeze.

At the historical Core checkpoint `a191402201fdda825fb1278b6bbb782f6344731b`, the combined
gate passed 2,231 server, 1,287 shared and 59 enabled browser checks. Native performance
passed eight scenarios and 48 budget comparisons with zero violations or runtime errors.
Installed-owner system acceptance then stopped at Playwright Reader: 28 of 29 checks passed;
the valid 8 MiB upload returned HTTP 413 because its base64/JSON envelope exceeded the SDK's
default 4 MiB limit. The shared Reader path also retained a 1 MiB parser limit. Web Reader
1.3.3 from `d9e41a3f6c0ed6ecd08e53523d41a42e60ffd666` applies the existing finite 16 MiB
command bound to both paths and authenticates shared MCP requests before buffering. Its
canonical pack passed 561 API, 25 contracts, 151 UI, 218 recorder, two runtime, 688 browser,
11 tooling/KB/artifact and 31 system checks on immutable Core `a1914022`. Real HTTP MCP
through Chromium accepted 8 MiB and rejected one additional decoded byte with the same
encoded length, preserving the selected file. Contracts 1.3.0 payload bytes are unchanged;
only archive provenance changes. Frontend 1.3.1 remains independently versioned. Official
[Web Reader 1.3.3](https://github.com/sislex/webreader/releases/tag/v1.3.3) publication and
downloaded artifact verification are complete. Final Core composition, renewed release gates
and coordinated stand acceptance remain pending; these historical checkpoints do not
establish completion of that composition.

The normal Core dependency refresh subsequently exposed a separate metadata
mismatch: Core linked component-runtime 1.0.1, while the selected Web Reader
requires newer runtime capabilities already published as 1.4.0. All eight
archived runtime `src/` files, including tests, match Core byte for byte. The
selected correction aligns Core's workspace version to 1.4.0 and replaces
Billing's exact 1.0.1 runtime peer through a reviewed owner release; Web Reader
1.3.3 stays immutable. [Billing 1.2.4](https://github.com/sislex/billing/releases/tag/v1.2.4)
is published from `db6000b7a87cfb200bf7cc697dbafafde6a60171`, with the verified
`>=1.0.1 <2.0.0` runtime peer and unchanged implementation, ledger and standalone
dependency pins. Its owner gate and ordinary consumer installation/HTTP authority
checks passed with runtime 1.4.0; the official archive and AMD64 image were
downloaded and verified. The earlier 31
Web Reader owner-system passes used a package overlay after the old Core install
and therefore do not demonstrate that the new dependency graph installs. A
strict lockfile refresh and `npm ci --strict-peer-deps` now pass for the composed
dependencies, with the lockfile unchanged by the clean installation. Renewed Core
gates and installed-owner acceptance remain required after final pins are frozen.

The installed-owner run on Core `0d04afc3febdb0fcca48f167de3f2c5adacc9a21`
passed all 29 Playwright Reader checks, including the previous upload failure.
Web Reader passed 29 of 31 checks; both failures were visual-capture waits for
future screenshot requests after the functional assertions had passed. Streaming
hosts supply frames without those requests. Web Reader 1.3.4 from
`e0ff32cee8ee80da2953bbfe71c982ecec563cd5` corrects the owner test synchronization.
Its canonical pack passed the full owner gate and all 31 system checks on that
immutable Core with visual capture enabled. Both captured PNGs were inspected:
the trusted-origin login form and manual-control status with the updated page
were visible. Runtime implementation and all 11 contract payload files are
unchanged; release versions and source provenance differ. The official
[1.3.4 release](https://github.com/sislex/webreader/releases/tag/v1.3.4) and both
vendor archives were independently verified, then applied through Core's
canonical composition command. Strict lockfile refresh and
`npm ci --strict-peer-deps` passed without further lockfile changes; all 125
runtime and 12 contracts archive files match the installed bytes. Renewed Core
acceptance and stand cutover remain pending.

Core `5732bd91666805c1a826da21cf5f476dda58e995` subsequently passed the full
gate, the 48 performance budget checks, and all 68 installed-owner system tests
with visual capture enabled. The coordinated local cutover preserved all nine
original users and prior ledgers. Its live concurrent/Stop acceptance nevertheless
failed: the four intended operations each settled once, totaling 8,154 microUSD,
but Runner also observed two unaccounted Core service calls. Their metadata and
the source audit are consistent with the default semantic KB reranker before
main-turn admission; no retained runtime callsite trace proves that attribution.
The failed journal and all receipts remain immutable. Core publication is on
hold while the public auxiliary-model boundary and UI findings are corrected;
renewed composed gates and live acceptance remain required. The protected old
production endpoint remains on Core 0.1.480 / `9c44cb0d211cf23b42de0dcb2735c06ffae8507d`.

The corrective Core source `a1015514cab3b4847e58e287eb5fa2e026211851`
disables unaccounted auxiliary model execution only under the trusted public
text-only policy. Lexical KB search and stored summary reads remain available;
ordinary deployments keep their existing behavior. Its required quick gate
passed 525 related tests with ten existing skips, followed by all 17 focused
auxiliary-policy regressions. The public mode cannot re-enable these model paths
through request fields or explicit backend settings.

The composed candidate now pins officially published
[Core UI 1.5.28](https://github.com/sislex/sislexa-core-ui/releases/tag/v1.5.28)
from `f86cdd2db9e4e002f1fd14da36bed6fa1119eb2c`, with archive SHA-256
`c6796125a7b927e4babf008411553d2d7fad56020f319e81c23175fac8c709c8`
and Shared 0.1.43. The owner fixes absent voice settings/catalogs and deep links,
optional capability discovery retries, and the closed LLM select width.
Its canonical pack and official downloaded artifact verification passed.
Strict lockfile refresh and `npm ci --strict-peer-deps` both passed without
changing the applied lockfile; all 463 installed archive files match the
canonical bytes. Core's unchanged settings and universal-search suites passed
24 checks, with one existing skip. The auxiliary commit was then fast-forwarded
into the integration branch without changing the four reviewed UI pin files.
The new combined Core gate, release performance/system checks, candidate image,
coordinated cutover and four-operation live acceptance remain pending. Earlier
failed acceptance and publication holds remain preserved as historical evidence;
these source and consumer checks do not authorize changes to the protected
production installation.

Runner's separate synthetic concurrency check used fake CLI responses, not paid
provider requests: 32 admitted concurrent runs, peak 32, admission p95 53.97 ms,
zero duplicate executions or unexpected errors. Eight cancellation and eight
disconnect cases retained accounting through completion. Replay was denied
before and after restart; four incomplete receipts recovered as uncertain.
These results establish lifecycle behavior, not real-provider capacity or Billing
throughput. The bounded two-user live acceptance runs only after final stand
composition, with previous ledgers and the historical uncertain hold preserved.

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

## SISL-763 verification and completion plan (2026-10-23)

The task checkout started clean at Core `1b31e499` on `dev`; work continues
on `SISL-763` on MacBook. Identity PR #35 is merged, not in progress:
head `3b9e28b82342af4cd9f52745fd567b832ff6889f`, merge/main
`67435604554cb27b1442c711c63f200531aaf380`. Its merged release PR #36
contains source `b71a98ec8ee2bb7ecedc2128a8c7f3184c3ff14e`.
Core pins `sislexa-identity-1.5.2-d3e0e16d58cd.tgz`; the installed
`release-source.json` identifies that same `b71a98e` source. The archive
suffix is not a Git revision. Installed and owner-main `users/auth.ts`
are identical. Do not reimplement the closure fix or create another fix branch.

Evidence and remaining work:

1. **Preserved historical acceptance:** the October 19 owner gate and two-user
   Mailpit signup/reset/session-revocation acceptance above remain historical
   evidence. The PR body names `/private/tmp/sislexa-public-chat-identity-gate.log`;
   that file was not found on this task's MacBook. The PR has no status checks.
   The October 20 review records 502 unit tests, 2 browser tests, smoke and
   3 package checks, with 5 PostgreSQL skips; it names `b71a98e` but its
   review commit metadata names `bd5dcc9`. Retain this provenance distinction.
2. **Source behavior verified:** closed signup rejects verification before token
   redemption; signup fields require strings. Existing owner tests assert no
   cookie/user on closure, reopening, one-use verification/reset, personal
   tenant creation and old-session revocation followed by new-password login.
   The SISL-763 owner test change adds successful resend rotation, expired
   verification/reset, neutral reset responses, and closed signup/resend.
3. **Development validation:** run the bounded Identity server task gate from
   merge `6743560`, then Core `npm run gate:fast` before committing.
   Identity's `gate:fast` aliases the full gate, so use its bounded
   `gate:task -- --base 6743560` during development as required by this task.
   Core `gate:fast` passed with documentation-only selection. The first Identity
   task gate passed typechecking but had 28 five-second test timeouts (153 passed,
   2 skipped); a worker-limited repeat exceeded the MCP 300-second timeout and
   is not counted as a pass. A separate single-worker signup/mailer run passed
   all 14 tests, including all four added scenarios, without changing timeouts.
   Final server workspace validation passed with explicit CLI worker limits:
   `npx vitest run --maxWorkers=1 --minWorkers=1 --reporter=dot` from
   Identity `apps/server`: 25 files passed, 2 skipped; 181 tests passed,
   2 skipped, 167.09 seconds. Together with the successful server typecheck,
   this covers the changed workspace; it does not claim a fresh full owner gate.
   No test timeouts or assertions were relaxed.
4. **Remaining stand evidence:** repeat the added resend/expiry cases against
   a local mailbox on the selected immutable stand composition and save sanitized
   results with exact Identity/Core source and image IDs. In-memory mailbox
   regression tests do not establish real SMTP delivery, and the historical
   summary does not explicitly establish these added stand cases. Resolve the
   stand endpoint/configuration and retained operator evidence before that run.
5. **Promotion dependency:** review the new tests, run the full owner/release
   gates in the later workflow and retain PostgreSQL skips as limitations.
   Public commissioning still requires configured outbound email and canonical
   `sislexa.by` verification/reset links. Deployment, production configuration
   replacement and public signup opening require separate owner confirmation.

No production configuration, deployed service, historical user data, spending
ledger or test-environment restriction is changed by this preparation. MacBook
validation is not physical-M1 evidence. No new paid-provider requests are needed
for these tests.

## Work and acceptance order

| Work item | Required evidence | Status at audit |
| --- | --- | --- |
| Stand composition | Chat-only application manifest, voice off, Caddy and PostgreSQL healthy; prior data preserved | Candidate deployed; 9 existing users and blank stand passwords preserved; management metadata reconciliation pending |
| Registration and recovery | New ordinary account, one-use verification/reset links, closed signup rejects existing links, no account enumeration | Owner gate and two-user stand acceptance passed with Mailpit; live mail pending |
| Model selection | Exactly Luna/Terra/Sol visible and enforced at execution; a real answer from each | All three real Core/Runner/Billing responses and saved history passed; exact three-model browser catalog confirmed |
| Daily quota | Below-limit admission, final overage, next request blocked, midnight reset, no parallel/tenant/restart bypass | Owner gate and real stand overage/rejection/restart checks passed |
| Chat lifecycle | First answer, streaming, cancel, retry, reload and history; network interruption does not double-charge | Reconnect, background Stop with measured settlement, blocked concurrent admission and subsequent turn passed; default-machine fix deployed; protocol/accounting and final ordinary-user browser acceptance passed |
| Public UI | Chat navigation only, visible spending/reset and clear quota errors, desktop/mobile acceptance | Desktop quota/reset/overage explanation, first selected model, absent voice onboarding and mobile three-model menu passed; presentation follow-ups remain |
| User isolation | Two synthetic users cannot access each other's chats, files or sessions; CLI exposes no host tools | Owner sandbox probes and two-user stand API/file/symlink/session checks passed |
| Release operations | Clean immutable owner pins, full gates, restore drill, health/metrics and rollback evidence | Final owner/Core composition gates and 156-table restore drill passed; Core machine-policy fix passed review and quick gate; official release pending |
| Public commissioning | Domain/TLS, real mail delivery, verification/recovery links use the canonical domain | Awaiting public-site setup |

Kanban epic: `de61c6e3-d53e-4a3c-be93-458164edb646`; its nine child tasks carry
individual acceptance criteria. A task is not Done merely because a unit gate
passed; deployment and required stand evidence remain part of acceptance.

## Promotion and rollback

1. Finish owner changes and review their PRs. Publish clean immutable artifacts;
   update Core pins through the reviewed publication sequence above, without
   invoking the existing production release target.
2. Back up the stand configuration and PostgreSQL data, record current images
   and dev overrides. Update only this stand through managed operations.
3. Configure the local mailbox, managed Identity/Billing, model allowlist,
   tool-free execution and daily threshold. Verify no accidental production
   credentials or public mail recipients enter synthetic fixtures.
4. Run acceptance with two new synthetic accounts. Save sanitized evidence and
   machine-readable results in the operator state directory. Delete only the
   test fixtures created for this run when cleanup is needed.
5. Run release gates and a restore drill. On the separate public target,
   commission domain/TLS and real email,
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

The initial stand acceptance used Core `3b7a10082838a31207c97572418f130d7789ea77`,
Identity `bd5dcc9`, Billing `cf8df21` and Runner `e3acfdd`. Core was subsequently
updated to `22efc2c227279ec999e096ed53237acfa479b118` for final UI and background-Stop
acceptance, preserving both settled spending and the unresolved legacy hold.
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

The baseline voice onboarding popup appeared with both voice services absent.
The fix adds explicit configured-module information in the Core contract and an
owner UI visibility check. Live Chrome acceptance on the pinned final artifact
confirmed both the automatic popup and manual first-run launcher absent, while
the fresh account remained `onboarded: false`.
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
acceptance passed on Core `22efc2c2`: Stop acknowledged immediately, the executor
continued in the background, one measured $0.003095 settlement completed, no late
output or history change appeared, and the next request succeeded only after
settlement. A blocked request created no reservation. The previous uncertain
test hold and earlier settled costs remained intact. Reconnect checks also passed
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
this was a layout defect, not evidence of a missing model. Live acceptance on
the final artifact confirmed a visible trigger and readable Luna/Terra/Sol rows
at the same 360-by-800 viewport. The owner
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
0.1.42 compatibility metadata were verified before the gate. Live Chrome
acceptance then confirmed default Luna, selection of Terra before the first
message, an actual Terra response in 4.2 seconds, saved history and a measured
$0.017064 charge. This browser journey created an empty conversation before
selection; the unsaved-draft path is covered by the owner regression suite.

The ordinary non-admin journey exposed an additional Core defect: a missing
execution machine emitted `claude.error` before a successful `claude.start`,
incorrectly clearing UI streaming state. The server-authoritative text-only
policy now skips machine resolution and Git/remote preflight while keeping
commands disabled. Other modes and Billing/model admission retain their checks.
Commit `20d27f61b3b134167f58d2a9684e0d7f7c267979` passed independent review,
typecheck/build, 565 related tests and 8 focused regressions. An unrelated voice
shutdown timeout passed its isolated rerun and the complete repeated quick gate
without code changes.

The final stand image is Core `20d27f61b3b134167f58d2a9684e0d7f7c267979`
(`sha256:f0668a269b06b73801bcbac70e00662ce7f94520209d7320d1de7674cd873f63`).
A fresh 514,137,595-byte PostgreSQL dump, Core data and a consistent Billing
snapshot preceded a Core-only restart. Health and exact prior ledger rows were
verified after cutover; all nine original users and blank stand passwords remain
unchanged.

A non-admin account then created two conversations without any settings patch:
machine, workdir, project and model overrides remained null. Actual start and
active snapshots selected Luna with a null target, and no machine error appeared.
Stop produced one measured $0.003076 settlement; concurrent admission was denied
without another reservation, and a subsequent request completed for $0.001528.
There was no late stopped output or saved-history change. A separate read-only
completion audit verified both unique settlements, unchanged earlier C/B ledger
rows and inherited settings. The original acceptance script's last immediate
assertion saw the global Runner count at one after settlement; its failed journal
is retained alongside the successful completion audit, which observed Runner
idle. The transient global count remains unexplained: the deployed Runner's
aggregate does not retain member IDs and access logging was off. Historical
metadata contains exactly the two expected receipts and Codex sessions; an
additional paid request is not established. Preserve this diagnostic follow-up
for release/load validation instead of rewriting the failed journal or masking
it with a wait.

Final native Chrome acceptance created another ordinary-user conversation with
all overrides still null. The UI retained its pending state and Stop control,
then displayed the Luna answer in 3.8 seconds without the machine warning.
Exactly one integer Billing settlement of $0.001434 was recorded. The response
still includes fallback notices about legacy inherited provider/model defaults;
these are tracked with the other presentation follow-ups below.


## Observed UI polish before public commissioning

The stand still exposes legacy ChatAI / voice-chat branding, account plan rows
for modules outside the enabled chat composition, and an unconfigured analytics
section that polls a 503 endpoint. The answer-level TTS control is still visible
without a configured voice service; first default answers expose legacy model
fallback notices even though the selector already displays Luna; a conversation
without a workdir polls a
404 storage endpoint, and the hidden mobile sidebar retains keyboard focus.
These are observed presentation/integration
follow-ups, not evidence that those product apps are enabled. Record their
resolution or an explicit launch disposition before calling the public UI fully
polished; do not conflate successful chat acceptance with completion of every
account screen.
