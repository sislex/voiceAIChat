---
title: chat-preview-split
date: 2026-08-07
machine: alexeys-macbook-air-2
author: alexeyrozhnov
---

# chat-preview-split

## Что сделано

- Добавлен изменяемый split экрана чата с адресной строкой, iframe и мобильным переключателем.
- Добавлены проектный URL по умолчанию и override разговора с серверной http/https-валидацией и миграциями SQLite.
- Добавлены серверные и DOM-тесты контракта, наследования, валидации и UI.

## Что выяснили (факты, которых не было в KB)

- Для первого рендера проектный fallback входит в `Conversation.projectPreviewUrl`, поэтому чат не зависит от предварительной загрузки списка проектов.
- Ширина preview — локальная UI-настройка, а URL — серверное состояние проекта/разговора.
- Параллельный `affected-check` передаёт Vitest согласованные `minWorkers` и `maxWorkers`; иначе Vitest 2.x может завершиться с нулём suites и кодом 1.

## Куда занесено

- docs/kb/ui.md
- docs/kb/projects.md
- docs/kb/shared.md

## Открытые вопросы / что осталось

- Нет.
