---
title: machines-roadmap-17
date: 2026-08-28
machine: alexeys-macbook-air-2
author: alexeyrozhnov
---

# machines-roadmap-17 — уведомления о долгих командах; релиз 0.1.177

## Что сделано

- WS `machine.command` + `MachineCommandEvent`; сервер публикует владельцу команды дольше `VC_LONG_COMMAND_MS`, для чата пишет лог в `artifacts/commands/`.
- App: тост с «Журнал»/«Открыть лог», Notification в фоне. Стенд: `sleep 3; exit 2` при пороге 2 с → красный тост.
- Релиз 0.1.177 (пункты 6, 7, 9, 8, 4) задеплоен, prod health 0.1.177.

## Куда занесено

- docs/kb/machines.md — «Журнал команд машины» (абзац «Долгие команды»).
