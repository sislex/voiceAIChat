---
title: Module ownership map
updated: 2026-10-07
areas: []
---

# Module ownership map

Each module keeps implementation knowledge in its own repository and changes it
with the code. Modules marked «нет» have no repository knowledge base yet; Core topics
about them stay in Core until their owners take them over. Until owner knowledge bases
cover a Core topic, the Core topic is kept, not shortened. `module:path` values below are stable cross-module KB document
identifiers, not filesystem links in this checkout. Core keeps only shared
architecture and contracts plus release, deployment, pins and operations.

Core uses this table as runtime registration input at startup and on the
admin-only `POST /api/kb/modules/reconcile` route. Keep the four-column table
and its header unchanged: module IDs and `owner/repo` values are backtick
literals; an available knowledge base uses exactly `<module>:README.md`
followed by the backtick `docs/kb` directory in parentheses, as below.
Rows marked `нет` are skipped. Registered owner modules use HTTPS GitHub URLs,
ref `main`, and path `docs/kb`; no project is required. The Core repository
maps to built-in `core`, and reconciliation removes older duplicate
registrations. `VC_KB_MODULES` takes precedence and disables automatic changes
to its managed list. See [repository module behavior](features/project-knowledge-base.md#repository-modules).

| Module | Repository | Knowledge base | Owner responsibility |
|---|---|---|---|
| `core` | `sislex/voiceAIChat` | `core:README.md` (`docs/kb`) | Public contracts, authorization, persistence, orchestration, host integration, release and operations |
| `core-ui` | `sislex/sislexa-core-ui` | `core-ui:README.md` (`docs/kb`) | Core browser renderer, UI modules, state, routes, stories and UI tests |
| `ui` | `sislex/sielexa-ui` | `ui:README.md` (`docs/kb`) | UI Kit and Foundation primitives and their tests |
| `sdk` | `sislex/sdk` | нет (пока не заведена) | Public integration SDK and compatibility |
| `make` | `sislex/make` | `make:README.md` (`docs/kb`) | Make API/UI, project data, preview/build pipeline and tests |
| `agent` | `sislex/agent` | `agent:README.md` (`docs/kb`) | Companion runtime, tray/login apps, installers, tunnels, remote execution and tests |
| `playwright-reader` | `sislex/playwrightreader` | `playwright-reader:README.md` (`docs/kb`) | Chromium browser host, Reader API/UI/contracts and system tests |
| `web-reader` | `sislex/webreader` | `web-reader:README.md` (`docs/kb`) | Proxy engines, page actions, recorder, Reader API/UI and tests |
| `kanban` | `sislex/sislexa-kanban` | `kanban:README.md` (`docs/kb`) | Projects board, task workflow, CI/QA/merge orchestration and UI |
| `identity` | `sislex/identity` | нет (пока не заведена) | Identity, sessions, login/recovery/2FA and access UI |
| `billing` | `sislex/billing` | нет (пока не заведена) | Plans, entitlements, metering and billing UI |
| `analytics` | `sislex/analytics` | нет (пока не заведена) | Product analytics and reporting |
| `llm-runner` | `sislex/llm-runner` | нет (пока не заведена) | Claude/Codex process execution and runner contracts |
| `desktop` | `sislex/desktop` | нет (пока не заведена) | Electron host, preload, migration and desktop packaging |
| `image-studio` | `sislex/image-studio` | `image-studio:README.md` (`docs/kb`) | Image Studio API, panel and contracts |
| `voice` | `sislex/voice` | нет (пока не заведена) | STT/TTS services, microphone UI and voice contracts |
| `knowledge` | knowledge service repository | нет (пока не заведена) | Multi-repository KB indexing, search, context and KB UI |
| `delivery-control` | `sislex/delivery-control` | нет (пока не заведена) | Delivery scheduling, workers, release commissioning and recovery |

The exact artifact versions and source commits consumed by Core are operational
state and therefore remain in [deploy.md](deploy.md), not in owner topics.
