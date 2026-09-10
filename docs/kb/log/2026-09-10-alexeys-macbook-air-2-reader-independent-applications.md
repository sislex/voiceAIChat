---
title: reader-independent-applications
date: 2026-09-10
machine: alexeys-macbook-air-2
author: alexeyrozhnov
---

# reader-independent-applications

## Что сделано

Обновлена чистая рабочая копия main до 83b7e546 (PR #131), работа ведётся в
feat/reader-independent-applications. Web Reader вынесен из apps/server в
apps/web-reader вместе с прокси/MCP/тестами; iframe apps/web-recorder входит в
его независимый образ. Убраны общая БД, серверная конфигурация и зависимости
рекордера от полного UI. Web Reader получает авторизацию, контекст проектов,
машины и ресурсы app.internal через ReaderCore. Контракты/клиенты выделены в
web-reader-contracts, playwright-reader-contracts, browser-contracts.

Playwright API больше не включает browser-runner/Playwright в своё сборочное
замыкание. Старые публичные client/security/core/service exports сохранены как
реэкспорты. Обновлены каталог, оба планировщика проверок, compose, требования
релизов, проверки связей и compatibility driver. Web Reader требует API ядра
>=1.1.0; UI-панели и Chromium сохраняют отдельные релизы.

## Что выяснили

Ранее самостоятельный процесс Web Reader открывал ту же БД и запускался из
apps/server. Изолированный Docker-запуск дополнительно обнаружил неявный acorn
из зависимостей ядра. Он объявлен у Web Reader; AST-тест теперь проверяет
production-импорты по его package.json. Проверка по текстовому regex цепляла
пример import внутри комментария, поэтому применяется разбор TypeScript.

## Проверки

Два образа построены из локального development checkout (это тестовые образы,
не опубликованные релизы). Docker Web Reader → отдельное ядро: context,
авторизация, app.internal, iframe assets и MCP прошли. Docker Playwright API →
ядро и настоящий Chromium: start/status/evaluate/stop прошли. В обоих образах
проверено отсутствие apps/server, apps/browser-runner, apps/web, packages/ui,
playwright, pg и better-sqlite3. Контейнеры и временные данные удалены.

Планировщик для внутренних файлов Reader выбирает только соответствующее
приложение (full=false, contracts=[]). Весь текущий перенос требует общего
гейта из-за изменения корневой сборки и общих контрактов.

Полный гейт теперь собирает Web Recorder до браузерного прогона. Ранее он
оставлял старый dist: пересборка после запуска fixture-сервера меняла хеши
assets, уже зарегистрированных static-маршрутами. После свежего запуска все
14 Native Reader E2E, включая возврат Chromium→proxy, прошли.

Итоговый `npm run gate:fast` завершился кодом 0: typecheck всех затронутых
областей (полный fallback корневого diff), 8 446 тестов в 33 пакетах, 91 тест
инструментов, сборки четырёх панелей, Web Recorder, web и Storybook,
253 браузерных E2E в 26 файлах. 45 тестов пропущены штатными условиями наборов.
Снимки remote-входа в собственный проект, панели Playwright и мобильного
рекордера просмотрены. `git diff --check` зелёный.

Перед коммитом по отдельной просьбе пользователя повторно выполнен
`npm run gate`: код 0, 8 446 тестов пакетов, 91 тест инструментов,
253 браузерных E2E и все сборки прошли. Проверка staged diff также прошла.

## Куда занесено

Обновлены architecture, server-internals, UI, deploy, testing-operations,
features/releases, features/playwright-reader; добавлены AGENTS новых пакетов.

## Ограничения

Релиз Web Reader объединяет API и iframe-рекордер; host-панель web-reader-ui
выпускается отдельно. Общая оркестрация разговоров остаётся в host App.tsx.
Cookie HTTP-прокси хранятся в памяти Reader и сбрасываются при рестарте.
