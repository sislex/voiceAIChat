---
title: contracts-release-offline-diagnostics
date: 2026-10-31
machine: pc-radvilovich-tailae39a6-ts-net
author: voiceAIChat agent
---

# contracts-release-offline-diagnostics

## Что сделано

Сверены helper и регрессия contracts-release с базой `dev`, а также все изменения
в areas обязательных тем `deploy.md` и `testing-operations.md`. Уточнена граница
Shared file-storage contract и перегенерирован индекс.

## Что выяснили (факты, которых не было в KB)

Унаследованный `npm_config_loglevel=silent` подавлял ERESOLVE до записи в stderr;
явный глобальный `--loglevel=error` возвращает диагностику. Offline-регрессия
использует локальные tarballs, пустой cache и проверяет продолжение со следующим
consumer. Имена `storage.file.created` и `storage.file.deleted` в текущем коде не
объявлены и не эмитятся.

## Куда занесено

- `docs/kb/shared.md` — причина npm-диагностики, offline-проверка и отсутствие
  file-storage lifecycle events.
- `docs/kb/deploy.md` — поведение helper и регрессии contracts-release.
- `docs/kb/testing-operations.md` — свежесть после сверки затронутых scripts.

## Открытые вопросы / что осталось

Нет.
