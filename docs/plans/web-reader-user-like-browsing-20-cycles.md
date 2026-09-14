# Web Reader: 20 cycles of user-like browsing for the model and desktop/phone UI

Branch: `claude/web-reader-20-cycles` from `origin/main` (`68124e0f`), worktree
`voiceAIChat3`. Started 2026-09-14. Request: open the local Web Reader in a
browser, propose ten improvements that let the model in chat and in the kanban
use the browser as close to the user as possible, ten UI improvements for desktop
and phone, implement them, verify only this module, repeat twenty cycles.
A parallel Codex series (`codex/web-reader-20-cycles`, `docs/plans/web-reader-20-cycles.md`)
runs in `voiceAIChat1`; this plan does not repeat its items.

## Stand and gate

- Local stand: `npm run dev:web` of this checkout (API 8814, client 5303,
  recorder 5304, data `~/.voicechat-server3`), opened at `http://localhost:5303/#/web-reader`.
  `localhost` rather than `127.0.0.1`: cookies are shared per host across ports,
  and the production gateway of the neighbour checkout lives on `127.0.0.1:8802`.
- The dev stack must be started without the nested Claude Code variables
  (`CLAUDECODE`, `CLAUDE_CODE_*`) and, for live model turns, with
  `VC_CODEX_SHARED_AUTH=true`: the runner seeds per-user CLI profiles that are
  not logged in, so the first turn answered "Not logged in · Please run /login".
- Module gate per cycle: typecheck of touched packages, `vitest run` of
  `@voicechat/shared`, `@voicechat/web-reader`, `@voicechat/web-recorder`,
  `@voicechat/web-reader-app`, `@voicechat/browser-runner` (when the runner
  changes) and the touched `packages/ui` test files. Then a Chrome check of the
  panel at desktop and 390px width. One commit per cycle.

## Cycle 01 — actions named the way a person names them; the panel shows the model working

Model (proxy engine, MCP `browser`):

| # | Improvement | Where | Check |
|---|---|---|---|
| 01 | `click`/`press`/`type submit` report `navigated` and the new `page` once it is ready, instead of a stale DOM | `apps/web-recorder/src/Recorder.tsx` navigation watch | Recorder DOM tests |
| 02 | `open` returns the page `title`; `page-status ready` carries `title` | `hostBridge.ts`, `webRecorder.ts` | bridge test |
| 03 | `type {field}` targets a field by label, aria-label, placeholder, name or id; exact match beats partial; ambiguity lists candidates | `previewInteractions.ts`, runner `getByLabel/getByPlaceholder` | script tests |
| 04 | `find {role}` filters by accessible role, alone or with text; runner uses `getByRole` | `previewProxy.ts` byRole | script tests |
| 05 | every described element has `onScreen` — visible without scrolling | `describe()` | script test |
| 06 | `scroll {to: 'element', selector}` shows the element to the user | script + runner | script test |
| 07 | `wait {state: hidden/detached/attached}` works in the panel (spinner gone) — no longer Chromium-only | `browserWaiting.ts`, script | shared + script + MCP tests |
| 08 | `press {repeat}` repeats a key (ArrowDown ×3) in one action | script + runner | script test |
| 09 | `type {append}` continues the current value; result carries the final `value` (empty for secret fields) | script + runner | script tests |
| 10 | The system hint tells the model the user watches the panel: act like a person, verify after each step, narrate; documents the new parameters | `previewToolHint` | shared tests |

UI (desktop and phone):

