---
title: temporary-cleanup-kb
date: 2026-09-16
machine: alexeys-macbook-air-tailae39a6-ts-net
author: alexeyrozhnov
---

# temporary-cleanup-kb

## Что сделано

- Сверена уже внесённая документация жизненного цикла временных ресурсов для CI и merge.
- Закрыт пробел о таймаутах браузерного регрессионного набора панелей QA.

## Что выяснили (факты, которых не было в KB)

- `qaPanels.browser.test.ts` задаёт 120 секунд для setup и teardown и 30 секунд для каждого viewport-теста.
- Указанный во входном описании 30-секундный teardown текущим кодом не подтвердился, поэтому в KB записано фактическое значение 120 секунд.

## Куда занесено

- `docs/kb/features/manual-qa.md`
- Сведения об очистке уже находятся в `docs/kb/features/ci-runner.md` и `docs/kb/features/merge-runner.md`.

## Открытые вопросы / что осталось

- Нет.
