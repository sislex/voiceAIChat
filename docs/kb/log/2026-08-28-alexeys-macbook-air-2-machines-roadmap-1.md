---
title: machines-roadmap-1
date: 2026-08-28
machine: alexeys-macbook-air-2
author: alexeyrozhnov
---

# machines-roadmap-1 — watchdog агента

## Что сделано

- `agents/watchdog.ts` (+тесты), `machine_events`, WS `machine.status`, тосты в App, «не запущен · с HH:MM» в таблице машин; порог `VC_AGENT_OFFLINE_ALERT_MIN`.
- Автоперезапуск агента уже был (launchd KeepAlive / systemd Restart=always) — зафиксировано в KB.

## Что выяснили

- На macOS нет `timeout`; короткоживущий агент на стенде — фон + `pgrep -P` по дереву процессов tsx.

## Куда занесено

- docs/kb/machines.md — «Watchdog агента».
