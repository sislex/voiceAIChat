---
title: cancelled-task-chat-visibility
date: 2026-08-17
machine: mac
author: alexeyrozhnov
---

# cancelled-task-chat-visibility

## Что сделано

- Уточнено поведение списка бесед при отмене отдельного CI-рана задачи.

## Что выяснили (факты, которых не было в KB)

- Статус `cancelled` у CI-рана вызывает обновление списка, но не скрывает чат, если сама задача остаётся в активной колонке.
- Текущая диагностика MacBook не подтвердила переданные сведения о Git credentials и SSH: Keychain возвращает `sislex`, а SSH отвечает `Permission denied (publickey)`.

## Куда занесено

- `docs/kb/projects.md`

## Открытые вопросы / что осталось

- Повторно проверить Git credentials и SSH на той CI-машине/рабочей копии, где наблюдались `StimkaT` и успешный SSH push; в текущую тему CI неподтверждённые сведения не внесены.
