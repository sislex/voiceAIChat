---
title: split-task-chat-default-machines
date: 2026-08-19
machine: macbook-air-user
author: NikolayTola
---

# Разделены default-машины задач и чатов

## Что сделано

- Зафиксированы независимые правила динамического наследования машины для CI-задач и разговоров.
- Описано единое разрешение effective-машины чата в настройках, REST-контексте и фактическом ходе.

## Что выяснили (факты, которых не было в KB)

- `Task.agentId = NULL` наследует текущий `Project.defaultAgentId` при каждом запуске; персональный default и load-aware fallback для задач не используются.
- `Conversation.execTarget = NULL` наследует персональный default пользователя и только в этом режиме допускает безопасный online-fallback; явный override не подменяется.

## Куда занесено

- `docs/kb/features/ci-runner.md`
- `docs/kb/machines.md`
- `docs/kb/projects.md`

## Открытые вопросы / что осталось

- Нет.
