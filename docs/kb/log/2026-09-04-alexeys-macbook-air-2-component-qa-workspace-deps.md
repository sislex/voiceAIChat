---
title: component-qa-workspace-deps
date: 2026-09-04
machine: alexeys-macbook-air-2
author: alexeyrozhnov
---

# component-qa-workspace-deps

## Что сделано

- Разобран трёхкратный провал Component QA задачи CHAT-411 на проде: стадия
  `npm run typecheck` падала за 2,5 с с `sh: tsc: command not found` и кодом 127
  во всех воркспейсах монорепо. Дефекта в ветке не было.
- `cleanupTaskNodeModules` (`ci/runManager.ts`) теперь сносит `node_modules`
  только у закрытой задачи (`VoiceChatDb.isTaskClosed`: `done`/`cancelled` или
  задачи нет). Полную уборку копии по-прежнему делает
  `MergeRunManager.releaseTaskRepositories`.
- Раннеры Component QA и интеграционных тестов ставят зависимости сами:
  `workspaceInstallCommand` (`ci/workspaceDeps.ts`) отдаёт
  `npm ci --no-audit --no-fund` с кэшем задачи. Кэш едет через новую колонку
  `ci_workspaces.npm_cache_dir` (пишет development-ран, там путь уже вычислен) и
  оба execution-контекста (`CiStageExecutionContext`).
- `classifyCiInfraFailure` знает вид `missing_dependencies` и применяется в обоих
  раннерах: такой ран закрывается как `blocked`/`infrastructure`.

## Что выяснили (факты, которых не было в KB)

- Component QA и интеграционные тесты выполняются в **том же** checkout, что и
  завершившийся development-ран (`componentQaExecutionContext` берёт `w.path`
  воркспейса `development_run_id`), но никакой установки зависимостей не делали —
  в отличие от merge-рана, который вызывает `npm ci` перед каждым гейтом.
- Уборка `node_modules` из CHAT-371 («protect CI runs from disk exhaustion»,
  27122ff4, 29.08.2026) срабатывает в `finally` любого терминального исхода
  development-рана — то есть ровно перед стартом Component QA. Гонка была
  гарантированной, а не флаки.
- Код 127 не попадал ни в один инфраклассификатор, поэтому сбой уходил в
  `implementation_defect` и жёг fix-loop: модель искала причину в исправном коде.
- Стадии обоих раннеров берутся из `projects.test_command` через `testStages`;
  `npm ci` там не было и по смыслу быть не должно — установка это ответственность
  раннера, а не настройки проекта.

## Куда занесено

- docs/kb/features/ci-runner.md — «Защита диска и очистка development-рана»,
  «Инфраструктурные ошибки шага», «Переход в QA-workflow».

## Открытые вопросы / что осталось

- Незакрытые задачи теперь держат `node_modules` дольше — если диск на машинах
  станет узким местом, понадобится отдельная уборка по возрасту рабочих копий
  (сейчас есть только предстартовая проверка `df -Pk .` с порогом 1 ГиБ).
