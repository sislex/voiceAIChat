---
title: production-machine-bootstrap
date: 2026-08-25
machine: alexeys-macbook-air-2
author: alexeyrozhnov
---

# production-machine-bootstrap

## Что сделано

- Фича «бесшовная смена прод-машины»: `POST /api/projects/:id/production/bootstrap`
  (owner-only, мост `projects:bootstrapProduction`). Одним запросом: storage-привязка
  первого MachineStorage машины → linkMachine + materializeProjectMachine (канонические
  каталоги) → productionAgentId + дефолтные deploy/health-команды → default-машина,
  если валидной нет → managed preflight → включение managed при успехе. Результат —
  ProductionBootstrapResult (ok/mode/defaultMachineSet/preflight/cliLoginHint).
- `materializeProjectMachine` вынесен из routes/projects.ts в apps/server/src/projects/materialize.ts
  (общий код привязки и bootstrap).
- UI: кнопка «Подготовить прод-машину» под селектором production-машины в ProjectSettings.
- Попутно исправлена гонка reconcile при рестарте (managed offline → ложный failed
  health_check): resolve(...,{requireOnline:false}) в reconcile.
- Гейты: shared 553, server 1298, ui 1776, typecheck всего.

## Что выяснили (факты, которых не было в KB)

- Две роли машины: defaultAgentId (CI/merge/таски, per-user) и productionAgentId
  (только цель деплоя). «Всё сразу работает» = обе роли настроены; поэтому bootstrap
  ставит и default, если валидной нет.
- Чаты привязаны к своей execTarget/chat_storage_bindings, а не к productionAgentId —
  смена прода их напрямую не ломает (ломает только вывод старой машины из эксплуатации).
- CLI login неизбежно ручной: OAuth интерактивен, shared HOME новой машины пуст;
  альтернатива — ANTHROPIC_API_KEY/OPENAI_API_KEY в окружении runner.

## Куда занесено

- docs/kb/features/releases.md — раздел «Bootstrap прод-машины» + инцидент reconcile-гонки.

## Открытые вопросы / что осталось

- Хостовую scripts/prod/install.sh (root/systemd) bootstrap не оркеструет — осознанно.
- Happy-path bootstrap с живым агентом проверяется вживую (юнит-тесты покрывают
  контрактные ветки; materialize и preflight — своими тестами).
