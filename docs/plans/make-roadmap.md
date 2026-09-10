# Make — 40-improvement roadmap (autonomous run)

Implementation order: 19 → 22 → 8 → 3 → 14 → 10 → 26 → 37, then the remaining items numerically.
Each item: shared contract → code and tests → gate → Chrome verification on :8799 → KB → commit → push.
Release/deploy in batches of five. Items requiring external resources are marked ⏸ with a reason.
This is a historical progress record; current application boundaries and release commands are documented in the package instructions and KB.

| # | Item | Status |
|---|------|--------|
| 19 | Automatic pre-edit snapshot note containing the request | ✅ |
| 22 | Iterative console-error fixes after make.changed | ✅ |
| 8 | Inspector style editing with persistence to CSS | ✅ |
| 3 | React types in Monaco through extraLibs | ✅ |
| 14 | Controls for arrays, objects, colors, and ranges | ✅ |
| 10 | Attach preview screenshots to chat | ✅ |
| 26 | Publish a specific snapshot | ✅ |
| 37 | Make Playwright E2E | ✅ outside CI: `npm run e2e:make` |
| 1 | Project-wide search and replace | ✅ |
| 2 | Monaco models for all files, including go-to-definition | ✅ |
| 4 | Prettier formatting | ✅ |
| 5 | Tree drag-and-drop, folders, and multiselect | ✅ drag-and-drop; multiselect omitted at this stage because no workflow required it |
| 6 | Cmd+I inline command to fix a selection | ✅ |
| 7 | Local edit history | ✅ |
| 9 | Preview network requests | ✅ |
| 11 | Preserve preview scroll position and route | ✅ |
| 12 | Preview theme and locale | ✅ |
| 13 | axe checks inside previews | ✅ |
| 15 | Share stories and the gallery | ✅ |
| 16 | Visual story snapshots | ✅ client PNGs through html2canvas and comparison; server Playwright ⏸ because the image lacks browsers |
| 17 | Component library across projects | ✅ |
| 18 | Story play tests | ✅ |
| 20 | Plan before editing by default for large requests | ✅ |
| 21 | Include the open file and cursor context in prompts | ✅ `meta.editorContext` and `withEditorContext` |
| 23 | Project design system in tokens.css | ✅ token dialog, `@shared/makeTokens`, and model guidance |
| 24 | Per-project cost | ✅ header chip using `summarizeConversationUsage` |
| 25 | Publications with subdomain, password, and view count | ✅ `/s/<slug>/`, password cookie, and counter; subdomain ⏸ requires wildcard DNS |
| 27 | Git export/import | ✅ GitHub repository URL import via branch ZIP, including subdirectories; ZIP/Vite export; Git push ⏸ requires a user token and Git in the image |
| 28 | Figma import | ⏸ requires a Figma personal access token and file key; meanwhile, upload Copy as SVG output as an asset |
| 29 | Mock API inside a project | ✅ `mock/<path>[.METHOD].json` with `$status/$delay/$headers/$body` envelopes |
| 30 | Quotas and cleanup | ✅ 64 MB quota (`quota` → 413), `GET usage`, `POST cleanup`, and storage dialog |
| 31 | Collaboration through Yjs | ⏸ requires a y-websocket server and shared-conversation access model; existing support includes make.changed updates and read-only sharing from item 33 |
| 32 | Comments on preview elements | ✅ `.comments.json`, comment panel, preview markers, and fix-all action |
| 33 | Read-only project sharing inside ChatAI | ✅ share token, `#/make-shared/<token>`, and `MakeSharedView` |
| 34 | Mobile editor fallback | ✅ textarea editor and file dropdown at widths ≤600px |
| 35 | PWA in Vite exports | ✅ `?pwa=1`: manifest, sw.js, icon.svg, and index.html injection for static and Vite exports |
| 36 | Electron desktop | ✅ shared UI through `installRemoteBridges`, including all `make:*` bridges; no separate implementation needed. At this stage, desktop typecheck failed on an unrelated Settings fixture in database.test.ts |
| 38 | Admin usage metrics | ✅ `GET /api/admin/make/stats` and Make projects dashboard section |
| 39 | Import rate limits | ✅ `SlidingWindowLimiter`: 10 ZIPs or 20 URLs per 10 minutes, returning 429 |
| 40 | Remove duplicate useConfirm/Dialog implementations | ✅ `components/ui/*` removed in favor of `@voicechat/ui-kit`; SidebarToggle retained |
| — | Make styling, typography, spacing, and mobile layout review | ✅ overflow menu, dialog spacing/fonts, mobile header at ≤720px, and mobile token/comment panels |
