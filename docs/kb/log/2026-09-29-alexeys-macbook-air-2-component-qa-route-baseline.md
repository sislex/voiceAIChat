---
title: component-qa-route-baseline
date: 2026-09-29
machine: alexeys-macbook-air-2
author: alexeyrozhnov
---

# component-qa-route-baseline

## Что сделано

- Уточнён операционный ответ для component-QA runtime, на котором выбор baseline ранее возвращал `found 0`.

## Что выяснили (факты, которых не было в KB)

- Для точной runtime-сигнатуры component QA поддерживается проверенный `component-qa-chat-sync/before.json`; повторный `found 0` означает расхождение условий, compression или tools и остаётся ошибкой.

## Куда занесено

- `docs/kb/testing-operations.md`

## Открытые вопросы / что осталось

- Нет.
