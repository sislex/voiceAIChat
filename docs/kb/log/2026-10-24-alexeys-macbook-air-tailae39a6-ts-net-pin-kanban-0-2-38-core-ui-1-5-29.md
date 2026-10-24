---
title: pin-kanban-0-2-38-core-ui-1-5-29
date: 2026-10-24
machine: alexeys-macbook-air-tailae39a6-ts-net
author: alexeyrozhnov
---

# pin-kanban-0-2-38-core-ui-1-5-29

## Что сделано

- Закреплены Kanban 0.2.38 (d5b0f960) и Core UI 1.5.29 (2a30e09b) с SK-68: в автономном режиме ассистент сам запускает план и другие обратимые изменения; подтверждение остаётся у деплоя и удаления; просроченный запрос подтверждения получает событие `widget.action.expired` и становится неактивным.
- Desktop не выпускался (заморожен).

## Что выяснили (факты, которых не было в KB)

- Многорепо-merge SK-68 влил owner voiceAIChat, но упал на owner sislexa-core-ui («URL origin временного merge-клона не совпадает с проектом») и завис в checking. Остальное влито вручную через PR (sislexa-kanban #204, sislexa-core-ui #194). Дефект — SK-75.

## Куда занесено

- docs/kb/deploy.md (версия Kanban)

## Открытые вопросы / что осталось

- SK-74 (getProject отдавал чужой проект до рестарта Kanban), SK-75 (многорепо-merge).
