# Web Reader model QA: 30 cycles

Requested scope: 30 improvements per cycle, 30 cycles, browser verification and
one implementation commit per cycle. Target: 900 verified improvements. A planned
item is not counted as implemented; each cycle must record evidence and its commit.

## Baseline and constraints

- Baseline: `17dd72ff`. Existing Reader gates pass: 732 backend/recorder/bridge/E2E
  tests in 112.86 s, and 61 UI/host/artifact tests in 22.54 s on Apple M2.
- Proxy Reader has read/find/styles, reconstructed screenshots, console/network
  buffers, basic accessibility extraction, recorder scenarios and Playwright export.
- Full Chromium already exists inside Web Reader (`previewEngine: chromium`),
  with persistent profiles, original-site rendering, tabs, pixel screenshots and
  shared human/model control. Its existing native E2E covers the complete App/API/
  runner/MCP path. Extend this implementation; do not create another browser engine.
- Missing: systematic evidence-based audits, rendering change comparisons,
  animation timelines, correlated runtime failures and reusable QA assertions.
- A rewritten iframe does not preserve the original browser origin. Native
  authentication, service workers and genuine compositor screenshots need a
  browser surface that retains that origin. External compatibility must report
  observed capabilities and blockers rather than promise universal login.
- Google prohibits developer-controlled embedded user agents for OAuth:
  <https://developers.google.com/identity/protocols/oauth2/policies#use-secure-browsers>.
  Embedding is also controlled by CSP frame-ancestors:
  <https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Content-Security-Policy/frame-ancestors>.
- Authenticated external testing requires a user-provided test session. Public
  page inspection and local reproducible fixtures can proceed independently.
- Public proxy probes on 2026-09-11: Google rendered consent, Facebook rendered
  an error page, and Instagram progressed from a splash screen to page-unavailable
  plus consent. The bridge was attached and no JS exceptions were reported in all
  three observations. Readiness and success must be assessed from application state.
- In-app browser initialization currently fails with missing `sandboxPolicy`
  metadata. Repository Chromium E2E remains available; capture artifacts there.
- Native public probes through `BrowserSessionManager` rendered Google consent
  and Facebook/Instagram login forms behind cookie dialogs. Both Meta sites logged
  a Credential Management service error. Screenshots were inspected; no login or
  consent action was attempted. Cycle 02 will establish native audit parity before
  adding layout diagnostics so both engines benefit from subsequent audit groups.

## Cycles

Each cycle has a target of 30 distinct, testable improvements. Detailed checklists
are written before implementation, after inspecting the relevant capabilities.

| Cycle | Area | Completed | Commit |
| --- | --- | --- | --- |
| 01 | Markup audit and evidence contract | 30/30 | `feat(web-reader): add 30 markup audit checks (QA cycle 01)` |
| 02 | Layout and clipping | 0/30 | pending |
| 03 | Typography and text rendering | 0/30 | pending |
| 04 | Color and contrast | 0/30 | pending |
| 05 | Interactive control states | 0/30 | pending |
| 06 | Forms and validation | 0/30 | pending |
| 07 | Focus and keyboard navigation | 0/30 | pending |
| 08 | ARIA widgets and state relationships | 0/30 | pending |
| 09 | Images and responsive assets | 0/30 | pending |
| 10 | Audio, video and canvas | 0/30 | pending |
| 11 | Animation observation | 0/30 | pending |
| 12 | Transitions and motion stability | 0/30 | pending |
| 13 | Scroll and sticky positioning | 0/30 | pending |
| 14 | Responsive and environment checks | 0/30 | pending |
| 15 | Dialogs, overlays and hit testing | 0/30 | pending |
| 16 | Navigation and route state | 0/30 | pending |
| 17 | JavaScript failure diagnostics | 0/30 | pending |
| 18 | Network and resource diagnostics | 0/30 | pending |
| 19 | Storage and session observation | 0/30 | pending |
| 20 | Loading and page lifecycle | 0/30 | pending |
| 21 | Shadow DOM and frame coverage | 0/30 | pending |
| 22 | Performance evidence | 0/30 | pending |
| 23 | Screenshot fidelity and visual evidence | 0/30 | pending |
| 24 | State snapshots and comparisons | 0/30 | pending |
| 25 | Scenario assertions | 0/30 | pending |
| 26 | Scenario execution diagnostics | 0/30 | pending |
| 27 | External-site capability reporting | 0/30 | pending |
| 28 | Native-browser audit parity and session handoff | 0/30 | pending |
| 29 | Reproducible bug reports | 0/30 | pending |
| 30 | Regression observation and model guidance | 0/30 | pending |

## Cycle 01: markup audit

The new bounded, scoped `audit` command makes these 30 independent checks
available to the model. Reports are observations; heuristic rules identify
candidates for review, not automatically confirmed defects.

1. Missing document language.
2. Invalid document language tag.
3. Missing or empty document title.
4. Quirks-mode document.
5. Missing mobile viewport declaration.
6. Duplicate IDs.
7. Labels referencing missing targets.
8. Broken aria-labelledby references.
9. Broken aria-describedby references.
10. Broken aria-controls references.
11. Broken aria-owns references.
12. Images without an alt attribute.
13. Image alternatives resembling filenames.
14. Unnamed iframes.
15. Unnamed buttons.
16. Unnamed links.
17. Unnamed form controls.
18. Missing main landmark.
19. Multiple visible main landmarks.
20. Empty headings.
21. Skipped heading levels.
22. Nested interactive controls.
23. Summary outside the first position in details.
24. Details without summary.
25. Data tables without header cells.
26. Broken table header references.
27. Invalid direct list children.
28. Labels targeting non-labelable elements.
29. Focusable descendants hidden from accessibility.
30. Positive tabindex overriding DOM order.

Verified: 49 focused shared-contract tests, 118 MCP tests, and 70 real Chromium
audit tests, including broken/repaired fixtures for all 30 rules, scope, paging,
bounded reports and sensitive-value exclusion. Inspected the screenshot fixture.
The final `npm run gate` passed with exit code 0 in 743.57 s; its Reader E2E stage
passed all 279 tests. The earlier fast gate overlapped a late runtime/test change
and failed; the complete frozen-implementation rerun supersedes that result.
