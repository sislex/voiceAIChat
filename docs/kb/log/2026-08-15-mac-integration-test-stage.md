---
title: integration-test-stage
date: 2026-08-15
machine: mac
author: alexeyrozhnov
---

# integration-test-stage

## Что сделано

- Описана стадия «Создание интеграционных автотестов»: таблица
  `integration_test_runs`, старт с предусловиями и skipped-веткой, runner
  `apps/server/src/ci/integrationTests.ts`, гейт `integrationTestGate`,
  маршруты `…/qa/integration`, ветка `IntegrationTestPanel` в `QaStageRunPanel`.

## Что выяснили (факты, которых не было в KB)

- LLM-этапа у стадии нет: `CI_RUN_MODES` остались `plan | development`, ран не
  вызывает модель, не пишет тесты и не коммитит — он валидирует дифф уже
  существующего HEAD-коммита workspace и прогоняет проектные test stages.
- `automationLinks` синтезируются: первый прошедший валидацию путь из диффа
  приписывается всем обязательным automatable-кейсам, per-case маппинга нет.
- `recordIntegrationAutomationLinks` попутно переписывает
  `ci_workspaces.commit_sha` на SHA тестового коммита — иначе гейт по SHA не
  сошёлся бы.
- Устаревание считается до проверки активного рана, поэтому смена SHA гасит
  активную попытку, и следующий старт создаёт новую вместо возврата прежней.
- Дефект: разбор `git diff-tree` использует `/\\r?\\n/` (двойное
  экранирование), то есть по строкам не режется.
- Стори `QaStageRunPanel.stories.tsx` для integration-стадии теперь показывают
  фолбэк «Стадия недоступна»: они подставляют только `listStageRuns`.

## Куда занесено

- docs/kb/features/qa-stage-runs.md — новый раздел «Предметный контур
  Integration Tests», правки границы реализации, панели и проверок
- docs/kb/features/manual-qa.md — короткий раздел про стадию со ссылкой на
  подробности

## Открытые вопросы / что осталось

- Маршруты `…/qa/integration`, валидация диффа в runner'е и
  `completeIntegrationTestRun` тестами не покрыты.
