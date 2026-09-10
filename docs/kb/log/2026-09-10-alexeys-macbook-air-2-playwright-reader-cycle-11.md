---
title: playwright-reader-cycle-11
date: 2026-09-10
machine: alexeys-macbook-air-2
author: alexeyrozhnov
---

# playwright-reader-cycle-11

## Что сделано

Цикл11: 10 пунктов профиля и очистки сайтов реализованы; отдельный коммит после обоих гейтов. Reader сохраняет вход, активный URL и viewport; QA остаётся одноразовым. Исправлена гонка stop/start и утечка при ошибочных cookie старта. MCP и панель очищают фактический Chromium, включая HttpOnly, IndexedDB, CacheStorage, service workers и sessionStorage; подтверждение очистки обязательно.

## Что выяснили

Старый stop/start терял новую incarnation в 3/3 пробах, а stop удалял профиль Reader. document.cookie и localStorage.clear не очищали HttpOnly, базы и кеши. Сессионные cookie требуют отдельного восстановления поверх persistent Chromium. Cookie не изолированы портом; origin-хранилища изолированы. Старт панели навязывал desktop viewport и мешал восстановлению.

## Проверки и время

Исходные native-регрессии: 11/12 красные. После исправлений16/16, 6,04с. Shared4, UI62, server/integration133, Reader18, CLI17 — зелёные. Typecheck всех пакетов и web build exit0. E2E18/18 за21,56с; кадры23/25 просмотрены. Первый E2E17/18: стенд ожидал ровно3 cookie, хотя несколько loopback-портов разделяют host. Точное удаление3 отдельно доказано native-тестом.

Общая интеграция: 1315с, 2026-09-10T03:47:58.670888+00:00 — 2026-09-10T04:09:53.950582+00:00. Прототипы вне checkout частично пересекались с гейтами10; интервалы не суммируются. Точное время и пункты: `docs/plans/playwright-reader-20-cycles.json`.

## Куда занесено

- docs/kb/features/playwright-reader.md
- docs/kb/llm.md
- docs/plans/playwright-reader-20-cycles.md и JSON

## Что осталось

Циклы12–20. Гейты цикла11 выполнены; коммит следует после фиксации отчёта. Внешние Gmail/Instagram в этом цикле не авторизовывались. Восстанавливается активная страница, не полный набор вкладок/история/sessionStorage.

Финальная проверка цикла11: gate:fast exit0, 7465 passed /45 skipped, 237,72с; полный gate exit0, 7796 тестов Vitest, web и Storybook, 337,89с. E2E18/18 за21,56с; кадры23/25 просмотрены. Первый fast выявил две устаревшие проверки молчаливого пропуска cookie; они заменены проверкой явного отказа public start до Chromium.
