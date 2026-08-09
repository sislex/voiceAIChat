---
title: feature-preview
date: 2026-08-10
machine: mac
author: alexeyrozhnov
---

# feature-preview

## Что сделано

- Выделена отдельная тема о feature-preview окружениях задач и добавлен указатель из корневого AGENTS.md.
- Описание feature-preview удалено из темы CI-раннера, индекс KB перегенерирован.

## Что выяснили (факты, которых не было в KB)

- Preview запускается только явной операцией пользователя, хранит серверное состояние и выполняет Compose на машине task workspace.
- App и Storybook изолированы уникальным Compose project, loopback-портами и preview-volume; Playwright target закрыт строгим SHA/health/seed-гейтом.
- В текущем срезе нет reverse proxy, Done-cleanup, аудита/WS, проектного редактора PreviewConfig и полного Docker reconciliation.

## Куда занесено

- docs/kb/features/feature-preview.md
- AGENTS.md

## Открытые вопросы / что осталось

- Дальнейшие срезы должны дополнять эту тему по мере подключения перечисленных runtime-возможностей.
