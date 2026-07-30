---
title: prod-502-container-created
date: 2026-07-30
machine: alexeys-macbook-air-2
author: alexeyrozhnov
---

# prod-502-container-created

## Что сделано

- Подняли лежавший прод: `cd /root/voiceAIChat && docker compose up -d` (образ уже был
  собран, не хватало только `start`). Проверено: `/api/health` → `{"ok":true,...}`
  внутри и снаружи через Caddy, `https://45.135.182.251/` → `200`.
- Добавили `scripts/prod/`: `deploy.sh` (деплой, переживающий смерть канала),
  `watchdog.sh` (сторож для состояния `created`), `install.sh` (установка в
  `/usr/local/bin` + systemd-таймер). Установлено на прод, все ветки сторожа
  проверены вживую.

## Что выяснили (факты, которых не было в KB)

- **Деплой убивает таймаут канала, а не что-то в docker.** Сервер передаёт агенту
  `timeoutMs` (MCP-мост `remoteBashMcp.ts`: 120 с по умолчанию, максимум 300 с), агент
  по истечении делает `SIGKILL` (`apps/agent/src/exec.ts`). `docker compose up -d --build`
  в лимит не укладывается → процесс умирает между удалением старого контейнера и
  стартом нового, новый остаётся в `created`, снаружи `502` от Caddy.
  В `journalctl -u docker` это видно как обрыв buildkit-сессии
  («healthcheck failed fatally … only one connection allowed») через пару секунд
  после `create` контейнера.
- `restart: unless-stopped` от такого не спасает: политика применяется только к
  контейнеру, который хоть раз стартовал. Контейнер в `created` не поднимет и рестарт докера.
- Первая гипотеза «деплой шёл изнутри контейнера voicechat и убил сам себя» —
  **неверна**: в контейнере нет ни `docker` CLI, ни `/var/run/docker.sock`.
  Интерактивных ssh-сессий 30 июля до 08:16 тоже не было (`last`), CI не при делах
  (последний ран закончился в 07:59 успешно) — команда пришла через агента на хосте
  (`/root/.voicechat-agent/`, systemd --user), запущенного с `ws://…:8787/agent`.
- Разрыв WS сам по себе команды не убивает: в `apps/agent/src/connection.ts` на `close`
  висит только реконнект, дочерние процессы не трогаются. Убивают именно таймаут и `exec.cancel`.
- Хеш-префикс в имени (`<hash>_voiceaichat-voicechat-1`) — не поломка: так docker
  разводит конфликт имён при пересоздании. Уйдёт при следующем полном деплое.
- Доступ на прод: только парольный вход, `sshpass` на рабочей машине нет. Неинтерактивно
  надёжнее обёртка через `SSH_ASKPASS` + `SSH_ASKPASS_REQUIRE=force`, чем `expect`.

## Куда занесено

- docs/kb/deploy.md — раздел «Прод» переписан: почему нельзя звать `docker compose up`
  напрямую, что делают `voicechat-deploy` и `voicechat-watchdog`, как их ставить.

## Открытые вопросы / что осталось

- `scripts/prod/` пока не запушен в origin: на прод скрипты положены из временного
  каталога, в `/usr/local/bin`. После пуша достаточно `git pull` — переустановка
  `bash scripts/prod/install.sh` идемпотентна.
- Сторож поднимает и случай «контейнера нет вовсе» — то есть `docker compose down`
  он отменит. Намеренная остановка: `docker compose stop` (оставляет `exited`) либо
  `touch .deploy-paused`.
