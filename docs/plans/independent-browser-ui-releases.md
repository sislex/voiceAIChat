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

## Verification

Tests must cover compatibility rejection, corruption, traversal/link rejection,
immutable ID reuse, activation/rollback, old-tab chunks and API availability.
A real browser must load the owner artifact under its versioned base and load a
lazy screen after switching to another release. Production acceptance must record
Core container identity/uptime before and after a UI-only switch and rollback.
The first deployment that installs this mechanism is distinct from a UI-only
release and may restart Core through the normal `voicechat-deploy` flow.
