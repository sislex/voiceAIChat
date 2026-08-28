---
title: machines-roadmap-12
date: 2026-08-28
machine: alexeys-macbook-air-2
author: alexeyrozhnov
---

# machines-roadmap-12 — ограничения PTY

## Что сделано

- Политика: `ptyIdleMinutes`, `ptyMaxSessions`, `ptyConfirmSudo`; реестр применяет их к PTY-сеансам; AgentCard — секция «Терминал (PTY)».
- Стенд: `sudo id` + Enter → «Команда с sudo — выполнить? (y/N)»; второй сеанс при лимите 1 → ошибка лимита.

## Куда занесено

- docs/kb/machines.md — «Живой PTY-терминал».
