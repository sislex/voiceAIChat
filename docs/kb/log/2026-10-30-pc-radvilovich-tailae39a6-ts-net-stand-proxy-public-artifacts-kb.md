---
title: stand-proxy-public-artifacts-kb
date: 2026-10-30
machine: pc-radvilovich-tailae39a6-ts-net
author: voiceAIChat agent
---

# stand-proxy-public-artifacts-kb

## Что сделано

- Сверена и актуализирована тема stand proxy на merge SHA `ef91cbd0`.

## Что выяснили (факты, которых не было в KB)

- Публичные артефакты приложений проходят через живую аренду без Core-сессии только для GET/HEAD по допустимому пути; перед отправкой на стенд cookies удаляются.
- Остальные HTTP-запросы и все WebSocket upgrade по-прежнему требуют сессию владельца аренды и актуальное членство в проекте.

## Куда занесено

- docs/kb/server-internals.md#dev-stand-access-proxy

## Открытые вопросы / что осталось

- Нет.
