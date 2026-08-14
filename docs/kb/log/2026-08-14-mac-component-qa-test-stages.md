---
title: component-qa-test-stages
date: 2026-08-14
machine: mac
author: alexeyrozhnov
---

# component-qa-test-stages

## Что сделано

- Разбор `projects.test_command` вынесен из приватной `testStages` в
  `apps/server/src/merge/runManager.ts` в общий модуль
  `apps/server/src/ci/testStages.ts`; дефолт теперь передаёт вызывающая сторона
  (merge — `npm run affected-check`, Component QA — `npm run test:storybook`).
- Исполнение Component QA-рана переехало из инлайна в `server.ts` в
  `createComponentQaRunner` (`apps/server/src/ci/componentQa.ts`): стадии идут
  последовательно через `ciExecutor` с `CI=1`, на каждую заводится своя запись
  в `commands`, первый ненулевой код прерывает остальные.
- В корневой `package.json` добавлен скрипт `test:storybook` — алиас
  `npm run build:storybook`.

## Что выяснили (факты, которых не было в KB)

- Фолбэк `npm run test:storybook`, который KB называла дефолтом Component QA,
  в корневом `package.json` до этой правки не существовал — дефолтный ран
  падал на несуществующей команде.
- Бюджет 30 минут — общий на ран, а не на команду: каждая стадия получает
  остаток, исчерпание бюджета блокирует следующую стадию без её запуска
  (`command_timeout`).
- У единственной стадии имя записи команды осталось прежним
  `Component / Storybook tests` — панель одностадийного рана не изменилась.

## Куда занесено

- docs/kb/features/manual-qa.md — формат `test_command`, пер-стадийные записи
  команд, новый фолбэк.
- docs/kb/features/merge-runner.md — ссылка на общий модуль разбора стадий.
- Статья «Автоматизированный Component QA: раны, quality gate и панель задачи»
  раздела «Разработка проекта».

## Открытые вопросы / что осталось

- Проверить после деплоя, что ран Component QA по CHAT-225 запускается кнопкой
  «Повторить» без изменения настроек проекта.
