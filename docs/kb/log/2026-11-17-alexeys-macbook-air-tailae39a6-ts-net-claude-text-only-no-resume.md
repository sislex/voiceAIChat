---
title: claude-text-only-no-resume
date: 2026-11-17
machine: alexeys-macbook-air-tailae39a6-ts-net
author: alexeyrozhnov
---

# claude-text-only-no-resume

## Что сделано

- Текстовый ход Claude (чат вне режима рабочего пространства, `VC_CHAT_TEXT_ONLY`, стенд на API моделей) больше не передаёт раннеру сохранённый идентификатор сессии: запрос собирается из истории беседы.

## Что выяснили (факты, которых не было в KB)

- Раннер запускает текстовый Claude с `--no-session-persistence`, поэтому второй ход беседы падал: «No conversation found with session ID» (в чате — «Claude вернул ошибку»). Воспроизведено прямым вызовом API моделей прода.
- Codex хранит тред в профиле пользователя и продолжается как раньше.
- Каждый запуск Claude через раннер теряет 3 с на ожидании stdin («no stdin data received in 3s»).

## Куда занесено

- docs/kb/llm.md — «Text-only Claude turns never resume»

## Открытые вопросы / что осталось

- Закрывать stdin у процесса Claude в раннере (минус 3 с на ход) — отдельная правка раннера и его выкладка.
