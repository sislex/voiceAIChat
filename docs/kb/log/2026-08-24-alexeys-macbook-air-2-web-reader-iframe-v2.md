---
title: web-reader-iframe-v2
date: 2026-08-24
machine: alexeys-macbook-air-2
author: alexeyrozhnov
---

# web-reader-iframe-v2

## Что сделано

- Контракт Web Reader переведён на версию 2 (`packages/shared/src/webRecorder.ts`): конверт `voicechat.web-recorder.v1` + `WEB_RECORDER_PROTOCOL_VERSION = 2`, сообщения init/set-url/command/inspector-state/recording-state/diagnostics-start/dispose и ready/page-status/result/save-url/element-selected/recording-step/diagnostics-progress/diagnostics-complete/disposed, runtime-валидаторы с conversationId/registrationId в каждом рабочем сообщении.
- Host-сторона вынесена из `packages/ui/src/App.tsx` в `@voicechat/web-reader-app`: React-free `createReaderHostBridge` (автомат состояний, очередь до page-ready, таймеры, ротация регистрации на каждый boot Reader) и компонент `WebReaderFrame` (iframe, origin/source-фильтр, ensurePreview-гейт, инъецируемая платформа). Legacy `WebReaderHost`, `PreviewPane`/`WebPreview` удалены; architecture-тест ui запрещает возврат `@shared/webRecorder` и собственного iframe в host.
- `apps/web-recorder/src/Recorder.tsx` переписан под v2: handshake ready→init, проверка ID на каждом сообщении, dispose/disposed, тумблер инспектора, recording-step (sensitive без значения), диагностический режим с прогресс-панелью.
- Диагностика (`packages/ui/src/webReaderDiagnostics.ts`) получила handshake-шаги (регистрация/conversationId/registrationId) и retry перечитывания после навигации; всего 15 шагов, живой прогон в dev — 15/15.
- Dev-контур: `scripts/dev-web.sh` ждёт все три порта и валит сеанс при падении процесса; Vite-прокси `apps/web` — `/web-recorder/` с `ws: true` (HMR внутри iframe), `/api` без `changeOrigin` (иначе SSRF-отказ самодиагностики в dev).

## Что выяснили (факты, которых не было в KB)

- С `changeOrigin: true` у `/api` серверная проверка `url.host === req.headers.host` для `/api/preview/diagnostics` никогда не проходила в dev — самодиагностика отвечала «Адрес сайта недоступен для превью».
- HMR-сокет Reader ходит по пути `/web-recorder/` того же origin — без `ws: true` в прокси HMR внутри iframe не работает.
- Вход в dev-режиме сломан на main двумя независимыми дефектами (StrictMode + необратимый dispose runtime; Proxy Redux DevTools создаёт нестабильные ссылки actions и зацикливает эффект `setSidebarOpen`) — записано в testing-operations.md.
- `read` сразу после `click` по ссылке может исполниться на старом документе: навигация начинается после ответа клика, `page-loading` приходит позже — очередь host-а срабатывает только после зафиксированного loading.

## Куда занесено

- docs/kb/ui.md — разделы «Веб-рекордер», «Независимый Веб-рекордер и контракт хоста», «Действия модели в превью», самодиагностика в «Reader workspace-пакеты».
- docs/kb/clients.md — dev-прокси `apps/web` и `scripts/dev-web.sh`.
- docs/kb/testing-operations.md — новый раздел «Известные дефекты dev-режима браузера».

## Открытые вопросы / что осталось

- Дефекты dev-входа (StrictMode dispose, Redux DevTools цикл) не исправлены — нужен переживаемый dispose/guard повторного start и стабильные ссылки в devtools Proxy.
- `packages/web-reader-app` store/module (`createWebReaderStore`, `WebReaderApp`) — по-прежнему параллельный composition API без production bootstrap; production path — `App.tsx` + `WebReaderFrame`.
