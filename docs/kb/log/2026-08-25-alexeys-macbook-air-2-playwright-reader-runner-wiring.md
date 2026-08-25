---
title: playwright-reader-runner-wiring
date: 2026-08-25
machine: alexeys-macbook-air-2
author: alexeyrozhnov
---

# playwright-reader-runner-wiring

## Что сделано

- Связка Playwright Reader с реальным browser-runner (оркестрация + панель).
  Слои: shared (REST-пути browser*, тип BrowserCommand, мост RendererBrowserBridge
  / window.browser), server (browser/runnerClient.ts — HTTP-клиент раннера;
  routes/browser.ts — REST /api/browser/:id/start|command|screenshot + DELETE с
  проверкой владения и типа playwright-reader; wiring в server.ts из
  VC_BROWSER_RUNNER_URL/TOKEN), ui (makeBrowserBridge + BrowserSessionPane,
  смонтирован в App.tsx на ветке inPlaywrightReader вместо WebReaderFrame).
- Панель: старт сессии на монтирование, screencast поллингом screenshot (1.2 c),
  навигация/back/forward/reload, клик по кадру через scaleBrowserCoordinates,
  ввод текста, stop на размонтировании; деградация «Chromium недоступен» без
  моста или при 501.
- Живой прогон end-to-end: dev-стенд с VC_BROWSER_RUNNER_URL + запущенный раннер →
  #/playwright-reader/<id> → панель ready → навигация на instagram.com →
  форма логина рендерится → клик по кадру закрыл cookie-баннер Meta.
- Гейты зелёные: shared 553, server 1290, ui 1768, web build, typecheck всех.

## Что выяснили (факты, которых не было в KB)

- 4 теста App.dom про preview-м约st были на playwright-маршруте (пока он монтировал
  WebReaderFrame). После переключения панели их перевёл на web-reader-маршрут —
  механика WebReaderFrame/preview живёт теперь только там; добавил тест, что
  playwright монтирует BrowserSessionPane (aria-label «Browser session»), не iframe.
- Screenshot нельзя пускать через мост-command union — у него бинарный ответ и
  отдельный роут; вынес в RendererBrowserCommand = Exclude<..., screenshot>.

## Куда занесено

- docs/kb/features/playwright-reader.md — раздел «Связка оркестрация + панель».
- docs/kb/ui.md — переписан абзац про правую панель Playwright Reader.
- docs/kb/protocol.md — REST /api/browser/* и мост window.browser.

## Открытые вопросы / что осталось

- mcp__browser__* в Playwright Reader пока идут через PreviewActionRelay/iframe,
  а не через раннер — управление настоящим Chromium моделью — следующий шаг.
- WS-транспорт кадров вместо поллинга; DOM/a11y snapshot Chromium; health-probe;
  idle-timeout и retention профилей.
