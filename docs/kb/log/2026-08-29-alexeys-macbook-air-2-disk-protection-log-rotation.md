---
title: disk-protection-log-rotation
date: 2026-08-29
machine: alexeys-macbook-air-2
author: alexeyrozhnov
---

# Защита диска CI-ранов и ротация Docker-логов

## Что сделано

- Сверены изменения менеджера development-ранов и основного Docker Compose.
- Дополнены существующие темы CI-раннера и деплоя без создания дублирующих статей.

## Что выяснили (факты, которых не было в KB)

- До clone ран требует не менее 1 ГиБ свободного места; после терминального статуса best-effort удаляет только корневой `node_modules`, сохраняя checkout и задачный npm-кэш.
- Все семь Compose-сервисов используют `json-file` с `max-size: 10m` и `max-file: 3`.

## Куда занесено

- `docs/kb/features/ci-runner.md`
- `docs/kb/deploy.md`

## Открытые вопросы / что осталось

- Нет.
