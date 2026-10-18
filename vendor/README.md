# Pinned owner archives

Core pins owner packages (Core UI, Make, Identity, contracts, runner, …) as exact npm archives.
The archives are **not committed**: they live as assets of the public GitHub release
[`vendor`](https://github.com/sislex/voiceAIChat/releases/tag/vendor) and are referenced by URL
(`https://github.com/sislex/voiceAIChat/releases/download/vendor/<asset>.tgz`) in `package.json`
and `package-lock.json`. `npm ci` downloads them and verifies the lockfile `integrity`, so local
installs, Docker builds, Release Center, stands, agents and Delivery Control workers need no extra step.

This directory keeps only the manifests (`owner-artifacts.json`, `ui-libraries.json`; also
`../dependency-snapshots.json`). Local `*.tgz` copies are a cache (`.gitignore`).

- `npm run vendor:fetch` — put every pinned archive into `vendor/` (shared cache
  `~/.cache/sislexa/vendor`, override `SISLEXA_VENDOR_CACHE`), verified by sha256/integrity. Pin and
  provenance tools call this themselves when they need the bytes.
- `npm run vendor:publish` — upload local archives the release lacks (needs `gh` auth with write
  access). `release-composition apply` and `contracts-release` publish new pins automatically;
  assets are immutable and never replaced.
- `npm run vendor:check` — fails if any archive is tracked in git.
