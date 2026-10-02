# Core UI: project list and Release Center hang after load

Run `core-ui-projects-load-v1`. Production symptom (2026-10-02, Core 0.1.361 with Core UI 1.4.10):
opening `#/projects/<id>/releases` shows the shell with «Пока нет проектов — создайте первый» in
the sidebar, the title «Проект» and four skeleton rows for minutes; the Release Center chunk and
`/api/projects/:id/releases` are never requested. Measured in the browser: `/api/session/me` is
requested twice (460 ms and 675 ms), `/api/projects` once at 679 ms and answers 200 with 7.9 kB of
projects, `/api/settings` three times (679, 809, 1041 ms); no further `/api/projects` request in
the next 120 s, and the API itself answers in 80–160 ms. A manual page reload does not help.

Likely cause in `packages/ui/src/store/domains/projectsStore.ts`: `refreshProjects()` drops a
result whose epoch changed while the request was in flight (`if (epoch !== projectsEpoch) return
[]`) and deduplicates concurrent callers onto that flight, while `reset()` (from
`clearUserDomains()` in `packages/ui/src/runtime/appRuntime.ts`) increments the epoch and clears
the flight. When the second session check or a repeated bootstrap resets the domain during the
first `projects:list`, every caller receives `[]`, `projectsLoaded` stays false and nothing
retries. Confirm the actual sequence with a test before fixing; the cause may be a different
reset/dispose path.

| B01 | core-ui | — | Fix the project list never loading after app start (docs/plans/core-ui-projects-load.md in sislex/voiceAIChat): reproduce in a store/runtime DOM test where the session check runs twice and the domains are reset while the first projects:list is in flight, then make the store recover so that a superseded refreshProjects never leaves projects unloaded (a caller joining a superseded flight gets a fresh request; the latest bootstrap always ends with projectsLoaded true or a visible projectsError), without extra duplicate /api/projects requests on a normal start; also make the project page and Release Center route not wait forever on an unloaded list (show the existing error/retry state). Keep the existing epoch protection against stale data after logout or user switch, add regression tests for both, and pass npm run gate |
