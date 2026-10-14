---
title: agent-self-update-stopstand
date: 2026-10-14
machine: alexeys-macbook-air-tailae39a6-ts-net
author: alexeyrozhnov
---

# agent-self-update-stopstand

## Что сделано

- stand-https-v1 C01: ядро отправляет `agent.update {version, sha256}` агенту под супервизором (systemd/launchd), если отдаваемая версия новее; один раз за подключение, событие безопасности `agent_update_sent`.
- `servedAgent()` считает версию и SHA-256 отдаваемого бандла; `/api/agents/script` отдаёт сырые байты, `/api/agents/version` — отдаваемую версию.
- Последний `agent.updateResult` хранится в реестре и виден в `GET /api/agents` как `updateStatus`.
- `devProcess.stopStand` добавлен в реестр dev-process RPC Shared; канбан вызывает его через `POST /internal/kanban/core`.

## Что выяснили (факты, которых не было в KB)

- Диспетчер `machines.devProcess` раньше пропускал любое имя метода; теперь только методы из `DEV_PROCESS_REQUEST_TYPES`.

## Куда занесено

- docs/kb/server-internals.md (раздел «Машины»)

## Открытые вопросы / что осталось

- WS-лента машин (`agentsFeed`) пока не несёт `updateStatus` — только REST.
