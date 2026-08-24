---
title: web-reader-testing-pack
date: 2026-08-25
machine: alexeys-macbook-air-2
author: alexeyrozhnov
---

# web-reader-testing-pack

## Что сделано

- Действия модели: `errors` (буфер ошибок страницы: JS/rejection/console.error/fetch+XHR ≥400 с реальным URL), `wait` (поллинг элемента ≤8с), `back` (история страницы), `edits` (правки edit-режима для «сделай как я поправил»).
- MCP: `reset-session` (серверный `clearPreviewCookies`, роут POST /api/preview/reset-cookies с preview-cookie-авторизацией) и `environment` (feature-preview окружения проекта в machine.internal-форме, ленивый featurePreviewsRef).
- Reader UI: кнопки ‹ ›, «⟲ Сессия», селект «Адаптив» (375/768/1024); `target=_blank` вырезается, `window.open` шимится в same-window навигацию; сценарии персистятся в localStorage по origin+path, секретные шаги воспроизводятся runtime-значением, «Экспорт в Playwright» (playwrightExport.ts).
- Feature-preview: кнопка «Тестировать в Web Reader» (создаёт Reader-чат с адресом окружения и открывает вкладку).
- Починены dev-баги входа: отложенный отменяемый dispose runtime (StrictMode), кэш Proxy-обёрток actions в devtools. `WebReaderFrame` создаёт мост в эффекте — StrictMode больше не оставляет его disposed.
- HTTPS loopback в мосте агента (protocol: https, rejectUnauthorized:false), лимит узлов снимка 2500→4000.
- Живой прогон: dev-контур в честном StrictMode без обходов, самодиагностика 21/21.

## Что выяснили (факты, которых не было в KB)

- StrictMode-double-effect ломает любой необратимый dispose, созданный в useMemo, — не только runtime, но и мост WebReaderFrame; паттерн лечения: создание ресурса в эффекте либо отложенный отменяемый dispose.
- previewSession-cookie в auth действует по точному пути — новые preview-роуты надо явно добавлять в исключение.

## Куда занесено

- docs/kb/ui.md — раздел «Тестирование фич: errors, wait, back, edits, сессии и сценарии».
- docs/kb/testing-operations.md — дефекты dev-режима помечены исправленными.

## Открытые вопросы / что осталось

- input type=file (загрузка файлов в формы) и инлайн @font-face/background-image в снимках — не реализованы.
- Кнопка «Тестировать в Web Reader» проверена dom-тестом; живой прогон требует Docker-окружения feature-preview.
- Сценарии живут в браузере (localStorage); серверная привязка к проекту/разговору — следующий шаг при необходимости.
