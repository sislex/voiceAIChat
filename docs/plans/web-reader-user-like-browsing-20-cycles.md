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

Evidence: `docs/kb/log/2026-09-15-*-web-reader-user-like-cycle-02.md`. Commit `a6143646`.

## Cycle 03 — telling identical controls apart; knowing the panel state

Model (proxy engine, MCP `browser`):

| # | Improvement | Where | Check |
|---|---|---|---|
| 01 | `near` on find/click/hover/type: pick the target by the text of its row, card or section («Удалить» near «Заказ №5») | script `nearFilter`, MCP schemas | script + shared tests |
| 02 | `exact: true` on find/click/hover: exact visible-text match only | script `byText` | script test |
| 03 | every element carries `context` — text of the nearest row/section/form, so the model can tell duplicates apart | `describe()` | script test |
| 04 | `status` tool: is the panel connected, what page is open, is it loaded — answered by the bridge without touching the page; Chromium answers from session status | `previewMcp.ts`, `hostBridge.ts` | MCP + bridge tests |
| 05 | `open` returns `outline` (first headings, counts of links, buttons, inputs) from the page-ready message | script `outline()`, Recorder, bridge | script + bridge tests |
| 06 | `read` lists `forms` (fields and submit button) | script | script test |
| 07 | `read` lists `landmarks` (navigation, main, banner…) | script | script test |
| 08 | `scroll` reports `atTop`/`atBottom` for lazy feeds | script | script test |
| 09 | `type {field, near}` narrows a field by its row or card | `fieldTarget` | shared test |
| 10 | hint documents near/exact/status/outline/forms/landmarks and asks to call `status` when unsure the panel is open | `previewToolHint` | shared test |

UI (desktop and phone):

| # | Improvement | Where |
|---|---|---|
| 01 | Link-to-chat indicator in the toolbar (● connected / ○ not): the person sees whether the assistant can drive the page | Recorder |
| 02 | Scheme badge in the address field (🔒 for https, «http» otherwise) | Recorder |
| 03 | Recent addresses also in the tools menu (three latest) | Recorder |
| 04 | «Показать» on history steps: scrolls to and highlights the element the model acted on | `ReaderActionHistory`, `App` |
| 05 | Load error offers «Открыть во внешней вкладке» for sites that refuse the proxy | Recorder |
| 06 | Scenario JSON import/export bar hidden until there are steps, a recording or the tools-menu toggle | Recorder |
| 07 | Screen-reader announcement «Открыта страница: …» after each load | Recorder |
| 08 | Phone header wraps: the engine select takes its own row under 480px | `app.css` |
| 09 | History search appears only when there is more than one step | `ReaderActionHistory` |
| 10 | Reveal uses the same blue flash as model actions — one visual language | script `flash()` via hover |

Evidence: `docs/kb/log/2026-09-15-*-web-reader-user-like-cycle-03.md`. Commit `f9da7180`.

## Cycle 04 — forms and menus the way a person handles them; the person can take over

Model (proxy engine, MCP `browser`):

| # | Improvement | Where | Check |
|---|---|---|---|
| 01 | `fill {fields, submit}` fills a whole form (by label or selector) and submits it in one action | script, MCP | script + shared tests |
| 02 | `fill`/`type submit` return `validation` — the field messages a person would see in red | script `validationMessages` | script test |
| 03 | `choose {text, in}` opens a trigger, waits for the item and clicks it (custom dropdowns, menus, autocomplete) | script, MCP | script test |
| 04 | `type` returns `options` — datalist/listbox suggestions that appeared after typing | script `suggestionsFor` | script test |
| 05 | `hover` returns `revealed` — clickable elements that appeared (submenu items) | script | script test |
| 06 | `read` returns `focus` — where the caret is | script | script test |
| 07 | `wait {enabled, checked, value}` works in the panel («button became active») | script, `browserWaiting.ts` | shared + script tests |
| 08 | hash-only `open` on the same document changes the fragment live instead of reloading the iframe | Recorder `sameDocument` | Recorder test |
| 09 | manual mode refuses model commands with a reason the model can relay («спроси, когда можно продолжить») | Recorder | Recorder test |
| 10 | hint documents fill/choose/options/revealed/validation and key chords like Control+a | `previewToolHint` | shared test |

UI (desktop and phone):

| # | Improvement | Where |
|---|---|---|
| 01 | «Только я управляю» in the tools menu: the person takes the page over; a status line with «Вернуть ассистенту» | Recorder |
| 02 | Collapse the chat on desktop: the site takes the whole width, handle on the divider, choice persisted | `App.tsx`, `app.css` |
| 03 | Reload button is disabled and marked busy while the page loads — no double loads from impatient taps | Recorder |
| 04 | Loading status names the host («Загружаем shop.example…») | Recorder |
| 05 | Page error banner can be dismissed; a different error reappears | `WebReaderFrame` |
| 06 | Cmd/Ctrl+Enter in the address bar opens the typed address in a real tab | Recorder |
| 07 | «Очистить недавние» in the tools menu | Recorder |
| 08 | 44 px targets for history buttons, error actions and the live line on touch screens | `panel.css` |
| 09 | Hash navigation keeps the page state — no flash of a reload for hash routers | Recorder |
| 10 | Manual-mode line uses the warning colour and lives with the other status lines | recorder.css |

