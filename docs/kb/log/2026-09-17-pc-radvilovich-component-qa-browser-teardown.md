---
title: component-qa-browser-teardown
date: 2026-09-17
machine: pc-radvilovich
author: voiceAIChat agent
---

# component-qa-browser-teardown

## Что сделано

- Уточнён жизненный цикл браузерного регрессионного набора панелей Component QA.

## Что выяснили (факты, которых не было в KB)

- Все пять мобильных сценариев сохранены; каждый выполняется на viewport 390×844 с лимитом 30 секунд.
- Teardown последовательно закрывает Playwright browser и отправляет `SIGTERM` detached-группе Storybook; собственный лимит `afterAll` равен 120 секундам.

## Куда занесено

- `docs/kb/features/manual-qa.md`

## Открытые вопросы / что осталось

- Нет.
