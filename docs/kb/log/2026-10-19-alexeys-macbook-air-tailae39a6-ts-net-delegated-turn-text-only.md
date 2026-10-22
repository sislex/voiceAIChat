---
title: delegated-turn-text-only
date: 2026-10-19
machine: alexeys-macbook-air-tailae39a6-ts-net
author: alexeyrozhnov
---

# delegated-turn-text-only

## Что сделано

- Ходы по делегированию тикета общего сервиса больше не уходят раннеру с `textOnly`: вместо этого
  `executionDisabled` и без удалённой машины, инструменты MCP сервиса остаются. Делегирование Identity по-прежнему
  `textOnly`.

## Что выяснили (факты, которых не было в KB)

- Приёмка deployment-profiles (сборка B, 2026-10-19): любой делегированный ход на Codex обрывался с «Соединение с
  исполнителем Codex оборвалось» — `codexCli.ts` раннера бросает `preview_text_only_unavailable` на `textOnly`, и
  раннер закрывает соединение без конверта exit. Обычные ходы того же пользователя проходили.

## Куда занесено

- docs/kb/data-auth.md — раздел о делегировании по тикету.
