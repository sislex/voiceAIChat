---
title: stand-start-without-models
date: 2026-11-14
machine: alexeys-macbook-air-tailae39a6-ts-net
author: alexeyrozhnov
---

# stand-start-without-models

## Что сделано

- Стенд без настроенных моделей стартует: сервисам передаётся закрытый локальный адрес раннера (`portableRunner`).

## Что выяснили (факты, которых не было в KB)

- Kanban отдельным процессом не запускается без `VC_LLM_RUNNER_CLAUDE_URL`; из-за этого `stand:create` без моделей падал.

## Куда занесено

- docs/kb/deploy.md

## Открытые вопросы / что осталось

-
