---
title: Playwright Reader — согласование со студией картинок из main
date: 2026-09-09
machine: alexeys-macbook-air-2
author: alexeyrozhnov
---

# Playwright Reader — согласование со студией картинок из main

## Что сделано

- В ветку PR #127 влиты изменения `origin/main` (`b0dff5bd`, отдельное приложение
  студии картинок). В workspace, зависимостях, Dockerfile, Compose, экспортах shared
  и графе гейта сохранены оба приложения. Сервисам оставлены собственные healthcheck.
- В конфликте `server.test.ts` сохранены отдельные временные каталоги для основного
  сервера и раздачи статики. Индекс KB и lockfile перегенерированы.
- Playwright Reader переведён на порт 8797: обновлены default standalone, Docker,
  Caddy, адреса у ядра/Web Reader, проверка маршрутизации и документация.

## Что выяснили (факты, которых не было в KB)

- Оба выделения независимо заняли порт 8796. В контейнерах это допустимо, но
  standalone на одном loopback столкнулись бы. У уже влитой студии картинок
  сохранён 8796, новое приложение Playwright Reader использует 8797.

## Куда занесено

- `docs/kb/deploy.md`, `docs/kb/features/playwright-reader.md`, AGENTS приложения.

## Проверки

- `VC_PUBLIC_HOST=localhost docker compose config --quiet` — код 0.
- Сверка нормализованного Compose подтвердила согласованность портов, адресов ядра,
  healthcheck, внутренних токенов и зависимостей обоих сервисов.
- HTTP-интеграции Playwright Reader (12) и студии картинок (14) прошли.
- Полный `npm run gate` на объединённом состоянии завершился с кодом 0:
  typecheck всех workspace, все тесты, сборки web и Storybook.
