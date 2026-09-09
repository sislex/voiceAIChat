---
title: web-reader-preview-recovery
date: 2026-09-09
machine: germany-4-8-60
author: unknown
---

# web-reader-preview-recovery

## Что сделано

- Актуализированы темы интерфейса и деплоя после исправления загрузки собственного приложения через Web Reader.

## Что выяснили (факты, которых не было в KB)

- Страница сетевой ошибки создаётся серверным `previewErrorPage`; повтор перезагружает текущий preview URL с видимым loading-состоянием.
- Embedded и standalone Reader применяют операторские host aliases без разрешения прямого доступа к внутренним адресам.
- Для aliased-приложений прокси переписывает ESM imports, сохраняя публичный URL и hash.

## Куда занесено

- `docs/kb/ui.md`
- `docs/kb/deploy.md`

## Открытые вопросы / что осталось

- Нет.
