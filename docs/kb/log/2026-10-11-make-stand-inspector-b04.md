# Make stand inspector B04

Implemented Make-only stand lease options for Storybook and makeStand Preview,
and a user/origin-bound browser session for machine-bridge HTML injection.
Both embedded and remote Reader responses use the existing B03 HTML helper.
Tests cover opt-in leases, ordinary workspaces, absent/forged/expired sessions,
user and port isolation, compressed HTML, CSP, non-HTML and cache validators.
Updated `server-internals.md` with the browser-session scope and expiry.

Validation in the assigned sandbox:

- `npm run gate:task -- --base a22d3c3c0b9fa2d2a7c231d5dc5ec56b327b2a40`: exit 255, no diagnostic after the npm command banner.
- `npm run -w @voicechat/server typecheck`: exit 255, no diagnostic after the npm command banner.
- `npm run test:files -- apps/server/src/routes/projectComponents.stand.test.ts apps/server/src/readerBridge/proxy.test.ts apps/server/src/makeBridge/makeStand.test.ts apps/server/src/htmlInject.test.ts apps/server/src/standProxy.test.ts`: exit 255, no diagnostic after the npm command banner.
- `git diff --check`: exit 0 (Git also reports denied xcrun cache writes).
- `node scripts/kb.mjs touch server-internals`: exit 0.
- `npm run kb:log -- make-stand-inspector-b04` and `npm run kb:index`: exit 255 without diagnostics; this log was written manually, generated index left untouched.

Supervisor must run the focused checks and task gate. No dependency installation,
commit, push, deployment or persistent service was performed.
