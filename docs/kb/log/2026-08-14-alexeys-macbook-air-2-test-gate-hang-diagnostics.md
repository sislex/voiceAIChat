---
title: test-gate-hang-diagnostics
date: 2026-08-14
machine: alexeys-macbook-air-2
author: alexeyrozhnov
---

# Устранение зависания тестового гейта и диагностика долгих проверок

## Что сделано

- Зафиксирован корректный lifecycle WebSocket/Fastify/SQLite в интеграционных тестах TurnManager.
- Описана потоковая диагностика долгих тестовых команд для merge-рана и release regression.

## Что выяснили (факты, которых не было в KB)

- `ws.close()` лишь начинает closing handshake; session cleanup завершается после события `close`, и только затем безопасно закрывать Fastify и БД.
- Cancel после первой дельты сохраняет partial как interrupted-сообщение и выдаёт единственный `done`; ожидание пустого `done` зависало до глобального timeout.
- `affected-check` оставляет быстрый успешный вывод компактным, но после 30 секунд печатает heartbeat, а при остановке — хвост дочернего вывода.

## Куда занесено

- `docs/kb/server-internals.md`
- `docs/kb/testing-operations.md`
- `docs/kb/features/merge-runner.md`
- `docs/kb/features/releases.md`

## Открытые вопросы / что осталось

- Нет.