| # | Improvement | Where |
|---|---|---|
| 01 | Live status "Ассистент нажимает …" while a model action runs in the panel | `App.tsx` → `WebReaderFrame` `pendingAction` |
| 02 | Phone tabs get a dot when the model changed the site while the chat tab was open | `readerSplitControls.ts`, `App.tsx`, `app.css` |
| 03 | Page title under the address bar | Recorder |
| 04 | Thin indeterminate progress bar while the page loads (reduced-motion aware) | recorder.css |
| 05 | 44px tap targets on coarse pointers (toolbar, tools menu, recent chips) | recorder.css |
| 06 | Viewport preset select hidden on narrow panels; a reset chip shows the active width | Recorder + css |
| 07 | Address input selects all on focus; tools menu gains «Копировать адрес» and «Открыть в новой вкладке» | Recorder |
| 08 | Empty state offers recent addresses as chips (per browser, six entries, no credentials or fragments) | `recentAddresses.ts` |
| 09 | Alt+←/→ navigate page history from anywhere in the panel | Recorder |
| 10 | Split divider works from the keyboard (arrows, Home/End, Enter resets), announces its value; double-click resets | `App.tsx`, `app.css` |

Evidence: see the log entry `docs/kb/log/2026-09-14-*-web-reader-user-like-cycle-01.md`.
Commit `1879f373`. Live check: the model (Codex, `VC_CODEX_SHARED_AUTH=true`) read example.com,
clicked «Learn more», the panel navigated to IANA, the action feed listed three steps.

## Cycle 02 — the model sees what the user sees; the phone knows what the model does

Model (proxy engine, MCP `browser`):

| # | Improvement | Where | Check |
|---|---|---|---|
| 01 | `open` accepts a relative path (`/about`, `?page=2`, `#/route`): the bridge resolves it from the open page, Chromium from session status | `previewActions.ts`, `hostBridge.ts`, `previewMcp.ts` | shared + bridge tests |
| 02 | `read {visible: true}` returns only what is on the user's screen plus `viewport` | script | script test |
| 03 | `back`/`forward` wait for the new page and answer with `navigated` and its `page` | Recorder | Recorder test |
| 04 | elements carry `placeholder` and current `value` (hidden for secret fields) | `describe()` | script test |
| 05 | `click` reports `dialogs` that appeared, the new `focus` and synchronous `newErrors` | script | script test |
| 06 | `hover` returns the `tooltip` a person would see (title, aria-describedby, role=tooltip) | script | script test |
| 07 | acted elements flash a blue outline for 0.9 s — the user sees where the model clicked or typed | script `flash()` | script test |
| 08 | relay and host errors tell the model what to ask the user (open `#/web-reader/<id>`, switch to the chat) | `web-reader-contracts/actions.ts`, `webReaderModelRequest.ts` | contract + App tests |
| 09 | MCP `open` description and schema explain relative paths; `read` schema gains `visible` | `previewMcp.ts` | MCP tests |
| 10 | hint: `visible: true`, relative paths, reacting to `dialogs`/`focus`/`newErrors`, what to do when the panel is not connected (kanban turns) | `previewToolHint` | shared test |

UI (desktop and phone):

| # | Improvement | Where |
|---|---|---|
| 01 | Live line «Ассистент нажимает …» in the phone tab bar while the chat tab hides the panel | `App.tsx`, `app.css` |
| 02 | «Сайт» tab shows the page title («Сайт · Example Domain») | bridge `onPageTitle` → `App` |
| 03 | «Чат» tab gets a dot when a reply lands while the site tab is open | `App.tsx` reply effect |
| 04 | Action history collapsed by default on narrow screens | `ReaderActionHistory` |
| 05 | Action history shows the time of each step | `ReaderActionHistory`, `App` items `at` |
| 06 | Empty state hints that the assistant can open a page from the chat | Recorder |
| 07 | Address input uses `enterKeyHint="go"` and `autoComplete="url"` for phone keyboards | Recorder |
| 08 | Divider highlights while dragging | `App.tsx`, `app.css` |
| 09 | 44 px tab buttons in the phone tab bar | `app.css` |
| 10 | Flash outline on the page element the model acts on (shared with model item 07) | script |

Evidence: `docs/kb/log/2026-09-15-*-web-reader-user-like-cycle-02.md`.
