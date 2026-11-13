---
title: stand-proxy-hostname
date: 2026-10-30
machine: alexeys-macbook-air-tailae39a6-ts-net
author: alexeyrozhnov
---

# stand-proxy-hostname

## Что сделано

- Сверены реализация и регрессионные тесты hostname-aware аренд stand proxy относительно `origin/dev`.
- Обновлена freshness-метка темы backend internals и перегенерирован индекс KB.

## Что выяснили (факты, которых не было в KB)

- Без `VC_STAND_PROXY_PUBLIC_HOST` нормализованный hostname запроса без порта входит в ключ аренды: разные hostname получают разные listeners и origins.
- При настроенном public host его hostname входит в ключ и разные request hosts переиспользуют одну аренду.
- Каждая отдельная hostname-аренда занимает порт пула; исчерпание по-прежнему возвращает `stand_proxy_unavailable`.

## Куда занесено

- `docs/kb/server-internals.md#dev-stand-access-proxy`

## Открытые вопросы / что осталось

- Нет.