Evidence: `docs/kb/log/2026-09-15-*-web-reader-user-like-cycle-04.md`. Commit `f246379f`.

## Cycle 05 — reading like a person; the person's selection becomes a question

Model (proxy engine, MCP `browser`):

| # | Improvement | Where | Check |
|---|---|---|---|
| 01 | text matching ignores quote styles, dash styles and non-breaking spaces (`normText`) | script | script test |
| 02 | `read {section}` reads the part under a heading, up to the next heading of the same or higher level | script `sectionScope` | script test |
| 03 | `read` returns `selection` — text the person selected on the page | script | script test |
| 04 | `find {onScreen: true}` — only what the person sees without scrolling | script | script test |
| 05 | `type {perKey: true}` types character by character with keyboard events (masks, autocomplete) | script `typePerKey` | script test |
| 06 | `click` reports `obscuredBy` when an overlay sits at the click point | script | script test |
| 07 | `wait {url}` works in the panel: the bridge waits for the confirmed address | `hostBridge.ts`, `browserWaiting.ts` | bridge + shared tests |
| 08 | `status` returns `history` — the last five addresses of this panel | `hostBridge.ts` | bridge test |
| 09 | `ask` message: the person's selection travels to the chat as a draft question | `webRecorder.ts`, bridge, Recorder, App | contract + bridge + Recorder tests |
| 10 | hint documents section/selection/onScreen/perKey/url waits/obscuredBy | `previewToolHint` | shared test |

UI (desktop and phone):

| # | Improvement | Where |
|---|---|---|
| 01 | Selecting text on the page shows «Спросить ассистента»; the question lands in the chat draft (phone switches to the chat tab) | Recorder, App |
| 02 | Failed model action is shown in the panel with the reason and «Повторить»; disappears after 15 s | `WebReaderFrame`, App |
| 03 | Live line shows elapsed seconds after 3 s | `WebReaderFrame` |
| 04 | Tools menu grouped: Страница / Сценарий / Недавние | Recorder |
| 05 | Arrow keys, Home and End walk the tools menu | Recorder |
| 06 | «Копировать ссылку с названием» copies a Markdown link | Recorder |
| 07 | `aria-keyshortcuts` and titles on back/forward and the address field | Recorder |
| 08 | Load error hints at «Полный браузер» for sites that refuse the proxy | Recorder |
| 09 | Link indicator turns amber in manual mode | recorder.css |
| 10 | Empty state offers «Открыть текущий проект» | Recorder |

Evidence: `docs/kb/log/2026-09-15-*-web-reader-user-like-cycle-05.md`. Commit `5b712835`.

## Cycle 06 — checking like a tester; the page identity a browser tab shows

Model (proxy engine, MCP `browser`):

| # | Improvement | Where | Check |
|---|---|---|---|
| 01 | `check {text|selector, state, value, count}` — pass/fail with `actual` and a human `summary`, never throws | script, MCP | script + shared tests |
| 02 | `nth` on find/click/hover picks the N-th match when `near` cannot separate duplicates | script `findTargets` | script test |
| 03 | `scroll {to: element, text}` scrolls to visible text, not only to a selector | script | script test |
| 04 | `errors {since}` returns only errors after a page timestamp | script | script test |
| 05 | `network {failedOnly}` works in the panel | script | script test |
| 06 | `page` carries `lang`, `description` and `icon` — how a browser tab identifies a site | script `pageInfo` | script test |
| 07 | `open` reports `redirected: true` when the final address differs | `hostBridge.ts` | bridge test |
| 08 | `status` in a kanban check reports `target.matches` — whether the model stands on the task's page | `previewMcp.ts` | — (covered by observe tests indirectly) |
| 09 | `reader.changed` carries the check `summary` and `ok` so the person sees verdicts | `protocol.ts`, relay | contracts test |
| 10 | hint documents check/nth/scroll text/errors since | `previewToolHint` | shared test |

UI (desktop and phone):

| # | Improvement | Where |
|---|---|---|
| 01 | Action feed shows ✓/✗ and the summary of each model check | `ReaderActionHistory`, App |
| 02 | Site favicon next to the page title | Recorder |
| 03 | Page title is a button that copies a Markdown link | Recorder |
| 04 | «Перенаправлено с …» notice after a redirect | Recorder |
| 05 | «Снимок страницы в чат» in the tools menu attaches the visible area to the composer | Recorder → `area-screenshot` |
| 06 | Phone live line is a button that opens the site tab | App |
| 07 | «Показать» is disabled for steps made on another page | `ReaderActionHistory` |
| 08 | «Повторить» hidden when the failure came from manual mode | `WebReaderFrame` |
| 09 | «Недавние:» caption above the chips in the empty state | Recorder |
| 10 | Feed labels for check/fill/choose/status in past and present tense | `actionLabel.ts` |

