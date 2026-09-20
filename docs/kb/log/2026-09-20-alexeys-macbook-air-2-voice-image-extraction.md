---
title: voice-image-extraction
date: 2026-09-20
machine: alexeys-macbook-air-2
author: alexeyrozhnov
---

# Voice and Image Studio extraction

Moved speech services/browser audio and Image Studio API/UI into independently
installable repositories. Core consumes SHA/integrity-pinned compatibility archives.
Added scoped provider grants, verified STT connection credentials, long image request
timeouts, deployment examples and independent gates. Compatible runtime peer ranges
are released as source-distribution patches for the existing tools.

Independent gates, Core gate:fast and the publication gate passed, including 807 browser E2E checks,
536 host Storybook accessibility cases, and extracted application suites. Voice
1.0.0 and Image Studio 1.0.1 source releases and linux/amd64 images are prepared.
Real Piper synthesis produced a valid WAV. Production 0.1.314 completed at 06:24:35 UTC through installed voicechat-deploy.
All seven components are ready. Live checks passed for gallery CRUD/cross-user/CSRF,
component scopes and revocation, UI integrity and retained assets, HTTPS/browser
loading, Codex, and exact Piper-to-Whisper transcription. Temporary accounts were
removed. Deployment inputs, backup, token expiry and an environment-export correction
are documented in deploy.md.
Knowledge is recorded in architecture.md, stt-tts.md, deploy.md and the extraction plan.
