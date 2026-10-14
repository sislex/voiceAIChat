---
title: compose-stand-ports
date: 2026-10-14
machine: alexeys-macbook-air-tailae39a6-ts-net
author: alexeyrozhnov
---

# compose-stand-ports

## Changes

- Documented production Compose layer groups, exact-list inspection, stand port publication and browser certificate confirmation.
- Ran KB touch using the explicit docs/kb/deploy.md path (the short name deploy resolves to a directory), kb:log and kb:index.

## Verified facts

- The live voiceaichat-voicechat-1 config_files label includes the root Compose file, deploy/compose.*.yml overlays and /etc/voicechat host overrides, including make-stand.yml.
- docker compose config for /etc/voicechat/make-stand.yml confirms caddy publishes TCP 8790–8794 and voicechat exposes that range internally; live Docker port bindings agree.
- Caddyfile uses tls internal and proxies lease requests to the corresponding voicechat HTTP port. Live SHA-256 certificate fingerprints match on 89.125.68.35 ports 443 and 8790–8794.

## Updated topic

- docs/kb/deploy.md#production-compose-layers-and-stand-lease-ports

## Verification limits

- Browser certificate confirmation and an authenticated preview were not exercised. No stand was created and no production configuration was changed.
