---
title: quick-gate-root-scripts
date: 2026-10-26
machine: alexeys-macbook-air-tailae39a6-ts-net
author: alexeyrozhnov
---

# quick-gate-root-scripts

## Что сделано

- `gate:quick` больше не переходит на `gate:all`, если в корневом `package.json` изменено только поле `scripts`: `ownerPinChanges` возвращает `rootScripts`, план — `rootScriptPaths` (скрипты, которые изменённые команды начали упоминать), запускаются их тесты.
- `relatedTooling` выбирает соседний `<имя>.test.mjs` изменённого `scripts/<имя>.mjs` (тесты, запускающие скрипт процессом, его не импортируют); `scripts/dev-stand-local.mjs` добавлен в список узких утилит.
- В `AGENTS.md`: при падении только в тестах вне диффа — один перезапуск через `test:files`, сверка с `origin/dev`, затем отчёт без повторного гейта.

## Что выяснили (факты, которых не было в KB)

- Воркер SISL-778 шесть раз гонял `gate:all` (около 8 минут каждый) из-за одной добавленной npm-команды и падал на тестах вне своего диффа (`test_environment_stands.py` с таймаутом 50 мс, исправлено в #795). Строки `exit 17` в логе гейта печатают самопроверки скриптов гейта на своих фикстурах, это не сбой.

## Куда занесено

- docs/kb/testing-operations.md (Task acceptance / `gate:quick`), AGENTS.md (Required gate).

## Открытые вопросы / что осталось

- Ограничения числа повторов гейта на стороне конвейера Kanban нет; правило действует через инструкции репозитория.
