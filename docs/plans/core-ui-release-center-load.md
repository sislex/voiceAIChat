# Core UI: Release Center waits forever for project details

Run `core-ui-release-center-load-v1`. Follow-up of `docs/plans/core-ui-projects-load.md` (fixed in
sislex/sislexa-core-ui PR #30, Core UI 1.4.12, production Core 0.1.368).

Production symptom (2026-10-03, Core 0.1.368): after a reload of `#/projects/<id>/releases` the
sidebar and the project title appear at once, but the Releases tab keeps the four 64 px skeleton
blocks for at least 48 s; the Release Center chunk and `/api/projects/:id/releases` are never
requested. Timeline: `/api/session/me` at 320 and 455 ms, `/api/projects/<id>` at 463 ms answers
200 in 347 ms, `/api/projects` at 463 and 635 ms, `/api/settings` at 464 and 970 ms, board reads at
1625 ms; no later project-detail request.

`packages/ui/src/modules/shell/App.tsx` renders `ReleaseCenter` only when
`projects.projectDetail?.id === routeProjectId`, otherwise a skeleton with no timeout or error.
In `packages/ui/src/store/domains/projectsStore.ts`, `loadProjectDetail()` and `loadBoard()` return
without setting state when `boardGeneration` or `activeProjectId` changed while `projects:get` was in
flight, and a superseded read (`isObsoleteRead`) is treated like any other failure; nothing loads
the detail again. The second session check resets the user domains during startup (see the earlier
plan), so the same race as for the project list is the likely cause. Confirm it with a test first.

| B01 | core-ui | — | Fix the Release Center (and the settings and code tabs) never leaving the skeleton after app start (docs/plans/core-ui-release-center-load.md in sislex/voiceAIChat): reproduce in a store/runtime DOM test where the session check runs twice and the user domains are reset while the first projects:get of the routed project is in flight, then make the project detail always end loaded for the routed project or with a visible error: a superseded or obsolete projects:get is retried once for the current route, a detail load dropped by a generation change is restarted for the still-routed project, and App.tsx shows the existing ErrorState with retry instead of an endless skeleton when the detail fails; no duplicate project-detail requests on a normal start; keep the protection against stale data after logout, user switch or navigation to another project; regression tests for these cases; pass npm run gate |
