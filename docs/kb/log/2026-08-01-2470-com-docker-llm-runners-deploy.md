---
title: docker-llm-runners-deploy
date: 2026-08-01
machine: 2470-com
author: Codex
---

# docker-llm-runners-deploy

## Что сделано

- Сверены и актуализированы темы `deploy`, `llm`, `server-internals`, `features/llm-runners` и `features/ci-runner` после задачи про docker-разделение сервера и LLM-исполнителей.
- Зафиксировано, что серверный runtime и runner runtime теперь собираются разными target одного `Dockerfile`, а продовый compose поднимает `voicechat`, `runner-work`, `runner-personal` и `caddy`.

## Что выяснили (факты, которых не было в KB)

- `runner-work` переиспользует старые volume `vc-claude` и `vc-codex`, поэтому рабочая авторизация Claude/Codex переезжает без перелогина.
- Старые пользовательские профили `vc-data:/data/cli-users` при первом старте копируются entrypoint-ом в отдельный volume `vc-runner-work-data`; серверная БД и вложения остаются в `vc-data`.
- Серверный образ больше не несёт `claude` и `codex`: сервер ходит в runner-ы по внутреннему HTTP API с bearer-токеном, а прямой локальный CLI остаётся только fallback-режимом вне runner URL.
- `runner-personal` штатно может быть без Codex CLI: для этого образ собирается с `INSTALL_CODEX_CLI=0`, а в compose ему задаётся `VC_CODEX_BIN=/bin/false`.
- Продовый шаг пересборки должен поднимать не только `voicechat`, но и оба runner-сервиса, иначе после деплоя сервер останется на новом transport-е, а внутренние исполнители не обновятся.

## Куда занесено

- docs/kb/deploy.md
- docs/kb/llm.md
- docs/kb/server-internals.md
- docs/kb/features/llm-runners.md
- docs/kb/features/ci-runner.md

## Открытые вопросы / что осталось

- Реестр runner-ов в UI пока не участвует в маршрутизации реальных ходов: compose по умолчанию направляет Claude и Codex в `runner-work`, а `runner-personal` поднимается для отдельной авторизации и будущей регистрации в админке.
