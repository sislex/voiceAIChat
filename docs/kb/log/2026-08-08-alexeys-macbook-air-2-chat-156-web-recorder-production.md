---
title: chat-156-web-recorder-production
date: 2026-08-08
machine: alexeys-macbook-air-2
author: alexeyrozhnov
---

# chat-156-web-recorder-production

## Что сделано

- Зафиксирована production-раздача standalone Web Recorder из общего контейнера voicechat.
- Обновлена тема деплоя и пересобран индекс файловой базы знаний.

## Что выяснили (факты, которых не было в KB)

- Docker собирает оба frontend workspace, а Fastify раздаёт Recorder под `/web-recorder/` из `VC_WEB_RECORDER_DIR`.
- Prefix Recorder исключён из SPA-fallback ChatAI: отсутствующий recorder asset отвечает 404.

## Куда занесено

- `docs/kb/ui.md`
- `docs/kb/deploy.md`

## Открытые вопросы / что осталось

- Нет.
