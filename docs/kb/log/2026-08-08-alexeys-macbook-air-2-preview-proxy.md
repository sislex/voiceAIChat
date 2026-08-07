---
title: preview-proxy
date: 2026-08-08
machine: alexeys-macbook-air-2
author: alexeyrozhnov
---

# preview-proxy

## Что сделано

- Описан защищённый same-origin preview-прокси для iframe и его отображение в правой панели чата.

## Что выяснили (факты, которых не было в KB)

- Прокси повторно валидирует все DNS-адреса перед соединением и для каждого redirect, поэтому URL превью не открывает доступ к приватной сети.

## Куда занесено

- `docs/kb/protocol.md`, `docs/kb/server-internals.md`, `docs/kb/ui.md`.

## Открытые вопросы / что осталось

- Нет.
