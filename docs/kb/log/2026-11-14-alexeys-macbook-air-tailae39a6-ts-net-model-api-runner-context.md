---
title: model-api-runner-context
date: 2026-11-14
machine: alexeys-macbook-air-tailae39a6-ts-net
author: alexeyrozhnov
---

# model-api-runner-context

## Что сделано

- Запуск модели по токену рабочего пространства (`POST /api/model-runner/v1/run`) завершался `exit 1` на проде 0.1.552 и на стенде: раннер отвечал `invalid_accounting_context`.
- Причина: раннер принимает `accounting.application` только от сервисного токена приложения `core`, а Core ходит в раннер мастер-токеном.
- Исправление: для запусков API моделей Core не передаёт `application` в контекст раннера. Пометка токена остаётся в резерве Billing и в журнале учёта Core, поэтому расход по токенам считается как раньше.
- Обновлены тема `llm.md` и тест `routes/modelRunner.test.ts`.
