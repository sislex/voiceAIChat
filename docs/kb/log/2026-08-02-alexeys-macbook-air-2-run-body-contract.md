---
title: run-body-contract
date: 2026-08-02
machine: alexeys-macbook-air-2
author: alexeyrozhnov
---

# run-body-contract

## Что сделано

- Разрешён мерж `origin/main` в локальный `main`: конфликтовали только
  `docs/kb/deploy.md` (обе стороны дописали свои разделы — оставлены оба, команда
  обновления прода осталась `voicechat-deploy`) и генерируемый `docs/kb/README.md`
  (перегенерирован `npm run kb:index`).
- Починен полный отказ ходов после мержа: `RemoteLlmClient` слал `/v1/run` конверт
  `{id, kind, request}`, исполнитель ждёт плоский `LlmRunBody` → каждое сообщение
  обоим движкам получало `400 «prompt обязателен»`.
- `apps/server/src/llm/protocol.ts` сведён к адаптеру над `packages/shared`
  (`RunnerRunBody` = `LlmRunBody`, `parseRunnerLine` = `parseLlmRunFrame`, пути из
  `LLM_RUNNER`) — дублирующих определений больше нет.
- Добавлен `apps/server/src/llm/runnerContract.test.ts`: клиент ходит в настоящий
  `buildRunner` из `@voicechat/llm-runner` с подменённым `RunManager`. На старом коде
  тест падает ровно с сообщением из отчёта пользователя.

## Что выяснили (факты, которых не было в KB)

- Рассинхрон контракта `/v1/run` не ловился ничем: типы протокола были продублированы
  на сервере (typecheck молчит), а фейковый исполнитель в тестах повторял форму тела
  за клиентом (тесты зелёные при полностью нерабочем продукте).
- `parseLlmRunFrame` в shared падал с TypeError на строке `null` (валидный JSON, но не
  объект) — прежний серверный `parseRunnerLine` это переживал. Добавлена проверка и
  `packages/shared/src/llm.test.ts`.
- `rawRun.test.ts` в исполнителе искал каталог вложений по жёсткому `/tmp/...` и был
  зелёным только на Linux: на macOS `tmpdir()` — `/var/folders/...`. Regex теперь
  строится от `tmpdir()`.

## Куда занесено

- docs/kb/llm.md — раздел «Форму тела `/v1/run` держит только `packages/shared`»
- docs/kb/deploy.md — слиты разделы обеих веток

## Открытые вопросы / что осталось

- Мерж не закоммичен и на прод не выкладывался — решение за пользователем.
