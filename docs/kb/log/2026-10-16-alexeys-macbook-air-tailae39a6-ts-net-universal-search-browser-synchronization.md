---
title: universal-search-browser-synchronization
date: 2026-10-16
machine: alexeys-macbook-air-tailae39a6-ts-net
author: alexeyrozhnov
---

# universal-search-browser-synchronization

## Что сделано

Уточнены отдельные подзаголовки существующего раздела про синхронизацию universalSearch и диагностику браузерного гейта.

## Что выяснили (факты, которых не было в KB)

Наблюдение нового браузерного POST ставится до действия и сопоставляет ответ по identity запроса; повторный неизменный query требует предварительной очистки поля. Три полных прогона с двумя workers прошли, а замеры разделили debounce, серверный ответ и DOM commit.

## Куда занесено

`docs/kb/testing-operations.md`, раздел `Development gate: npm run gate:fast`.

## Открытые вопросы / что осталось

Исторический таймаут 6 октября на этом стенде не воспроизведён; cold FTS и конфликт порта не подтверждены.
