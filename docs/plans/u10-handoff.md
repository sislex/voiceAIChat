# U10 exact-artifact handoff

Core pins 13 checksum-verified S2 owner archives in `dependency-snapshots.json`,
`vendor/`, the package manifests and the npm lockfile. The snapshot includes
Make, both Readers and their contracts, Core UI 1.4.3, Desktop 1.0.6, Chat UI
and Chat App 0.2.0, UI Foundation 0.1.8 and published Shared 0.1.10. Desktop's
embedded renderer matches the Core UI file manifest. The corrected Core UI and
Desktop archives are retained under `releases/shared-chat-u10-final/` on the
`evidence/shared-chat-v1-s2` branch of `sislex/delivery-control`.

Core's installed acceptance runs real settings HTTP and WebSocket routes,
public-package consumer extraction, installed-byte verification and negative
integrity checks. It tests published Make and Reader adapters against Core's
SQLite resource ownership and independent runtimes. The published settings
controller is exercised with every host label, persisted conflicts and device
isolation. Browser integration retains authenticated tool loading, mobile
Account recovery and universal-search deep links.

Run `npm ci`, `npm run gate:shared-chat`, `npm run gate:fast` and
`npm run gate:release` on the final committed Core source. Preserve the complete
logs and SHA-256 digests as the U10 owner evidence. The final gate must pass
outside the native model boundary, where WebSocket loopback binding and the
required browser runners are available. No production release or observed
production version is asserted by this development handoff.
