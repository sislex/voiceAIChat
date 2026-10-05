---
title: kb-multiple-modules
date: 2026-10-05
machine: alexeys-macbook-air-tailae39a6-ts-net
author: alexeyrozhnov
---

# kb-multiple-modules

## Что сделано

- Движок базы знаний ядра индексирует несколько модулей (kb-service-v1 C01): `docs/kb` ядра — модуль `core`, остальные — из `<VC_DATA_DIR>/kb-modules.json` или `VC_KB_MODULES` (`id`, `title`, `repository`, `ref`, `path`).
- Удалённый модуль — частичная выборка одного каталога (`fetch --depth 1 --filter=blob:none`, sparse checkout) в `<VC_DATA_DIR>/kb-cache/<id>`; обновление раз в `VC_KB_REFRESH_MS` (10 минут) и по `POST /api/kb/modules/:id/refresh`; при ошибке остаётся прежний индекс.
- Темы, поиск, контекст и MCP принимают фильтр модуля; `GET /api/kb/modules` показывает статус.

## Что выяснили (факты, которых не было в KB)

- Токен для приватных репозиториев — `config.githubToken`, передаётся в git через `GIT_CONFIG_*` заголовком, не в URL и не в аргументах.
- Артефакт `changes.patch` попытки пришёл с разрезанным многобайтовым символом в строке контекста; патч пришлось чинить перед наложением.

## Куда занесено

- docs/kb/features/project-knowledge-base.md, docs/kb/server-internals.md

## Открытые вопросы / что осталось

- Список модулей на проде (Make, агент, Playwright Reader, Web Reader) задаёт интегратор после выпуска.
