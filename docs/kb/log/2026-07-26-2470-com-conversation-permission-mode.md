---
title: conversation-permission-mode
date: 2026-07-26
machine: 2470-com
author: server
---

# conversation-permission-mode

## Что сделано

- Per-conversation режим прав агента: `Conversation.permissionMode`
  (`plan`/`acceptEdits`/`bypassPermissions`, `null` — из общих настроек).
  Колонка `conversations.permission_mode`, PATCH `/api/conversations/:id`,
  мост `conversations:setExecTarget`, приоритет в `turns.ts`
  (`conv.permissionMode ?? settings.permissionMode`, форс `plan` для роли
  user без машины сохранён).
- Страница «Настройки разговора»: секция «Режим работы» — селект режима
  (по умолчанию «Как в общих настройках — …») и строка «Сейчас действует: …»
  с пояснением, когда сервер форсит план.

## Что выяснили (факты, которых не было в KB)

- Эффективный режим хода до сих пор нигде не показывался в UI разговора —
  только пост-фактум в «Подробнее» сообщения (`MessageMeta`, «Режим прав»).

## Куда занесено

- docs/kb/protocol.md (настройки выполнения разговора)
- docs/kb/data-auth.md (схема conversations)

## Открытые вопросы / что осталось

- Бейдж режима в шапке чата (виден без открытия настроек) — кандидат на
  следующую итерацию.
