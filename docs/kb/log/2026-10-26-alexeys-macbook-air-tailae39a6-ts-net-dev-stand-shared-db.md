---
title: dev-stand-shared-db
date: 2026-10-26
machine: alexeys-macbook-air-tailae39a6-ts-net
author: alexeyrozhnov
---

# dev-stand-shared-db

## Что сделано

- `npm run dev:stand` получил общий режим `SISLEXA_STAND_SHARE=<корень экземпляра>`: стенд запускает только Core, Make и Core UI из своих рабочих копий на базе управляющего экземпляра, остальные сервисы, секреты, сессионный секрет и конфигурация компонентов берутся у него. Режим хранится в `<home>/mode.json`.
- Локальный стенд `~/.sislexa/stands/local` (UI :35273, Core :31787) переведён на общую базу `sislexa_dev` с экземпляром :25273; вход и беседы общие (проверено в браузере).

## Что выяснили (факты, которых не было в KB)

- Реестр учётных данных компонентов требует права 700 на каждом каталоге: `cpSync` их не сохраняет, копировать через `cp -Rp`.
- Одноразовые гранты `make_request_*` живут в памяти выдавшего Core; общий Kanban проверяет их у своего `VC_CORE_URL`, поэтому операции стенда Make через Core стенда дают `make_request_denied`.

## Куда занесено

- docs/kb/deploy.md, раздел «Isolated local stand without Docker», абзацы Shared mode и Limits.

## Открытые вопросы / что осталось

- Подключение такого стенда к беседе Make проекта Sislexa (компонент core) требует доработки Kanban и Core: бездокерный стенд сейчас поддерживает только core-ui.
- Автотестов для `scripts/dev-stand-local.mjs` нет; проверено запуском на M2.
