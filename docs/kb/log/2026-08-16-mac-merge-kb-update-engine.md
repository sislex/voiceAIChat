---
title: merge-kb-update-engine
date: 2026-08-16
machine: mac
author: alexeyrozhnov
---

# merge-kb-update-engine

## Что сделано

- `kbUpdateForMerge` (`apps/server/src/ci/modelHooks.ts`) передаёт в
  `resolveTaskStageLlmConfig(..., 'kb_update', fallback)` снимок
  `{ llmEngineId, provider, model }` найденного development-рана: стадия идёт на
  движке того рана, чьим CLI-профилем работает. Оверрайды этапа задачи, этапа
  проекта и модели проекта выигрывают в прежнем порядке.
- Тесты `merge kb_update: движок наследуется от development-рана`
  (`apps/server/src/ci/modelHooks.test.ts`): наследование codex/gpt-5.6-sol,
  приоритет этапа проекта и этапа задачи, модель проекта, а также согласованность
  тройки при переопределении одной только модели этапа.

## Что выяснили (факты, которых не было в KB)

- Стадия `kb_update` merge-рана запускает CLI в профиле автора
  **development-рана** (`ctx.run.triggeredBy` = `triggeredBy` того рана), а не
  запустившего merge: контекст `ctx.run` — это `{ ...development, …снимок LLM }`.
- Четвёртый параметр `resolveTaskStageLlmConfig` заменяет и системный дефолт, и
  отсутствующую модель проекта (`projectModel: project ? … : fallback ?? null`).
- Пользовательские настройки движка (`ciLlmDefaultsForUser`, `app:<user>` в
  `settings`) в стадийную цепочку не входят вовсе — до этой правки merge-стадия
  падала в системный `claude/opus` при codex-профиле автора рана.

## Куда занесено

- docs/kb/features/ci-runner.md#движок-и-модель-наследование

## Открытые вопросы / что осталось

- Фолбэк «модель стадии не отработала» (`runModelOf` в `stageRunner`) по-прежнему
  резолвит `model_work` без снимка рана, поэтому в merge-стадии на codex пустой
  ход повторился бы с моделью `opus` на codex-клиенте. Вне объёма CHAT-253.
