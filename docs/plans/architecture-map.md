# Project architecture map

Plan ID: `architecture-map-v1`

Created: 2026-09-29

Baseline: Core `origin/main` at `dc80c8b8`, core-ui `origin/main` at `cf9b213`

## Start here

This plan reuses the delivery control system and handoff format of
[`shared-chat-distributed-delivery.md`](shared-chat-distributed-delivery.md)
sections 2–3 and 6. Execution profiles must declare the base SHA, allowed paths, a
dependency context with upstream artifacts, trusted `npm ci`,
`STORYBOOK_DISABLE_TELEMETRY=1` and the owner `gate`. Gates that run nested `npm`
must not run inside the macOS task boundary.

B01 (Core) and B02 (core-ui) are independent and are meant for two workers at once.
B02 codes against the snapshot contract of section 3, not against a Core build.

## 1. Outcome

A project page "Схема" next to the application release center shows, for a selected
environment:

- **Code:** repositories and the packages they publish.
- **Runtime:** Compose services, their Docker image references and digests, versions,
  commits, API versions and health.
- **Hosts:** the server that runs each service and the project machines.
- **Links:** runtime dependencies, "built from repository at commit", "runs on host",
  service-to-service calls with required scopes.
- **Drift:** every place where the declared state and the observed state differ.

The page is visible only to project owners and administrators. It never shows
environment variable values, tokens or secrets; links are shown by name only.

## 2. Sources of truth

- Static, from the Core repository: `packages/shared/src/applicationCatalog.ts`
  (owners, repositories, kinds, runtime dependencies, services, health paths),
  `docker-compose.yml` and `deploy/compose.*.yml` (services, images, ports),
  `deploy/tools.lock.json` and `vendor/owner-artifacts.json` (source commits and
  artifact hashes), `apps/server/component-contract.json` and owner contracts
  recorded in vendored artifacts (provided APIs, dependency ranges, scopes).
- Environment, from Core: the application release overview of the project environment
  (`GET /api/projects/:id/application-releases/environments/:environment`).
- Live, through the environment deploy machine: `docker compose ps` with image
  references and digests, and each service's `/v1/component` (version, commit,
  apiVersion) and readiness, the same observations the release scripts already use.
- Hosts: project machines from the machine registry with online state.

## 3. Snapshot contract

`ArchitectureSnapshot` in `@voicechat/shared` (`packages/shared/src/architecture.ts`),
with a runtime validator `parseArchitectureSnapshot`:

- `schemaVersion: 1`, `generatedAt`, `environment`, `source: { coreCommit }`,
  `complete: boolean`, `unavailable: { source, reason }[]`.
- `nodes: { id, layer: 'code'|'runtime'|'host', kind, label, attributes }[]` where
  `kind` is one of `repository`, `package`, `service`, `frontend`, `image`, `server`,
  `machine`; `attributes` holds only the fields listed per kind: repository URL,
  package name and version, service name, image reference and digest, version,
  commit, apiVersion, health (`ready`/`degraded`/`unknown` with a reason), host
  name, online.
- `edges: { id, from, to, kind, attributes }[]` where `kind` is one of `depends_on`,
  `built_from`, `publishes`, `runs_on`, `calls` (with `scopes` and required API
  range), `consumes_package`.
- `drift: { id, severity: 'error'|'warning', nodeIds, rule, message }[]` with rules
  `service_not_in_catalog`, `catalog_service_not_running`, `image_not_pinned`,
  `version_mismatch`, `dependency_api_unmet`, `health_failed`, `source_unavailable`.

A fixture `packages/shared/src/architecture.fixture.json` with every node, edge and
drift kind is published with the contract; B02 copies it verbatim.

## 4. Stages and task backlog

### S0 — Parallel foundations

| ID | Owner | Depends on | Deliverable and acceptance |
| --- | --- | --- | --- |
| B01 | Core | — | Snapshot contract, validator and fixture of section 3 in shared; `scripts/architecture.mjs` builds the static snapshot from the section 2 repository sources and writes `artifacts/architecture/static.json`; a generated Mermaid diagram in a marked block of `docs/kb/architecture.md`; a gate test fails when the diagram differs from the catalog; unit tests for every source parser and drift rule that needs no live data |
| B02 | core-ui | — | Architecture graph view on the section 3 fixture: three layers, filters by layer and kind, node details with repository link, version, image, host and health, drift list with highlighting, zoom and pan, keyboard navigation, light and dark themes at 1440 and 390 px; Storybook stories for full, partial and failed snapshots; DOM and browser tests; any new layout dependency pinned in the lockfile and justified in the result |

### S1 — Live data and page

| ID | Owner | Depends on | Deliverable and acceptance |
| --- | --- | --- | --- |
| C01 | Core | B01 | `GET /api/projects/:id/architecture?environment=` for owners and administrators: merges the static snapshot with the environment overview, live Compose, component and readiness observations through the deploy machine, and project machines; applies all drift rules; per-source timeouts produce `complete=false` with reasons instead of an error; 30 s cache; no environment values or secrets in the response; route tests for access, partial sources and every drift rule |
| C02 | core-ui | B02, C01 | "Схема" tab next to the application release center: environment selector, fetch through the renderer API, refresh, loading, partial and error states, the B02 view; access follows the release center; browser test against a mocked API; core-ui release artifact for Core |

### S2 — Integration

| ID | Owner | Depends on | Deliverable and acceptance |
| --- | --- | --- | --- |
| U01 | Core | C01, C02 | Core consumes the C02 core-ui release; e2e test opens the page on the fixture Core with a fake deploy machine and checks nodes, edges and one seeded drift of each severity; KB feature page `docs/kb/features/architecture-map.md` |

**Release and acceptance.** Release Core and core-ui. In production open the page for
the ChatAI project and the production environment. Check that every running service,
its image digest, version and host appear, and that a stopped optional service shows
as drift. The owner decides the evidence level.

## 5. Parallelism and duration

| Task | Estimate | Worker |
| --- | --- | --- |
| B01 | 1–1.5 days | worker 1 |
| B02 | 2 days | worker 2 |
| C01 | 2 days | worker 1 after B01 |
| C02 | 1 day | worker 2 after B02 and C01 |
| U01 | 0.5–1 day | either |

With two workers the plan takes about 4–5 days; one worker needs about 7 days.
