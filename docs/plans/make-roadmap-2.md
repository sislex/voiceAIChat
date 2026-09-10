# Make — roadmap 2 (after the first 40 items)

Statuses: ✅ completed · ⏸ waiting for an external resource · ✗ skipped with a reason.
Default limits: publication password forms allow 10 attempts per 10 minutes per IP and token; background cleanup removes snapshots older than 30 days while retaining publication-pinned snapshots.

| # | Item | Status |
|---|------|--------|
| 1 | Automatic checks after assistant edits: compileDiagnostics and check results in make_write_file responses | ✅ |
| 2 | Restore this response's edits from its pre-edit snapshot | ✅ |
| 3 | Publication password form rate limit | ✅ 10 attempts per 10 minutes per IP and token → 429 |
| 4 | Start drag gestures only after the movement threshold, preserving real tree-row clicks in Playwright | ✅ capture the pointer when the gesture starts; E2E uses real clicks again |
| 5 | Padded ui-kit Dialog body instead of .make-dialog | ✅ `padded` prop and `.vc-dialog-body` |
| 6 | Fix desktop typecheck's Settings fixture | ✅ spread `DEFAULT_SETTINGS` into the fixture and include vite-worker.d.ts in desktop |
| 7 | Synchronize comments between tabs through make.changed and the hub | ✅ make.changed with the `.comments.json` pseudo-path |
| 8 | Visual before/after turn diff in chat using preview screenshots | ✅ latest-response changes strip, comparison dialog, and chat attachment |
| 9 | Add design tokens and open comments to prompt context | ✅ `MakeWorkspaces.promptContext` supplies the Make project context block |
| 10 | Show assistant file writes in the editor | ✅ Code mode opens each newly written file and highlights its tab; byte streaming is unavailable because MCP writes entire files |
| 11 | Publication history with rollback | ✅ `MakePublication.history`, up to 30 entries, and restore action |
| 12 | Persistent mock API: POST/PUT/DELETE write mock/*.json | ✅ `{"$collection":true,"$body":[…]}` supports CRUD by ID in previews; publications remain read-only |
| 13 | Import a component design kit with tokens | ✅ save components, stories, and tokens together; insertion merges tokens without overwriting existing values |
| 14 | Presence and file locking when another tab is editing | ✅ make:presence heartbeats, make.presence WS events, tab-count chip, and read-only mode when another tab has unsaved changes |
| 15 | Per-user quota and admin warning | ✅ `MAKE_LIMITS.maxUserBytes` is 512 MB, checked on writes/imports; dashboard warning at ≥80% |
| 16 | Background cleanup of old snapshots and story PNGs | ✅ `MakeWorkspaces.sweep` at startup and every six hours; retain pinned and newest snapshots |
| 17 | Make metrics in health or a dedicated endpoint | ✅ `GET /api/admin/make/metrics`, Prometheus text with admin Bearer authentication |
| 18 | GitHub push export | ⏸ requires a user GitHub PAT and Git in the server image |
| 19 | Figma import | ⏸ requires a Figma personal access token and file key |
