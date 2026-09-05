---
title: qa-stage-cost
date: 2026-09-05
machine: alexeys-macbook-air-2
author: alexeyrozhnov
---

# qa-stage-cost

## Что сделано

- Починен разбор вывода `git diff-tree` в `ci/integrationTests.ts`: было
  `split(/\\r?\\n/)` (литерал «\r»), стало `/\r?\n/`. Та же правка в разборе
  `git rev-parse`.
- Автотесты пишет разработка: `automationHint` в `ci/modelHooks.ts` перечисляет
  обязательные `required && automatable` кейсы readiness и требует маркер
  `@testCase <id>` над тестом. Раннер интеграционных тестов читает маркеры
  (`grep -HoE` → `parseAutomationMarkers` в `shared/qa.ts`) и строит настоящую
  пару «кейс → файл»; синтез из диффа остался fallback-ом с пометкой в логе.
- Раздельные команды стадий: `projects.component_qa_command` и
  `projects.integration_test_command` (пусто → наследует `test_command`), поля в
  форме настроек проекта.
- Кэш зелёных прогонов: таблица `ci_gate_results` (`commit_sha` + `gateSignature`
  набора команд, уникальный индекс), `findPassedGateResult` /
  `recordPassedGateResult`. Оба раннера сначала спрашивают кэш и при попадании
  закрывают ран `passed` записью `cache`, без установки зависимостей и стадий.

## Что выяснили (факты, которых не было в KB)

- Этап `integration_tests` не блокировал коммиты разработки не потому, что так
  задумано, а из-за регулярки: несклеенный дифф проверялся как один путь, и
  наличия `/test/` где-нибудь внутри хватало для «нетестовых файлов нет».
  Воспроизведено на CHAT-411 (HEAD `9c314f9d` с `database.ts` и `schema.ts`).
- Обе пост-development стадии брали одну настройку `projects.test_command`, а
  их собственные дефолты (`npm run test:storybook`, `npm run affected-check`) не
  применялись, раз настройка заполнена. Из-за этого один и тот же полный гейт
  монорепо гонялся 3–4 раза за цикл задачи на неизменном коде.
- Замеры полного набора на MakBook M1 (Component QA CHAT-411, попытка 4):
  install 6,7 с, affected-check 9,5 с, typecheck 29,7 с, тесты shared+ui 50,6 с,
  тесты server+llm-runner 55,9 с — 2 мин 32 с суммарно.
- Промпт разработки про тесты по кейсам ничего не говорил: был только
  `DEVELOPMENT_FAST_GATE_HINT` про `gate:fast`.

## Куда занесено

- docs/kb/features/qa-stage-runs.md — «Чего в коде нет» (тесты приносит
  разработка, маркеры), «Как появляются automationLinks», исправленный дефект
  разбора диффа.
- docs/kb/features/ci-runner.md — раздельные команды стадий и кэш `ci_gate_results`.

## Открытые вопросы / что осталось

- `npm ci` перед стадиями безусловный, а он всегда сносит `node_modules`: при
  холодном кэше это десятки минут (на CHAT-411 ран так и провисел до отключения
  машины). Дешевле проверять `node_modules/.bin` и mtime `package-lock.json`.
- Merge-ран кэш не читает и не пишет: он гоняет гейт на merge-коммите, у
  которого другой SHA. Переиспользовать там можно только после явного решения,
  что проверка feature-SHA достаточна.
