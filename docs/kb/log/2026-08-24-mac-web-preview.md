---
title: web-preview
date: 2026-08-24
machine: mac
author: alexeyrozhnov
---

# web-preview

## Что сделано

Актуализированы сведения о локальном lifecycle Web Preview и о preview-session gate в host-компоненте.

## Что выяснили (факты, которых не было в KB)

`dev:web` владеет backend и двумя Vite-процессами, завершает их деревья совместно, а основной Vite проксирует `/web-recorder/`. `WebReaderHost` не передаёт непустой URL recorder-у до успешного `session.ensurePreview()`, поддерживает ошибку и retry и отбрасывает устаревшие async-результаты.

## Куда занесено

Факты записаны в `docs/kb/testing-operations.md` и `docs/kb/ui.md`.

## Открытые вопросы / что осталось

Нет.
