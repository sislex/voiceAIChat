---
title: public-live-stand
date: 2026-11-23
machine: alexeys-macbook-air-tailae39a6-ts-net
author: alexeyrozhnov
---

# public-live-stand

## Что сделано

- `npm run public:docker -- --from-dev` теперь поднимает «живой» стенд: контейнеры Core, Identity, Billing и хранилища остаются на готовых образах, а исходники dev-копий монтируются внутрь только на чтение; изменение исходника перезапускает службу за 1–3 секунды. Прежняя сборка образов — `--from-dev --build`.
- `npm run public:update` подтягивает `origin/dev` (только fast-forward) во все пять копий, при смене `package-lock.json` делает `npm install`, пересобирает бандл Core UI только при смене коммита Core UI или Identity и ждёт ответа `/healthz`.

## Что выяснили (факты, которых не было в KB)

- `tsx watch` и `node --watch` перезапускают процесс, не дождавшись выхода старого: Core и Identity падают на реестре токенов компонентов (SQLite с WAL) с ошибкой про приватное хранилище. Поэтому используется свой наблюдатель `live-run.sh` (опрос + ожидание выхода).
- Проверка готовности стенда по `/api/health` всегда давала 404 и ждала три минуты; правильный путь — `/healthz`.
- Замеры: перенастройка стенда на live — около 6 с; `public:update` без изменений — около 12 с, с пересборкой Core UI — около 50 с.
