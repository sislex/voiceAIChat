---
title: disable-voice-input
date: 2026-07-27
machine: 2470-com
author: alexeyrozhnov
---

# disable-voice-input

## Что сделано

- Голосовой ввод временно отключён единым UI-флагом для web и desktop.
- Заблокированы кнопка микрофона, запуск захвата в store и связанные настройки STT/диалога.
- Добавлены компонентные, интеграционные и store-тесты блокировки.

## Что выяснили (факты, которых не было в KB)

- Общий UI требует gate не только на кнопке: сохранённый hands-free и barge-in могут вызвать `startVoice()` автоматически.

## Куда занесено

- `docs/kb/ui.md`

## Открытые вопросы / что осталось

- Для возврата голосового ввода переключить `VOICE_INPUT_ENABLED` в `packages/ui/src/lib/featureFlags.ts`.
