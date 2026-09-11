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
| 01 | Markup audit and evidence contract | 30/30 | `cf8e2df1` |
| 02 | Layout and clipping, with native audit integration | 30/30 | `3df0eaa8` |
| 03 | Typography and text rendering | 30/30 | `0a0274e6` |
| 04 | Color and contrast | 30/30 | `b16b2d46` |
| 05 | Interactive control states | 30/30 | this commit |
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
| 28 | Native session handoff and authenticated test profiles | 0/30 | pending |
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

## Cycle 02: layout diagnostics and native parity

The same bounded audit runtime will serve both engines. Native parity is supporting
infrastructure; the 30 new improvements are these independent layout checks. All
are review candidates because applications can intentionally clip or overlap UI.

1. `document-horizontal-overflow`.
2. `horizontal-scroll-locked`.
3. `vertical-scroll-locked`.
4. `clipped-horizontal-content`.
5. `clipped-vertical-content`.
6. `zero-width-control`.
7. `zero-height-control`.
8. `offscreen-fixed-element`.
9. `oversized-fixed-element`.
10. `sticky-without-inset`.
11. `sticky-scroll-trap`.
12. `collapsed-float-container`.
13. `collapsed-positioned-container`.
14. `overflowing-flex-row`.
15. `overflowing-grid`.
16. `zero-width-grid-item`.
17. `image-wider-than-container`.
18. `table-wider-than-container`.
19. `pre-wider-than-container`.
20. `absolute-outside-container`.
21. `negative-inline-start-content`.
22. `overlapping-flex-items`.
23. `overlapping-grid-items`.
24. `ineffective-z-index`.
25. `ineffective-align-self`.
26. `ineffective-order`.
27. `ineffective-vertical-align`.
28. `hidden-attribute-overridden`.
29. `display-contents-control`.
30. `multicolumn-content-clipping`.

Each check requires a broken/repaired browser fixture on both surfaces. Native
regressions also cover original URL reporting, human ownership and MCP integration.

Cycle 02 verification: 132 proxy audit E2E tests, 125 native-runner audit tests,
70 shared tests, 9 browser-contract tests and 8 Reader module tests passed. The
complete App/MCP/runner audit path passed with human ownership preserved. Inspected
the layout screenshot. `gate:fast` passed in 910.58 s; pre-commit `gate` passed in
528.68 s, both with exit code 0 and all 371 Reader E2E tests. Public native audits
ran on Google, Facebook and Instagram without signing in or choosing consent.

## Cycle 03: typography and text rendering

Add these 30 independent text diagnostics on both Reader surfaces, with paired
browser fixtures, live-update checks, bounded scans and visual evidence.

1. `small-font-text`.
2. `zero-font-text`.
3. `zero-line-height`.
4. `tight-line-height`.
5. `tight-letter-spacing`.
6. `tight-word-spacing`.
7. `transparent-text`.
8. `nowrap-text-overflow`.
9. `ellipsis-truncates-text`.
10. `line-clamp-truncates-text`.
11. `uppercase-long-passage`.
12. `capitalize-long-passage`.
13. `wide-text-measure`.
14. `narrow-text-measure`.
15. `justified-narrow-prose`.
16. `font-generic-fallback-missing`.
17. `break-all-prose`.
18. `thin-small-text`.
19. `heavy-text-stroke`.
20. `long-unbreakable-token`.
21. `prose-selection-disabled`.
22. `text-indent-outside-box`.
23. `bidi-control-characters`.
24. `invisible-characters-only`.
25. `inline-link-cue-missing`.
26. `outside-list-marker-clipped`.
27. `replacement-character-text`.
28. `raw-template-expression`.
29. `mojibake-text-pattern`.
30. `font-face-load-error`.

Supporting work separates test fixtures from production exports and registers
browser audit code as a browser-tested library in the application gate.

Cycle 03 verification: 201 proxy Chromium tests, 187 native Chromium tests,
14 planner tests and 9 browser-contract tests passed. Inspected the typography
screenshot. `gate:fast` passed in 476.82 s and `gate` passed in 496.25 s; each
completed all 455 browser tests with exit 0. Native public typography audits also
ran on Google, Facebook and Instagram in 6.1, 12.6 and 10.6 ms without signing in
or choosing consent. These single observations do not establish authenticated
compatibility or prove the pages free of defects.

## Cycle 04: color and contrast

