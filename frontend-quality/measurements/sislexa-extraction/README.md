# Sislexa extraction route-budget review

The unchanged CHAT-473 limits failed against the already deployed shell. Before changing the limits, all local JS/CSS files requested by the Web Chat, Account and Settings scenarios were compared by SHA-256 with production 0.1.310 (core commit `48ab7ed2a36952d48f5ca2c68249af4cbde6cf6d`). Every compared file matched; `production-assets.json` retains the fingerprints. External Google Fonts CSS is measured but is not a core deployment asset.

`after.json` contains the complete fresh Web and real Electron measurement, including conditions, static/dynamic edges, resource fingerprints and request waterfalls. This is a measurement of the extraction tree, not a fabricated before measurement. The deployed baseline comparison directly establishes unchanged Web assets; no deployed Electron artifact was available for that comparison. The prior original CHAT-473 before/after reports remain intact.

`budget-review.json` records the old limit, observed total and replacement limit for each route. Only exceeded limits were reset to the observed total plus 0.2%, rounded up to 100 bytes. The roughly 2–3% accumulated JS drift predates the extraction for Web. Initial JS gzip remains well below 80% of the original CHAT-473 baseline for both clients. Forbidden optional modules, required routes, runtime activation checks and fail-closed measurement validation are unchanged. Automated gates do not regenerate these limits.

Reproduce with `npm run frontend:route-gates` after building Web and Desktop. macOS now resolves Electron through the installed desktop package instead of assuming the Linux binary layout.

The original report uses Node 22.23.2 and a Linux Electron viewport; this host
uses Node 22.19.0 and a macOS Retina viewport. `route-gate.mjs` chooses exactly
one reviewed report with identical runtime conditions, tools and compression.
Linux retains the original comparison; this macOS environment uses the extraction
report. Unknown or ambiguous environments fail, and selected reports still pass
the full comparison validation. No conditions are overwritten to force a match.

The fingerprint comparison was captured before the later E2E-discovered mobile
navigation fix. That fix makes its existing minimum-width override win against
UI Kit's global `!important` rule at 200% zoom. It changes the shell CSS after this
checkpoint and must fit the reviewed limits without another numerical increase.
