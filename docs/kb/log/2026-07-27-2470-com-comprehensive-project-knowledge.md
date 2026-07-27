---
title: comprehensive-project-knowledge
date: 2026-07-27
machine: 2470-com
author: server
---

# comprehensive-project-knowledge

## Что сделано

- Проведена инвентаризация всех приложений, пакетов, исходных модулей, package scripts, текущих KB-тем и package-level `AGENTS.md`.
- Добавлены пять подробных тематических статей: shared-контракт, React UI/store, внутренности backend, web/Electron-клиенты, тестирование и эксплуатация.
- Корневая навигация дополнена новыми темами, генерируемый индекс пересобран.
- Существующие темы сверены с изменениями после их `checked` commit; актуальные факты о lifecycle, permission mode, usage/activity, restart recovery, project context и Windows PTY уже присутствуют.

## Что выяснили (факты, которых не было в KB)

- Не существовало цельной карты всех shared-модулей и правил эволюции одновременно REST, `/ws`, `/agent` и `window.*`.
- Не были системно описаны группы состояния store, reconnect/active-turn semantics, компоненты и границы remote-слоя UI.
- Не было одной статьи о порядке сборки Fastify, распределении маршрутов, cleanup WS-session, DB/файловых границах и конфигурационном приоритете.
- Web, desktop legacy migration, agent mode и agent-tray были описаны только краткими package-инструкциями.
- Отсутствовала единая test/diagnostic/backup/runbook-матрица для всех семи пакетов/приложений.

## Куда занесено

- `docs/kb/shared.md`
- `docs/kb/ui.md`
- `docs/kb/server-internals.md`
- `docs/kb/clients.md`
- `docs/kb/testing-operations.md`
- `AGENTS.md`, `docs/kb/README.md`

## Открытые вопросы / что осталось

- Нет: документация описывает текущее состояние; дальнейшие изменения кода должны обновлять соответствующие `areas` обычным KB-workflow.
