# Make: choose how the assistant opens and reads other sites

Plan ID: `make-browser-v1`

Created: 2026-09-30

Baselines (`origin/main`): Core `b19c1c99`, Make `9f3287e`, Web Reader `8e47f6d`,
Playwright Reader `8ed652a`, llm-runner `097282f`, core-ui `647a007`.

Supersedes the unstarted plan `make-site-redesign-v1`; its capture and
verification scenario is stage S3 of this plan.

## Start here

This plan reuses the delivery control system and handoff format of
[`shared-chat-distributed-delivery.md`](shared-chat-distributed-delivery.md)
sections 2–3 and 6. Execution profiles must declare the base SHA, allowed paths, a
dependency context with upstream artifacts, trusted `npm ci`,
`STORYBOOK_DISABLE_TELEMETRY=1` and the owner gate.

Test scope follows the owner rule: during development and merge run only the
checks of the changed area (`gate:changed`, `gate:fast`, `gate:merge`); the full
release gate runs once, at release. Gates that run nested `npm` must not run inside
the macOS task boundary.

## 1. Problem

A user opens a site in Web Reader, but the assistant in a Make chat cannot reach
that page. It falls back to another web tool, may get 403, and cannot visually check
the site it built. The user switches chats and copies data by hand.

Facts at the baseline:

- Core never attaches the Browser MCP (`/mcp/preview`, `mcp__browser__*`) to Make
  turns: `apps/server/src/turns.ts` excludes `assistantKind === 'make'` because the
  model "tried to check the page and hit timeouts".
- The Browser MCP relays each action to the connected client where that chat is the
  active panel. A Web Reader session belongs to its own conversation, so a Make turn
  has no session to act on.
- Playwright Reader runs server-side Chromium sessions through `browser-runner`;
  screenshot, console, network and viewport exist only on this surface.
- The Make preview (`/api/preview/make/:id/*`) is not reachable by either reader.
- Claude WebSearch/WebFetch are disabled in Make turns; Codex built-in web search
  is not configured, so its default applies.

## 2. Outcome

- **Executor and browser are independent.** Claude or Codex decides who performs
  the request; the browser engine decides where the page opens. Switching the engine
  never requires another model or chat.
- **One capability interface for both executors:** open a URL, read the page and
  links, take a screenshot, find an element, click, type, scroll, get console and
  network errors. The Browser MCP is reused after its implementation and each
  engine's limits are verified.
- **Discovery, not promises.** Each turn receives the list of available engines,
  the sessions it may use and the actions each engine supports, computed from the
  live runtime. A capability is never advertised only because the prompt names it.
- **Choice by request:**
  - «через Web Reader» uses Web Reader;
  - «через Playwright», «полный браузер» uses Chromium;
  - «посмотри созданный сайт» opens the current Make project preview, takes a
    screenshot and reads the page;
  - without an explicit choice the engine is chosen by the task: reading content or
    a full interface check.
- **Fallback.** After a technical error one limited attempt through another
  available engine is allowed and announced in the chat. If the user named an engine,
  it is never replaced silently: the error is reported instead.
- **Session binding.** A browser session is bound to the current Make task. URL,
  text, links, screenshots and action results come back into the current Make chat.
  Only sessions the user may access are attachable; tabs, authorization and data of
  different users never mix.
- **Visible route.** Every call shows the executor, engine, target session, URL and
  place of execution: user panel, server proxy or browser-runner. Machine or IP is
  shown when known, otherwise «неизвестно».
- **Make limits stay.** Project files change only through `make_*`. Browser tools
  are for viewing and checking; no shell access is added.

## 3. Contracts

- `BrowserEngine`: `web_reader_panel`, `playwright_chromium`, `model_search`.
- `BrowserCapabilities` (per turn): engines with `available`, `reason` when not,
  `actions[]` verified for that engine, attachable `sessions[]` (id, engine, owner
  conversation, title, current URL), and whether the user pinned an engine.
- `BrowserRoute` (on every browser result): `executor` (`claude`/`codex` and model),
  `engine`, `sessionId`, `url`, `place` (`user_panel`, `server_proxy`,
  `browser_runner`), `machine` and `ip` or `null`, `fallbackFrom` when a fallback
  happened.
- Conversation setting `makeBrowser`: `engine` (`auto` or an engine), `pinned`
  (boolean), `sessionId` (bound session or `null`).

The contracts live in `@voicechat/web-reader-contracts` (engine, capabilities,
route) and in Core shared (conversation setting), with runtime validators.

