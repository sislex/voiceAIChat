---
title: qa-panels-qa-workflow-kb
date: 2026-09-13
machine: alexeys-macbook-air-2
author: alexeyrozhnov
---

# qa-panels-qa-workflow-kb

## Что сделано

- Актуализированы темы QA-панелей, ручного QA и DevelopmentReadiness по коду merge-рана.
- Удалены устаревшие утверждения об отсутствии событий и обязательном постоянном polling.

## Что выяснили (факты, которых не было в KB)

- Все QA-панели восстанавливают снимок по адресным событиям, reconnect и ручному обновлению; polling нужен лишь без board-моста.
- Ссылки Integration QA адресуют workspace hash-маршрутом, а выбранный файл передают query-параметром перед hash.
- DevelopmentReadiness отклоняет любые обёртки вокруг единственного JSON до совместимой нормализации полей.

## Куда занесено

- docs/kb/features/qa-stage-runs.md
- docs/kb/features/manual-qa.md
- docs/kb/features/task-preparation.md

## Открытые вопросы / что осталось

- Нет.
