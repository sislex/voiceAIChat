---
title: identity-admin-activity-rpc
date: 2026-09-21
machine: alexeys-macbook-air-tailae39a6-ts-net
author: alexeyrozhnov
---

# Identity admin activity RPC

## Changes

Identity now serializes activity Maps as entry tuples and reconstructs them in
the client. Core pins the fixed upstream source and exercises both reported
admin user-list URLs through the real JSON boundary. Slow and failed API logs
record route templates and timing without user data.

## Production diagnosis

Both admin queries reproducibly returned 500 with `bulk.activity.get is not a
function`. Three concurrent probes took 33–107 ms. The signup callback returned
200 in all 30 HTTPS probes over one minute (4–29 ms on the server); the reported
30-second delay and 503 were not reproduced. No long-running SQL or CPU pressure
was observed. The original checkout and user development servers were preserved.
A separate ten-minute public HTTPS observation completed 60 signup requests with
HTTP 200 throughout (145–260 ms from the development workstation).

## Knowledge

- docs/kb/data-auth.md
- docs/kb/server-internals.md
- docs/kb/architecture.md

The ownership audit now lists the actual `sislexaExternal` adapter groups and
their removal prerequisites. It distinguishes remaining embedded LLM runner
implementation and future common-UI extraction from already external code.
The owner's follow-up requires finishing all started extractions after this repair,
including moving application-owned tests and gates to their repositories. The
acceptance checklist is `docs/plans/extraction-completion.md`.

The full gate exposed an existing deployment-test race: it read the second
metadata file as soon as the detached child created the first. The test now
waits for both complete outputs; assertions and production behavior are unchanged.

An Electron warm-chat measurement also observed account/settings chunks despite
the no-optional-intent scenario. The benchmark window previously accepted native
workstation input. It now opens without focus, ignores native mouse input and
parks the CDP pointer after login; product code and size limits are unchanged.

The isolated route recheck passed all 16 tests. Tool versions and measured
viewports were identical before/after (Web 1440x900 at scale 1, Electron
1280x774 at scale 2); the reviewed extraction baseline matched.

The complete `gate:fast` subsequently passed, including all 807 final browser
tests. The first pre-PR `gate` passed package tests/builds but rejected a Google
Fonts stylesheet whose content changed during route measurement. Ten diagnostic
loads with browser-cache clearing later returned identical HTTP 200 bodies. The
canonical gate was restarted unchanged; no budget or external-resource assertion
was relaxed. The repeated pre-PR gate completed successfully, including all 16
route checks and all 807 final browser tests. Both canonical commands exited zero.

## Remaining validation

Production rollout and post-deployment browser/API acceptance.
