---
title: ui-chat-mode-and-model-menus
date: 2026-08-02
machine: 2470-com
author: alexeyrozhnov
---

# ui-chat-mode-and-model-menus

## Что сделано

- Карточка чата в сайдбаре: вместо селектора lifecycle-статуса — слово режима
  разговора («план» / «разработка» / «задача»), во время хода синяя мигающая
  точка и «идет <режим>».
- `Sidebar` получил проп `defaultPermissionMode`: чат без своего режима
  показывает действующий из общих настроек, а не «разработку» наугад.
- Меню моделей приведены к спискам самих CLI: Claude — `default`, `opus[1m]`,
  `fable`, `sonnet`, `haiku`; Codex — `gpt-5.6-sol`, `gpt-5.6-terra`,
  `gpt-5.6-luna`, `gpt-5.5`, `gpt-5.4`, `gpt-5.4-mini`.
- `turns.ts` нормализует модель ДО клампа по роли; UI-селекты показывают
  сохранённую модель не из пресетов отдельным пунктом (в т.ч. пустую у codex).

## Что выяснили (факты, которых не было в KB)

- `claude --model` принимает `default` (CLI сам разворачивает его в null —
  «модель по умолчанию») и суффикс окна `opus[1m]`; оба видны в списке моделей
  бинаря CLI 2.1.218 наряду с `opusplan[1m]` и `sonnet[1m]`.
- Все шесть id из меню codex (`gpt-5.6-sol` … `gpt-5.4-mini`) присутствуют в
  бинаре codex-cli 0.145.0, то есть уходят в `-m` как есть.
- Три подписи режима ложатся ровно на три пункта `PERMISSION_MODES`: план →
  `plan`, разработка → `acceptEdits`, задача → `bypassPermissions`.
- Путь CI мимо нормализации: `modelFor` в `ci/modelHooks.ts` отдаёт
  `ci_runs.llm_model` прямо в `--model` (`claudeArgs`), поэтому дефолт CI `opus`
  работает, хотя пунктом меню быть перестал.
- Мост `conversations:setStatus` и `POST /api/conversations/:id/status` живы:
  ушёл только UI-вход, автозавершение хода в сторе их по-прежнему зовёт.

## Куда занесено

- docs/kb/ui.md
- docs/kb/llm.md
- docs/kb/protocol.md
- docs/kb/features/ci-runner.md (селект модели при повторе с `model_work`)

## Открытые вопросы / что осталось

- `DEFAULT_CI_CLAUDE_MODEL` остался прежним (`opus`): менять модель CI-ранов
  задача не просила, в селектах он показывается отдельным пунктом.