## 4. Stages and task backlog

### S0 — Owner capabilities

| ID | Owner | Depends on | Deliverable and acceptance |
| --- | --- | --- | --- |
| B01 | Core | — | Shared conversation setting `makeBrowser` with validation and persisted whitelist; turn token carries engine, pin and bound session; availability computation with reasons per engine from entitlements, connected clients and runner health; unit tests for every rule |
| B02 | Web Reader | — | Contracts of section 3 with validators; Browser MCP tool `browser_capabilities` returning only verified actions per engine; `BrowserRoute` attached to every tool result; attaching a bound session of the same user to a turn of another conversation, rejecting foreign sessions; pinned-engine enforcement and one announced fallback; Make preview links allowed; tests for isolation between two users, pinning and fallback |
| B03 | Playwright Reader | B02 | browser-runner sessions attachable to a Make turn: create or attach a session owned by the user, report runner machine and IP when known, execute the capability actions, open Make preview links; system test on fixture pages |
| B04 | Make | — | MCP tool `make_preview_link`: read-only preview link bound to project, conversation and turn, TTL at most 15 minutes; `make_check` description and Make hint describe browser verification when an engine is available; files still change only through `make_*`; tests for expiry, scope and write rejection |
| B05 | llm-runner | — | Browser MCP tools allowed for Make turns for Claude and Codex; Codex `web_search` and Claude WebSearch/WebFetch enabled only for `model_search`, disabled otherwise; Claude Make allowlist covers every Make tool including `make_edit_file`, `make_apply_changes`, `make_remember`, `make_preview_link`; argument tests for both CLIs |

### S1 — Integration

| ID | Owner | Depends on | Deliverable and acceptance |
| --- | --- | --- | --- |
| C01 | Core | B01, B02, B04, B05 | Make turns attach the Browser MCP according to `makeBrowser` and capabilities instead of the blanket exclusion; route logging into turn events; Make preview links through the reader proxy; built-in shell and file tools stay disabled; turn tests for every engine, pinning, fallback and an unavailable engine |
| C02 | core-ui | B01, B02 | Make chat: engine selector with availability reasons, pin toggle and session picker listing the user's Web Reader and Playwright sessions; route shown on every browser tool call (executor, engine, session, URL, place, machine or IP or «неизвестно»); DOM and browser tests at 1440 and 390 px in both themes |

### S2 — End-to-end verification

| ID | Owner | Depends on | Deliverable and acceptance |
| --- | --- | --- | --- |
| U01 | Core | B03, C01, C02 | System test: a Make chat reads a page opened in Web Reader; switches to Playwright without changing model or chat; «посмотри созданный сайт» opens the Make preview with a screenshot; a pinned engine failure is reported, not replaced; an automatic fallback is announced; two users cannot reach each other's sessions; route is visible for every call |

### S3 — Site capture and redesign verification

| ID | Owner | Depends on | Deliverable and acceptance |
| --- | --- | --- | --- |
| A01 | Web Reader | U01 | Tool `inventory`: same-origin crawl up to 20 pages, navigation, forms with validation and submit targets, interactive controls, media, metadata, landmarks, design tokens, screenshots at 1440, 768 and 390 px; source-origin read-only guard (no form submits, no non-GET actions, no password or payment fields); tests on fixture sites |
| A02 | Make | U01 | Capture and verification storage under `.make/site-capture/` and `.make/verification.json`, rights confirmation per origin, verification rounds with per-item status, at most 3 fix rounds per turn; Make panel view of the inventory and the verification report; tests |
| A03 | Core | A01, A02 | End-to-end redesign scenario on a fixture site: capture, redesign, verification, a seeded defect found and fixed in a later round, budget exhaustion reported; KB feature page |

**Release and acceptance.** Release llm-runner, Make, Web Reader, Playwright Reader,
core-ui and Core in dependency order after S2, and again after S3. In production,
open a public site in Web Reader, read it from a Make chat, switch to Playwright,
check the Make preview with a screenshot, and verify the route display. The owner
decides the evidence level.

## 5. Parallelism and duration

| Stage | Tasks in parallel | Estimate |
| --- | --- | --- |
| S0 | B01, B02, B04, B05 on up to four workers; B03 after B02 | 2–3 days |
| S1 | C01 and C02 | 2 days |
| S2 | U01 | 1 day |
| S3 | A01 and A02, then A03 | 3–4 days |

With two workers S0–S2 take about 6–7 days and S3 about 3–4 more.
