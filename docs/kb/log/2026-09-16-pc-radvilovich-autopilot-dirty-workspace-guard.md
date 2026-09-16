---
title: autopilot-dirty-workspace-guard
date: 2026-09-16
machine: pc-radvilovich
author: voiceAIChat agent
---

# autopilot-dirty-workspace-guard

## Что сделано

- Актуализировано описание общего предохранителя автоматических development-запусков из `ready` и `development`.
- Зафиксированы персистентная дедупликация dirty-workspace остановки и объяснение безопасных ручных действий в RunFeed.

## Что выяснили (факты, которых не было в KB)

- Dirty-workspace отказ блокирует как новый ран, так и инфраструктурное продолжение существующего рана до ручного решения пользователя.
- Cooldown и лимит последовательных отказов применяются независимо от текущей колонки карточки.

## Куда занесено

- `docs/kb/features/task-autopilot.md`

## Открытые вопросы / что осталось

- Нет.
