---
title: browser-runner-instagram-live
date: 2026-08-25
machine: alexeys-macbook-air-2
author: alexeyrozhnov
---

# browser-runner-instagram-live

## Что сделано

- Живой прогон apps/browser-runner: `npx playwright install chromium`
  (достаточно Chrome Headless Shell ~95 МБ), запуск с VC_BROWSER_RUNNER_TOKEN,
  POST /v1/sessions → navigate https://www.instagram.com/ → input click
  (закрыт cookie-баннер, выбран «Decline optional cookies») → screenshot PNG.
- Instagram отрендерился полностью — форма «Log into Instagram» с полями и
  кнопками; это подтверждает нишу playwright-reader для history-роутерных SPA,
  которые /api/preview не поднимает. Сам вход не выполнялся (пароли ассистент
  не вводит; UI-панель Playwright Reader к раннеру ещё не подключена).

## Что выяснили (факты, которых не было в KB)

- Для headless:true раннеру хватает chromium-headless-shell — полный Chromium
  Playwright не требует.
- Скриншот-команда отдаёт PNG сырым бинарным телом ответа /commands.
- SSRF-фильтр context.route не мешает внешним CDN Instagram.

## Куда занесено

- docs/kb/features/playwright-reader.md — абзац «Живой прогон 2026-08-25».

## Открытые вопросы / что осталось

- Оркестрация runner-а сервером и подключение UI-панели Playwright Reader —
  прежний список «не реализовано» в features/playwright-reader.md.
