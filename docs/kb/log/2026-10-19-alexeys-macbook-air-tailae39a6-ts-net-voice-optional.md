---
title: voice-optional
date: 2026-10-19
machine: alexeys-macbook-air-tailae39a6-ts-net
author: alexeyrozhnov
---

# Optional voice runners

Added VC_VOICE=off to the Compose settings generator. It removes inherited voice profiles and clears legacy STT/TTS endpoint URLs; the default remains on. Root Compose preserves explicit empty voice URLs and keeps Caddy enabled. Wildcard profiles conflicting with voice off are rejected.

Added profile regression tests to the tooling gate and a real Compose configuration check for build A with voice on/off. The deployment KB documents the setting and the three-service chat-only configuration.

Validation: profile unit tests and the existing environment suite passed. Direct Compose inspection selected exactly voicechat, postgres and caddy with voice off. The required quick gate against 9a3bbae8a04a758484154bba8379c73f81db5bdd delegated to the full gate for the Compose change and passed. The first run exposed a missing Core UI 1.5.25 vendor asset; the exact snapshot-matching archive was published and both failed artifact tests passed. A later browser run hit a universal-search request timeout; all 18 search tests passed when rerun, then the complete gate passed, including all 47 tests in the final integration batch. Production commissioning is separate.
