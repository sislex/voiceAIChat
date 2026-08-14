---
title: component-qa-automation
date: 2026-08-14
machine: mac
author: alexeyrozhnov
---

# component-qa-automation

## Что сделано

- Раздел «Автоматизированный Component QA» в теме ручного QA переписан по фактической реализации CHAT-227: таблица `component_qa_runs`, серверный запуск, gate и панель.
- Закрыт пробел базы: в «Домен и критерий допуска» описаны `TestCaseDefinition`, `AffectedUiComponent`, `StorybookCoverage`, `UiImpact` и `DevelopmentReadiness`.
- В теме CI-раннера, в разделе перехода в QA-workflow, добавлена ссылка на автоматизированную стадию и возврат на доработку.

## Что выяснили (факты, которых не было в KB)

- Устаревание активного рана фиксируется не фоном, а внутри следующего `startComponentQaRun`: `development_sha_changed` либо `scenario_version_changed` (FNV-1a-хеш снимка сценариев и компонентов).
- Выполняется одна команда (`projects.test_command`, fallback `npm run test:storybook`), и её агрегированный исход присваивается всем сценариям снимка; per-scenario исполнения нет.
- Путь, машина и SHA не приходят от клиента: `componentQaExecutionContext` джойнит ран → development-ран → workspace и требует `pushed = 1`, совпадающий `commit_sha` и статус `queued`.
- Ненулевой exit → `implementation_defect`, timeout/потеря исполнителя/рестарт сервера → `blocked` + `infrastructure`, статус задачи при этом не меняется.
- WebSocket-событий у стадии нет: панель восстанавливается REST-опросом раз в две секунды и отбрасывает ответ старше локального снимка.
- «Отправить на доработку» идемпотентно: при уже связанном fix-ране возвращается он же; карточку в `development` переносит сам `CiRunManager.start`.
- Проверено: `packages/shared/src/qa.test.ts` и `apps/server/src/db/database.qa.test.ts` — 35 тестов проходят.

## Куда занесено

- docs/kb/features/manual-qa.md
- docs/kb/features/ci-runner.md

## Открытые вопросы / что осталось

- Пер-сценарные результаты и артефакты (отчёты, screenshots, visual diff) моделью данных предусмотрены, но исполнителем пока не заполняются.
