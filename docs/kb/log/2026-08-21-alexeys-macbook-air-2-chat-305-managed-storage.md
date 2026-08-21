---
title: chat-305-managed-storage
date: 2026-08-21
machine: alexeys-macbook-air-2
author: alexeyrozhnov
---

# chat-305-managed-storage

## Что сделано

- Привязка разговора лениво создаёт управляемую структуру ChatAI и manifest-файлы.
- Новые вложения пишутся в `attachments` выбранного MachineStorage.
- CI-workspace использует task-test environment с legacy fallback на `reposRoot`.
- В настройках разговора машина, storage/файловый каталог и Git-cwd разделены.

## Что выяснили (факты, которых не было в KB)

- Постоянные каталоги окружения отделены от восстанавливаемого `temporary/repository`.
- Offline/unavailable storage сохраняются в UI и не влияют на историю сообщений.

## Куда занесено

- `docs/kb/machines.md#постоянное-хранилище-машины`

## Открытые вопросы / что осталось

- Нужны отдельные срезы для production-transfer, migration wizard, TTL generated-файлов и `run.json`/`report.json`.
