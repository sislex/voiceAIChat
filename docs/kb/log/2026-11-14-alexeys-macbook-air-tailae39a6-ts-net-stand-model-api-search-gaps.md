---
title: stand-model-api-search-gaps
date: 2026-11-14
machine: alexeys-macbook-air-tailae39a6-ts-net
author: alexeyrozhnov
---

# stand-model-api-search-gaps

## Что сделано

Закрыты четыре поисковых пробела merge-рана по portable stand и публичному API моделей Core без создания дублирующей темы.

## Что выяснили (факты, которых не было в KB)

`npm run stand:create` вызывает `node scripts/stand.mjs create`: первый вызов создаёт `.stand/.env`, второй валидирует заполненную конфигурацию и запускает стенд. При паре model API doctor проверяет каталог до запуска сервисов. Канонический публичный префикс `/api/model-runner/v1/` задан в shared-протоколе; Core регистрирует под ним models, health, run и cancel.

## Куда занесено

- `docs/kb/deploy.md`, раздел «Стенд за 3 шага»
- `docs/kb/llm.md`, раздел «API моделей»

## Открытые вопросы / что осталось

Реальный smoke test с production-токеном по-прежнему не выполнен; документация не утверждает обратного.
