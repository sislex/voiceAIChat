---
title: fs1-merge-kb-addresses
date: 2026-10-31
machine: pc-radvilovich-tailae39a6-ts-net
author: voiceAIChat agent
---

# fs1-merge-kb-addresses

## Что сделано

- Сверены с merge SHA темы deploy и testing-operations, а также реализация FS-1 в shared, file-storage и gate-скриптах.
- Для ранее пустых запросов закреплены точные поисковые адреса fileStorage и task-gate; старый якорь раздела task gate сохранён для существующих ссылок.

## Что выяснили (факты, которых не было в KB)

- Новых поведенческих фактов сверх уже внесённого описания FS-1 не обнаружено.
- После предыдущей сверки deploy менялся только тест выбора BASE_BRANCH; поведение запуска storage-узлов осталось прежним.

## Куда занесено

- docs/kb/shared.md, docs/kb/testing-operations.md, docs/kb/deploy.md.

## Открытые вопросы / что осталось

- SQL-адаптер, Core REST и polling узлов остаются задачей FS-2.
