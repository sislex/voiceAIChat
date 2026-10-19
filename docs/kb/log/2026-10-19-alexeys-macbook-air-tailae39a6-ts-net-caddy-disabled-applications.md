---
title: caddy-disabled-applications
date: 2026-10-19
machine: alexeys-macbook-air-tailae39a6-ts-net
author: alexeyrozhnov
---

# Route disabled applications through Core at Caddy

The live chat-only acceptance exposed HTTP 502 from Caddy for Make, browser and Image Studio paths, although Core correctly returned application_disabled. The Compose application generator now selects Core as those upstreams when the application is disabled or external. Local applications and legacy deployments retain direct service upstreams. Both public and internal HTTPS sites consume the generated values.

Added generator coverage for local, disabled, external and stale upstream values, and checked the actual Compose environment. Generator tests passed (10); stand tests passed (31). In a separate Docker project with disposable Postgres/data volumes, administrator login and the chat-only manifest succeeded with exactly Core, Postgres and Caddy. After recreation, Caddy adapted successfully and all six checked disabled prefixes returned 404 application_disabled over HTTPS using the generated CA certificate.

The required quick gate expanded to the full Core gate because the root Compose/Caddy configuration changed and passed with exit 0, including all browser integrations. Browser checks used one worker while owner publication was stopped to avoid resource contention. Existing Caddy contract tests now cover the configurable upstream syntax. The four-profile matrix and final production-snapshot release check remain separate operator acceptance.
