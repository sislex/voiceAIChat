# CHAT-473 production renderer measurements

## Result

The same returning-admin chat, containing a fixed Markdown/code message, reaches a visible composer before the five-second observation window ends. Account and Settings are separate direct-entry and navigation scenarios. No optional-surface intent is triggered during startup.

| Client / asset | Before raw | After raw | Before gzip | After gzip | Before Brotli | After Brotli |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Web JS | 5,031,595 | 1,209,801 | 1,349,629 | 363,241 | 1,060,012 | 296,037 |
| Web CSS | 496,739 | 377,447 | 85,126 | 65,547 | 69,486 | 52,770 |
| Electron JS | 3,313,613 | 1,194,933 | 710,004 | 358,523 | 537,731 | 292,366 |
| Electron CSS | 620,585 | 375,620 | 135,284 | 65,226 | 91,107 | 52,554 |

All sizes are bytes. Initial JS gzip falls **73.09% for Web and 49.50% for Electron**. Cold and repeated launches have identical unique resource costs; their transport waterfalls differ. Electron gzip/Brotli are comparative calculations, not file-transport byte counts.

- [Before: metrics, waterfall and complete chunk graph](before.html)
- [After: metrics, waterfall and complete chunk graph](after.html)
- [Machine before](before.json), [machine after](after.json), [per-route metric diff](diff.json)
- [Strict route budgets](../../route-budgets.json)
- Ready screenshots: [Web before](screenshots/web-before.png), [Web after](screenshots/web-after.png), [Electron before](screenshots/electron-before.png), [Electron after](screenshots/electron-after.png)
- Controlled component QA: [mobile dark recovery](screenshots/recovery-mobile-dark.png), [desktop light ready](screenshots/ready-desktop-light.png)

## Provenance and reproduction

Baseline artifacts were built from pristine commit `18dea635707b4bb39080096818495516a91e3664` before changing application code, then retained under `artifacts/bundle/CHAT-473/{web,electron}-before`. Candidate artifacts come from this commit's application changes. Report `commit` identifies the checked-out parent; `dirty` describes the measurement worktree, including the new harness, not whether the retained baseline was rebuilt. Every resource has its own SHA-256 and graph edges. The containing commit identifies the candidate source changes without a self-referential artifact hash.

Use the locked root and standalone desktop dependencies, the Playwright Chromium version and Electron version recorded in `tools`, and Node/compression versions recorded in `conditions`. Build both revisions separately with `npm run -w @voicechat/web build` and `npm --prefix apps/desktop run build`. Keep both output directories. On Linux install the normal Chromium/Electron system dependencies and Xvfb, then run the **candidate harness** against each pair:

```sh
xvfb-run -a node scripts/measure-routes.mjs BASE_WEB_DIST BASE_ELECTRON_DIST artifacts/bundle/before
xvfb-run -a node scripts/measure-routes.mjs apps/web/dist apps/desktop/out/renderer artifacts/bundle/after
node scripts/route-budgets.mjs frontend-quality/route-budgets.json artifacts/bundle/after/report.json
node scripts/route-budgets.mjs --compare artifacts/bundle/before/report.json artifacts/bundle/after/report.json
```

The harness starts an isolated real server with temporary synthetic data, then Chromium and a real Electron BrowserWindow using the production renderer. It never invokes an LLM or uses production credentials/data. The Electron fixture exposes the existing remote-client startup contract; it is not a packaged-desktop-main smoke test. File-origin login is performed through the UI on every navigation because the loopback HTTP cookie is cross-site. Conditions remain identical before/after. The requested 1440×900 size is the Web viewport and the Electron outer window; measured content viewports are recorded separately under `conditions.actualViewports` (Web 1440×900, Electron 1440×873, device scale factor 1). Comparison rejects any change to the recorded conditions.

Cold runs clear browser cache; warm runs reload the same context. Resources are collected through CDP, including HTTP 304 revalidation, automatic preload, dynamic requests and the actual Google font stylesheet. Initial is the unique observed JS/CSS set plus its complete static dependency closure. An unobserved dependency fails validation. Resource costs use gzip level 9 and Brotli quality 11. External font binaries are outside the JS/CSS metric. Waterfall transfer bytes include protocol overhead; they are not substituted for the deterministic compression calculations. Network and CPU are unthrottled. The complete graph also retains unused chunks and dynamic edges.

CI uses fresh inventories. `VC_MEASURE_REUSE_INVENTORY=1` is only a local optimization when repeating measurement against unchanged saved build artifacts. It must never accompany a rebuild.

## Attribution and tradeoffs

- The Web entry previously imported Vite's preload helper from the Monaco chunk, making Monaco mandatory even without opening the editor. Assigning the preload/CommonJS helpers to the React runtime removes that static edge in both clients.
- The statically imported console-session reader pulled terminal resources into startup. Its existing active-surface condition now controls module loading.
- Settings metadata lives in a lightweight contract. Settings, Git, machine tools, optional windows and observer screens retain dynamic boundaries without mixed runtime imports.
- The Desktop renderer now uses esbuild minification. Its original production renderer was not minified; the report intentionally preserves that real baseline rather than silently rebuilding it with candidate settings.
- Markdown/highlighting remains mandatory for the populated starting chat. It is included in every startup total. Independently built application panels and their manifest/integrity contracts remain separate.
- Budgets allow less than one percent headroom on the measured totals and explicitly forbid unrelated heavy chunks. They are fixed values, never generated upward by CI.

## Automated verification

`npm run gate:fast` completed with exit code 0, including workspace types/tests, production builds, the 16-test frontend route/contract/recovery gate, and 792 E2E tests. A final replay against the retained baseline and freshly inventoried candidate passed all 16 route measurements and the same 16-test frontend gate. Focused final UI checks passed 117 tests; the route-budget validator passed all seven regression tests. No mixed static/dynamic import warnings appeared in the production build log.

## Verification boundaries

The harness also mounts the real Monaco component through the existing host API and observes a real worker in Web and Electron. This activation is separate from initial, with results under `activations`.

The marked component/browser tests exercise loading, local errors, explicit bounded retry, retained drafts, intent deduplication, five viewports and both themes. Real HTTP 404 and failed-request tests demonstrate Chromium's cached import failure: after three local retries, the user can explicitly refresh. HTTP HTML is checked before refresh, a sessionStorage guard prevents repeated refresh, and the chat's persisted draft survives. The host vetoes refresh while attachments remain or the current chat draft is not persisted. Other unsaved editors must be saved before choosing this action; existing beforeunload guards still apply. Safe-area padding, CSS zoom and a reduced keyboard-sized viewport are explicitly emulations. They do **not** establish real mobile on-screen-keyboard behavior. These measurements likewise do not claim a completed merge, deployment, packaged Electron main-process test or production health check; those belong to the following workflow stages.
