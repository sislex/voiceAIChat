# Make: open, redesign and self-verify an existing website

Plan ID: `make-site-redesign-v1`

Created: 2026-09-29

Baseline: Core `origin/main` at `8891f44d`

Activation: after plan `shared-chat-v1` Stage S4 is accepted. Until then this
document is a specification only; no task is claimed or running.

## Start here

This plan reuses the delivery control system, state machine and release barrier
of [`shared-chat-distributed-delivery.md`](shared-chat-distributed-delivery.md)
sections 2–3 and 5–6. Workers join run `make-site-redesign-v1` through the
installed delivery worker, claim only assigned tasks and publish evidence.

Execution profiles for every task must declare, from the start:

- base SHA and allowed paths of the owner repository;
- a dependency context that carries upstream task artifacts (released packages,
  vendored archives, contract versions);
- trusted `npm ci` in `prepare`, and `STORYBOOK_DISABLE_TELEMETRY=1` for UI gates;
- the owner `gate` command. Gates that run nested `npm` must not run inside the
  macOS task boundary, where nested `npm` exits 255 without output.

## 1. Product outcome

A Make user asks: "take the structure of this site and redesign it, keeping all
functionality". The user chooses which resource opens the site. Make:

1. opens the source site with the chosen resource and captures its structure and
   behavior into a functionality inventory;
2. builds the redesign in the Make workspace;
3. opens its own preview with the same resource and verifies every inventory item,
   console and network errors and layout at the target viewports;
4. fixes what failed and verifies again, within a bounded number of rounds;
5. reports what is preserved, what changed on purpose and what still fails.

The redesign changes presentation. Routes, content, forms, validation, submit
targets, interactive widgets, media, metadata and accessibility landmarks of the
source are preserved unless the user asked otherwise.

## 2. Current state (facts at the baseline)

- Core decides a Make turn by `conv.assistantKind === 'make'` in
  `apps/server/src/turns.ts`. The chat machine is ignored for Make turns.
- Core deliberately does not attach the Browser MCP to Make turns, because the
  model tried to "check the page" and hit timeouts (`turns.ts`, Browser MCP block).
- `MAKE_ONLY_DISALLOWED_TOOLS` removes Claude built-ins including WebFetch and
  WebSearch. Codex built-in web search is not configured anywhere: Core and
  llm-runner never pass `web_search`, so the Codex default applies.
- llm-runner builds the CLI arguments (`src/cli/claudeCli.ts`, `src/cli/codexCli.ts`).
  The Claude allowlist for Make lacks `make_edit_file`, `make_apply_changes` and
  `make_remember`.
- Make MCP (`apps/make/src/mcp.ts`) offers file tools and a static `make_check`
  whose description tells the model to call it "instead of trying to open the page".
- Make can import a URL (HTML plus up to 30 same-origin assets, public-host guard).
  The Make pane already records preview console and fetch/XHR errors on the client.
- The Web Reader Browser MCP (`apps/web-reader/src/mcp/previewMcp.ts`) has open,
  read, click, fill, sequence, check, audit, accessibility, console, network,
  styles, screenshot and viewport. It opens public URLs through the server proxy
  with an SSRF guard, `http://machine.internal:<port>` (loopback of the user's
  machine through the agent) and `https://app.internal/…`.
- The Make preview (`/api/preview/make/:id/*`) is not reachable from the readers:
  `/api/preview*` is blocked for `app.internal`, and the preview requires the
  viewer session. Publications (`/p/<token>/`, `/s/<slug>/`) are reachable.
- Playwright Reader `browser-runner` is a server-side Chromium container. It blocks
  private addresses and reaches machine URLs only through the Core preview proxy.
  No browser runs on the user's machine, and the agent reaches only 127.0.0.1.

## 3. Site resources

The conversation setting `makeSiteResource` selects one value:

| Value | Opens | Sees | Limits |
| --- | --- | --- | --- |
| `none` | nothing | — | Current behavior; default for existing conversations |
| `model_search` | built-in web search of the model (Codex `web_search`, Claude WebSearch/WebFetch) | text of public pages | No styles, scripts, screenshots or verification of the Make preview |
| `server_browser` | Playwright Reader Chromium on the server | DOM, styles, screenshots, viewports, console, network | Public hosts only; requires `playwright-reader.use` |
| `panel_browser` | Web Reader panel in the user's connected client, through the server proxy | DOM, styles, console, network; screenshots where the surface supports them | Requires `web-reader.use` and the panel open in a connected client |
| `machine_loopback` | `http://machine.internal:<port>` on the user's machine through the agent, opened by the server browser | Same as `server_browser` | Requires a connected machine; loopback ports only |

Rules:

- Core computes availability per user and conversation and returns the reason for
  every unavailable value. The UI shows the reason and never offers an unavailable
  value as active.
- For every value other than `model_search`, built-in model web search is disabled.
  For `model_search`, Codex runs with `web_search="live"` and Claude with
  WebSearch/WebFetch allowed; Browser MCP is not attached.
- The same resource opens the source site and the Make preview. For
  `model_search`, preview verification falls back to `make_check` plus the client
  console/network report, and the final report says so.
- Out of scope: sites reachable only through the user's LAN or VPN, and sites that
  need the user's own logged-in browser profile. They require a browser on the
  user's machine (Desktop or agent), which is a separate plan.

