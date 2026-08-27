---
title: make-console-assets-import
date: 2026-08-27
machine: alexeys-macbook-air-2
author: alexeyrozhnov
---

# make-console-assets-import

## Что сделано

-

## Что выяснили (факты, которых не было в KB)

-

## Куда занесено

- docs/kb/…

## Открытые вопросы / что осталось

-

Make: консоль превью (перехват console/ошибок из iframe), библиотека ассетов, diff снимка и возврат одного файла, экспорт Vite-проекта, импорт ZIP и страницы по URL (SSRF-гард прокси). Урок: `\n` в инжектируемом скрипте внутри TS-шаблона ломал весь inspector-скрипт — добавлен тест на парсинг. Полный прогон фич Make на стенде: API (curl) + UI (Chrome) — всё работает.

Diff-вью файла из снимка на Monaco DiffEditor (`make:snapshotFile`).

ReleaseCenter: удаление релиза через `useConfirm({requireText})` вместо `window.prompt` — нативный диалог замораживал вкладку (и автоматизацию Chrome).