Evidence: `docs/kb/log/2026-09-15-*-web-reader-user-like-cycle-06.md`. Commit `0b7c9dad`.

## Cycle 07 — pointing at things; the feed tells a story

Model (proxy engine, MCP `browser`):

| # | Improvement | Where | Check |
|---|---|---|---|
| 01 | `show {text|selector, label}` scrolls to an element and highlights it with a caption for 3 s — the model points for the person | script `showLabel`, MCP | script test |
| 02 | `screenshot {marks: true}` numbers clickable elements on the picture and returns `marks` (n → selector) | script `captureArea` | — (canvas is unavailable in jsdom; marks list is built before capture) |
| 03 | `read {brief: true}` — a one-paragraph description of the page in words | script | script test |
| 04 | `read` without selector reads the open modal dialog and reports `dialog` | script | script test |
| 05 | `press` reports the dialogs still open (did Escape close the window) | script | script test |
| 06 | `wait {idle: true}` waits for the page network to go quiet (panel counts fetch/XHR; Chromium uses networkidle) | script, `waiting.ts`, shared | script + shared tests |
| 07 | `scroll {to: element}` returns the element it scrolled to | script | script test |
| 08 | `status.manual` tells the model the person took control | bridge `control` | bridge test |
| 09 | relay narrates results in `reader.changed` (открылось окно, перешёл на host, перенаправлено, ошибки формы) | `actions.ts` `narrate` | relay test |
| 10 | hint documents show/marks/brief/dialog/idle/manual | `previewToolHint` | shared test |

UI (desktop and phone):

| # | Improvement | Where |
|---|---|---|
| 01 | Orange highlight with a caption on the page when the model uses `show` | script |
| 02 | Feed lines narrate outcomes («Нажал Купить — открылось окно») | relay summary → history |
| 03 | «Показать» in the feed uses the same highlight with «Здесь действовал ассистент» | App |
| 04 | Phone tab bar shows «✋ Страницей управляете вы» while manual mode is on | App, bridge `onControl` |
| 05 | Paste-and-go: pasting a full address into the empty field opens it | Recorder |
| 06 | «Поделиться…» via the Web Share API on devices that support it | Recorder |
| 07 | Iframe background follows the panel theme instead of flashing white | recorder.css |
| 08 | «Открыть» button hidden under 360 px (Enter and «go» key still work) | recorder.css |
| 09 | Manual mode toggles announce `control` to the host | Recorder |
| 10 | Action failure line is announced to screen readers | `WebReaderFrame` |

Evidence: `docs/kb/log/2026-09-15-*-web-reader-user-like-cycle-07.md`. Commit `41f14e0e`.
Live: Codex answered a «read brief + show» request; the phone «Сайт» tab showed the attention dot during the turn.

## Cycle 08 — forgiving search and forms; the feed and tab behave like a browser

Model (proxy engine, MCP `browser`):

| # | Improvement | Where | Check |
|---|---|---|---|
| 01 | `find` with no match returns `suggestions` — similar texts on the page | script `suggestTexts` | script test |
| 02 | ambiguity errors list candidates with their context and advise `near`/`nth` | `previewInteractions.ts` | script test |
| 03 | `fill` fills what it finds and lists `missing` instead of aborting | script | script test |
| 04 | `open {waitFor}` waits for a text after load in one action; `waited` in the result | `hostBridge.ts` | bridge test |
| 05 | `errors` collapses repeats with `count` | script | script test |
| 06 | `read` lists `options` of select controls | script | script test |
| 07 | `role` accepts Russian words (кнопка, ссылка, поле, заголовок…) | script `ROLE_WORDS` | script test |
| 08 | clicking a `<select>` explains to use `set`/`choose` | script | script test |
| 09 | `status.viewport` — the size of the user's page area (from page-ready) | script, Recorder, bridge | Recorder + bridge tests |
| 10 | hint documents suggestions/missing/waitFor/options/count/Russian roles/viewport | `previewToolHint` | shared test |

UI (desktop and phone):

| # | Improvement | Where |
|---|---|---|
| 01 | Feed filter «Только ✗ (N)» when checks failed | `ReaderActionHistory` |
| 02 | Feed auto-scrolls to the newest step | `ReaderActionHistory` |
| 03 | «Очистить» the feed | `ReaderActionHistory`, App |
| 04 | Page error banner says «и ещё N» | `WebReaderFrame`, `readReaderErrorSummary` |
| 05 | Browser tab title becomes «<page> — Web Reader» while in Reader | App |
| 06 | «Назад» disabled until the page has somewhere to go back to | Recorder |
| 07 | Escape dismisses the selection chip | Recorder |
| 08 | Iframe marked `aria-busy` while loading | Recorder |
| 09 | Empty state mentions paste-and-go | Recorder |
| 10 | Phone tab bar shows «Ассистент не смог: …» when an action fails behind the chat tab | App |

Evidence: `docs/kb/log/2026-09-15-*-web-reader-user-like-cycle-08.md`.
