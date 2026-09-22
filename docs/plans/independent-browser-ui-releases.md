# Independent browser UI releases

Updated: 2026-09-22

## Goal and ownership

`sislexa-core-ui` publishes an immutable browser-only artifact. Core installs the
serving mechanism once; subsequent UI activation and rollback must not rebuild
or restart Core, its API, workers or product applications. The bundled UI remains
a recovery option. Desktop renderer releases keep their existing lifecycle.

## Release and compatibility contract

Each browser release records its version, full clean source commit, release ID,
required Core API and application-host versions, and SHA-256 for every file. The
owner builds with a release-specific asset base, so an open tab continues loading
its original lazy chunks after another release becomes active. Core exposes its
running compatibility versions for deployment preflight; incompatible releases
are rejected before activation. Compatibility versions are explicit contracts,
not inferred from the Core product release number.

## Installation and activation

A server-side command installs an already built owner directory into persistent
Core data. It validates provenance, all asset paths and hashes, absence of links
and unlisted files, and the live Core compatibility response. The installer
publishes a complete immutable directory by rename, then atomically replaces a
small active-release record. A writer lock prevents overlapping activations.
The operation records the previous release and actor for rollback/audit.

Core reads the activation record without restarting. Root HTML and SPA fallback
use the selected release; immutable versioned asset routes preserve old-tab
requests. API/authentication, application panels, Recorder and WebSocket routes
retain their current ownership. A failed install or incompatible candidate leaves
the active release unchanged. The bundled UI can be selected explicitly.

## Release Center integration

The project Release Center treats the browser UI as its own artifact kind. It
reads only published releases from `sislexa-core-ui`, resolves the exact tag
commit through the GitHub API, and selects the deterministic archive name. The
browser cannot supply a download URL, commit or host command. Core downloads the
private release asset with its server credential and transfers the bytes to the
configured production machine without exposing that credential.

An install extracts into disposable storage, runs the existing verifier and
atomic activation command, and compares the Core container identity and start
time before and after the switch. Rollback and bundled fallback use the same
lock and evidence check. Every request has a project-scoped idempotency key and
a durable operation record containing the actor, requested version, resolved
release ID, result and bounded log. The live activation file remains the source
of runtime truth; the database is an audit trail, not a second selector.

## Verification

Tests must cover compatibility rejection, corruption, traversal/link rejection,
immutable ID reuse, activation/rollback, old-tab chunks and API availability.
A real browser must load the owner artifact under its versioned base and load a
lazy screen after switching to another release. Production acceptance must record
Core container identity/uptime before and after a UI-only switch and rollback.
The first deployment that installs this mechanism is distinct from a UI-only
release and may restart Core through the normal `voicechat-deploy` flow.

## Completed rollout

Core 0.1.327 installs the mechanism; independently published browser UI 1.1.1 is
active in production. Full local gates, GitHub UI CI, 67 installed-owner scenarios
and production acceptance passed. Installation/rollback/reactivation preserved
the Core container and its start time. Old and new browser tabs retained drafts;
old tabs could still fetch previously unloaded screens. Module boundaries and
benchmarks are maintained in the Core UI owner's
`docs/plans/ui-modules-and-browser-releases.md` and `docs/benchmarks/`.

The 1.1.0 browser tarball was rejected without changing the active UI because
macOS added unlisted metadata. The 1.1.1 publisher prevents that packaging mode
and checks archive entries against its manifest. See `docs/kb/deploy.md` for
verified commands, version identities and measured switching times.
