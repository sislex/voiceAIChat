---
title: ai-prompt-builder
date: 2026-07-29
machine: 2470-com
author: alexeyrozhnov
---

# AI-помощник формулировки

## Что сделано

- Реализованы переиспользуемые `PromptBuilder` и `useAiAssist`, builder/settings, Storybook и DOM/a11y-тесты.
- Композер сообщения подключён через нативный `input`-event.
- Расширен REST/IPC-контракт генерации модификаторами; добавлены отдельные движок, модель и дефолтные промпты в per-user Settings.

## Что выяснили (факты, которых не было в KB)

- Старый `/api/prompt/suggest` уже давал одноразовые варианты, поэтому контракт расширен без создания нового транспорта.
- Desktop использует общий `Settings` и требует синхронного обновления contract-тестов, хотя находится вне npm workspaces.

## Куда занесено

- `docs/kb/ui.md`
- `docs/kb/protocol.md`
- `docs/kb/llm.md`

## Открытые вопросы / что осталось

- Нет.