Thirty separately verified color/paint capabilities are grouped into nine report
types. Color syntax support and paint composition are capabilities, not additional
rule IDs. Every listed capability has broken/repaired Chromium examples on both
Reader surfaces. Findings are estimates and review candidates.

1. Normal text contrast.
2. Alpha foreground.
3. Nested translucent backgrounds.
4. Ancestor opacity groups.
5. Large regular threshold.
6. Large bold threshold.
7. Placeholder text.
8. Inactive controls are excluded.
9. Gradient background is indeterminate.
10. Image background is indeterminate.
11. Occlusion is reported.
12. Blend mode is indeterminate.
13. Filter is indeterminate.
14. Text shadow needs paint review.
15. Transparent canvas is not assumed white.
16. Legacy rgba parsing.
17. Modern sRGB color parsing.
18. Display-p3 approximation.
19. Lab color parsing.
20. LCH color parsing.
21. OKLab color parsing.
22. OKLCH color parsing.
23. Text fill overrides color.
24. Before text.
25. After text.
26. Selection colors.
27. Current focus outline.
28. Control boundary.
29. Named SVG icon fills.
30. Opaque child excludes ancestor gradient.

Supporting verification covers live CSS changes, generated-text uncertainty, SVG
alpha cache isolation, limited scans, sensitive-value exclusion and read-only
behavior. Ratios use an 8-bit sRGB approximation; gradients and other complex paint
require additional visual evidence.

Cycle 04 verification: 270 proxy Chromium tests, 249 native Chromium tests,
nine browser-contract tests and both package typechecks passed. Inspected the
color screenshot. `gate:fast` passed in 143.21 s and pre-commit `gate` passed in
510.51 s, both exit 0; the final browser stage completed all 524 tests. Native
public color audits ran on Google/Facebook/Instagram in 7.9/22.9/17.9 ms without
truncation, login or consent actions. Returned candidates include incomplete paint
observations; these are not counts of confirmed site defects.

## Cycle 05: control-state probe

Add a bounded, read-only `probe {selector}` tool on both Reader surfaces. It
reports geometry, pointer interception, native versus declared states and editing
properties without attempting an action. The 30 diagnostic capabilities are:


1. Report pointer interception and the blocking element selector.
2. Find sampled reachable points when the center is covered.
3. Sample clipped portions using ancestor clip intersections.
4. Observe the usable portion of partially offscreen targets.
5. Inspect multiple client rectangles of wrapped inline links.
6. Explain target `pointer-events:none`.
7. Recognize a descendant restoring pointer events under a disabled pointer ancestor.
8. Identify direct native disabled state.
9. Identify disabled fieldset inheritance.
10. Respect the first-legend exception to disabled fieldsets.
11. Separate declared ARIA disabled state from native enforcement.
12. Identify inert ancestors.
13. Identify implicit modal blocking of the background document.
14. Respect modal dialogs escaping ancestor inertness.
15. Observe effective readonly text inputs.
16. Observe effective readonly textareas.
17. Explain readonly attributes ignored by incompatible input types.
18. Observe inherited contenteditable state.
19. Observe non-editable islands inside editable containers.
20. Identify display:none rendering suppression.
21. Identify computed visibility:hidden suppression.
22. Respect descendant visibility overrides of hidden ancestors.
23. Identify fully transparent ancestor opacity.
24. Report very low effective opacity without calling it hidden.
25. Identify content-visibility:hidden suppression.
26. Report skipped content-visibility:auto rendering as snapshot state.
27. Identify content hidden by closed details.
28. Respect the first summary's visibility inside closed details.
29. Identify closed-dialog rendering suppression.
30. Recognize CSS overriding the HTML hidden attribute.


Supporting work includes shared validation, native ownership preservation, MCP
integration, scope errors, limits, privacy, live-state tests and browser screenshots.
Cycle 05 verification: 340 proxy diagnostics, 314 native diagnostics, 40 shared
contract/mapping tests, 121 MCP tests, nine module tests and ten browser-contract
tests passed. Full proxy/native App paths and visual screenshots were checked.
`gate:fast` passed in 592.30 s and pre-commit `gate` in 616.81 s, both exit 0;
the latter completed 596 browser tests. Public native probes on Google, Facebook
and Instagram observed visible controls intercepted by consent content without
login or consent actions. This commit completes 150 of 900 planned improvements.