## 4. Workflow and limits

- **Capture.** A read-only pass on the source origin: same-origin crawl up to 20
  pages, navigation, links and routes, forms with fields, validation attributes
  and submit targets, interactive controls and their states, media, metadata,
  landmarks, computed design tokens (colors, fonts, spacing) and screenshots at
  1440, 768 and 390 px. Stored in `.make/site-capture/` as `inventory.json` plus
  PNGs, counted in the project quota.
- **Source safety.** On the source origin the browser does not submit forms, send
  non-GET requests initiated by clicks, accept dialogs or download files. Password
  and payment fields are never filled. Cookies and storage of the source site are
  not persisted into the project.
- **Rights.** Before the first capture of an origin the user confirms they own the
  site or have the right to reuse its content. The confirmation is stored per
  project and origin.
- **Preview access.** Make issues a read-only preview link bound to project,
  conversation and turn, valid at most 15 minutes, which the chosen browser can
  open. The link never grants write access or access to other projects.
- **Verification.** Every inventory item gets a status `pass`, `fail`,
  `changed-intentionally` or `not-verifiable` with evidence (selector, screenshot,
  console or network entry). Stored in `.make/verification.json` with a history of
  rounds.
- **Fix loop.** At most 3 verify-and-fix rounds per turn, a per-turn browser time
  budget and a page limit. When the budget ends, the report lists open failures
  instead of continuing.
- **Accounting.** Browser session time and model usage of capture and verification
  are attributed to the Make conversation like other tool usage.

## 5. Stages and task backlog

### S0 — Contracts and owner capabilities

| ID | Owner | Depends on | Deliverable and acceptance |
| --- | --- | --- | --- |
| B01 | Core | — | Shared contract: `makeSiteResource` and verification settings (enabled, round limit) in the conversation contract and persisted whitelist, validation, availability endpoint with reasons per value; unit tests for every availability rule |
| B02 | llm-runner | — | Per-request web search mode: Codex `web_search` set to `disabled`, `cached` or `live` and Claude WebSearch/WebFetch allow or deny; Make default is disabled. Claude Make allowlist covers every Make MCP tool, including `make_edit_file`, `make_apply_changes`, `make_remember` and new B04 tools; argument tests for both CLIs |
| B03 | Make | — | Read-only preview link: issue API and MCP tool `make_preview_link`, binding to project/conversation/turn, TTL ≤ 15 min, revocation at turn end, a path readers can open; tests for expiry, scope, write rejection and other-project rejection |
| B04 | Make | — | Capture and verification storage: MCP tools to save capture inventory and screenshots, read the checklist and record verification rounds; quota accounting; `make_check` description and Make hint rewritten to use browser verification when a resource is attached and static checks otherwise |
| B05 | Web Reader | — | Browser MCP for Make turns: `inventory` tool producing the structured inventory of section 4, multi-viewport screenshot batch, source-origin read-only guard, allowance for Make preview links, per-turn time and page budgets; tests on fixture pages |
| B06 | Playwright Reader | B05 | browser-runner executes the B05 commands on the chromium surface, opens Make preview links and `machine.internal` through the Core proxy, enforces session budgets; system test against fixture pages |

### S1 — Integration

| ID | Owner | Depends on | Deliverable and acceptance |
| --- | --- | --- | --- |
| C01 | Core | B01, B02, B03, B05 | Make turns attach Browser MCP according to `makeSiteResource` and capabilities, pass web search mode to the runner, keep built-in shell/file tools disabled, route preview links through the reader proxy, attribute browser usage; turn tests for every resource value and every unavailable reason |
| C02 | core-ui | B01 | Resource selector in conversation settings of Make chats with availability reasons, verification toggle and round limit, rights confirmation dialog, context inspector entry; DOM and browser tests at 1440 and 390 px in both themes |
| C03 | Make | B04 | Make panel: capture view (inventory, screenshots), verification report with per-item status and evidence, "verify again" action, client console/network capture included into the report; browser tests |

### S2 — End-to-end verification

| ID | Owner | Depends on | Deliverable and acceptance |
| --- | --- | --- | --- |
| U01 | Core | B06, C01, C02, C03 | System test with a fixture source site (several pages, JS menu, form with validation, modal, gallery) served publicly in the test and on machine loopback. For each resource: capture, redesign, verification; a seeded defect in the first redesign is detected and fixed in a later round; source-safety guard, budget exhaustion, missing capability and offline machine produce visible reasons |
| U02 | Core | C01 | Documentation: KB feature page, user-facing help for the selector, owner `docs/operations.md` updates in Make, Web Reader and Playwright Reader |

**Release and acceptance.** Release llm-runner, Make, Web Reader, Playwright
Reader, Core and core-ui in dependency order. In production, run the scenario on a
public site owned by the owner with `server_browser`, and on a local site with
`machine_loopback`; record the capture, the redesign, the verification report and
usage attribution. The owner decides the evidence level for acceptance.

## 6. Risks

- Model timeouts during page checks, the reason Browser MCP was removed from Make:
  mitigated by per-turn budgets, bounded rounds and structured `inventory` output.
- Proxy abuse: the SSRF guard stays; preview links are short-lived and read-only.
- Quota growth from screenshots: capture counts in the project quota and is
  covered by the existing snapshot sweep.
- Third-party content: the rights confirmation is required before capture.
