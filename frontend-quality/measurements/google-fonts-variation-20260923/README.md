# Google Fonts response variation review

The Core 0.1.331 release gate on 2026-09-23 measured `386127` raw CSS bytes
for both direct Electron Settings routes. The reviewed limit was `385500`, so
the routes exceeded it by 627 bytes. The immutable application CSS resources
kept the same names and fingerprints as the preceding successful clean release
gate; the changed resource was the separately fingerprinted response from
`https://fonts.googleapis.com`.

Only the two exceeded limits were reset. The replacement `386900` limit is the
observed total plus 0.2 percent, rounded up to 100 bytes, using the same policy
as the Sislexa extraction review. Gzip and Brotli limits, every JS limit,
Settings navigation, forbidden optional modules, and fail-closed resource
fingerprinting remain unchanged.

The failed release recorded these values:

| Route | Metric | Previous limit | Observed | Delta | New limit |
|---|---:|---:|---:|---:|---:|
| `electron/settings/cold` | `css.raw` | 385500 | 386127 | 627 | 386900 |
| `electron/settings/warm` | `css.raw` | 385500 | 386127 | 627 | 386900 |
