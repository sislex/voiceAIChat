---
title: playwright-reader-app
date: 2026-09-09
machine: alexeys-macbook-air-2
author: alexeyrozhnov
---

# playwright-reader-app

## Что сделано

- Ветка `feat/playwright-reader-app` от актуального `origin/main` по выбору пользователя.
- Backend Playwright Reader выделен в `apps/playwright-reader`: модуль, самостоятельный
  процесс, `PlaywrightReaderCore`/`PlaywrightReaderService`, HTTP-адаптеры, пересылка авторизации.
- REST `/api/browser/*` перенесён с тестами; выдача кадров CI выделена в `routes/browserShots.ts`.
- Web Reader передаёт действия Chromium сервисному порту; HTTP-клиент раннера перенесён
  в публичный `@voicechat/browser-runner/client`, CI/QA сохраняют совместимый реэкспорт.
- Docker-сервис `playwright-reader:8796`, стадия runtime, маршрутизация Caddy и прокси ядра,
  npm workspace и граф затронутых пакетов добавлены по образцу Make.

## Что выяснили

- UI-пакет `packages/playwright-reader-app` уже существовал; запрос требовал отдельного
  backend-приложения. Записи KB о неготовой серверной оркестрации и relay в Playwright были устаревшими.
- MCP сериализовал `outcome.result`, а прежний Chromium executor возвращал `data`, теряя
  текст страницы. Новое приложение передаёт `result`, включая ошибки селектора; есть регрессия.
- Прямой DELETE с JSON Content-Type и пустым телом должен поддерживаться приложением,
  как и ядром. Проверено реальным HTTP, в том числе через прокси.
- Существующий `server.test.ts` использовал домашнюю БД и упал на её схеме `model_prices`;
  fixture переведён на временные каталоги с очисткой. Подробности в `testing-operations.md`.
- Самостоятельный Web Reader может вызывать сервис Chromium как у приложения,
  так и у ядра при встроенном Playwright Reader; Postgres новому приложению не нужен.

## Куда занесено

- `apps/playwright-reader/AGENTS.md`, карта пакетов корневого AGENTS и инструкции сервера.
- `docs/kb/features/playwright-reader.md`, `architecture.md`, `server-internals.md`,
  `deploy.md`, `protocol.md`, `ui.md`, `testing-operations.md`, ссылка на кадры в `features/ci-runner.md`.

## Проверки

- `npm run gate:fast` — код 0. Общие файлы включили полный typecheck и все наборы
  тестов workspace: 3322 UI-теста, 96 browser-runner, 16 нового приложения,
  12 HTTP-интеграций приложения внутри полного серверного набора.
- После последней правки fixture отдельно проверен typecheck сервера — код 0.
- `VC_PUBLIC_HOST=localhost docker compose config --quiet` — код 0.
- `npm run -w @voicechat/web build` и `npm run build:storybook` — код 0;
  проверены отдельно, поскольку backend-diff их в gate:fast не выбирает.
- При прогоне в песочнице macOS запретила Mach-порт Chromium и просмотр дерева
  процессов. Гейт повторён с разрешением вне песочницы. Два UI-теста из параллельного
  прогона отдельно прошли (230 тестов двух файлов), затем весь UI прошёл без изменений.
- Настоящий Chromium проверен штатным тестом browser-runner. Новые HTTP-интеграции
  подменяют только раннер. Docker-образы не собирались; commit, push и деплой не выполнялись.

## Подготовка PR на актуальном main

На базе `c8fcb5e8` перед PR обнаружились отсутствовавшие подключения приложения:
workspace, зависимости, экспорт клиента, композиция ядра/отдельного Web Reader и
граф гейта. Они восстановлены вместе с расширением типа результата MCP и изоляцией
каталогов `server.test.ts`. Полный typecheck и тесты через `npm run gate:fast`
повторно прошли с кодом 0, включая 3325 UI-тестов, 16 тестов приложения и 12
HTTP-интеграций. Compose также проверен повторно. В KB уточнено, что штатный
Compose не требует новых обязательных строк в `.env`.

Обязательный перед PR `npm run gate` завершился с кодом 0: typecheck всех
workspace, все тесты, сборки web и Storybook. Изменения подготовлены к коммиту
и публикации по прямой просьбе пользователя; Docker-образы и деплой в этом
прогоне не выполнялись.
