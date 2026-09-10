# Make — roadmap 3 (after roadmap 2)

Statuses: ✅ completed · ⏸ waiting for an external resource · ✗ skipped with a reason.
Proceed numerically with the same historical workflow as roadmap 2: gate per item, verification on :8799, KB and commit, release every five items.

| # | Item | Status |
|---|------|--------|
| 1 | Release Center free-space check before build/deploy and old Docker build-cache cleanup | ✅ `RELEASE_MIN_FREE_KB` is 5 GB: df → prune older than 24 hours and image prune → explicit build-step failure instead of an indefinite health check |
| 2 | Make tools for non-admin users without machines when Plan mode would otherwise block writes | ✅ Claude uses default permissions with `MAKE_ONLY_DISALLOWED_TOOLS` and writable Make MCP; Codex remains in Plan because its read-only sandbox blocks HTTP MCP |
| 3 | Publication analytics by day and referrer in .publish.json, with a dialog chart | ✅ UTC stats.days for 90 days, top 20 stats.referers hosts, 14-day bars, and referrer list |
| 4 | Mobile comment sheet and touch element selection | ✅ fixed bottom sheet at ≤720px with 60vh height and handle; inspector highlights on touchstart and selects on tap |
| 5 | Preview screenshot web fonts and @import handling in html2canvas clones | ✅ retain cross-origin links such as Google Fonts, inline same-origin CSS, and await document.fonts.ready |
| 6 | Named editor/viewer access for ChatAI project members | ✅ grants in .share.json, route access() checks, and editing through #/make-shared/<token> |
| 7 | Server-side Playwright screenshots and visual story regressions | ⏸ requires Playwright browsers in the server Docker image |
| 8 | GitHub push | ⏸ requires a user PAT and Git in the image |
| 9 | Figma import | ⏸ requires a Figma token |
