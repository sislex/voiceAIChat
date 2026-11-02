---
title: agent-ws-dependency-errors-merge-kb
date: 2026-10-31
machine: pc-radvilovich-tailae39a6-ts-net
author: voiceAIChat agent
---

# agent-ws-dependency-errors-merge-kb

## Что сделано

- Сверены с merge SHA границы ошибок agent WebSocket и async-подписчиков реестра.
- Обновлена свежесть связанных тем и перегенерирован индекс KB.

## Что выяснили (факты, которых не было в KB)

- Отказ Identity внутри message listener локализуется на соединении: ошибка логируется, cleanup снимает регистрацию и сокет закрывается retryable-кодом 1013.
- Ошибки pong и последней записи при close не выходят как unhandled rejection; rejected promises подписчиков AgentRegistry также перехватываются.
- Выживание Core и успешное следующее подключение проверяются отдельным Node-процессом с `--unhandled-rejections=strict`.

## Куда занесено

- docs/kb/conventions.md
- docs/kb/machines.md
- docs/kb/server-internals.md
- docs/kb/features/ci-runner.md
- docs/kb/features/feature-preview.md

## Открытые вопросы / что осталось

- Нет.
