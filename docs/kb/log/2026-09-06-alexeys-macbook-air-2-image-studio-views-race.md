---
title: image-studio-views-race
date: 2026-09-06
machine: alexeys-macbook-air-2
author: alexeyrozhnov
---

# image-studio-views-race

## Что сделано

- Починен плавающий тест `apps/server/src/routes/imageStudio.test.ts`
  («публикация выдаёт ссылку…»): падал на `views` ≥ 1 с фактическим `0` в
  регрессионном прогоне release/0.1.247.
- В `ImageStudioStore` добавлен `publishSettled(conversationId)` — ждёт хвост
  очереди мутаций публикации (`publishChains`), добирая мутации, вставшие в
  очередь во время ожидания.
- Тест перед чтением `/publication` вызывает `store.publishSettled(convId)`.

## Что выяснили (факты, которых не было в KB)

- Маршрут публичной страницы `/g/:token/` считает просмотр fire-and-forget
  (`void store.countView(...)`), поэтому чтение `/api/image-studio/:id/publication`
  сразу после ответа страницы — гонка, а не гарантия. Прод-поведение верное
  (страница не ждёт записи sidecar), детерминизма не хватало только тесту.
- `withPublishLock` ставит промис в `publishChains` синхронно, до первого
  `await`, — значит к моменту возврата HTTP-ответа очередь уже видна снаружи и
  `publishSettled` детерминирован без sleep.

## Куда занесено

- docs/kb/protocol.md — абзац про публикацию галереи студии картинок.

## Открытые вопросы / что осталось

- В Make тот же фоновый `countView` (`routes/make.ts`), но HTTP-теста на
  счётчик там нет; появится — понадобится аналогичное ожидание очереди.
