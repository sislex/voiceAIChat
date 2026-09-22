# Agent and Desktop ownership

## Scope

Move the companion runtime, protocol, installers, tray and enrollment application
to `sislex/agent`, and the Electron chat client to `sislex/desktop`. Each owner
must install, test and build without a Core checkout. Core consumes immutable
owner artifacts and keeps authorization, machine registry and integration checks.
The chat UI remains Core-owned and is published as a versioned renderer artifact.

## Acceptance

- [x] Agent owns runtime/protocol/installer/client tests and independently builds.
- [x] Desktop consumes released Agent and chat renderer artifacts; no source aliases.
- [x] Core removes transferred paths and consumes published owner archives.
- [x] Owner and Core gates pass, PRs merge and release artifacts are pinned.
- [x] Deploy through installed voicechat-deploy and verify production and downloads.
- [x] Optimize gates after deployment, preserving integration coverage; measure stages.

## Completed gate changes

Core no longer installs/builds the retired nested Electron applications. Full
fallback runs each frontend browser case once. Compression caching validates
content/runtime and preserves fresh import graphs; warm inventory time fell from
43.2 to 2.7 seconds for identical reports. Each stage records its duration and
exit status. Browser suites remain sequential after parallel execution proved
unstable. Session and Settings fixtures now wait for the actual intended state.
The final canonical gate passed; evidence is in the gate-optimization journal.
