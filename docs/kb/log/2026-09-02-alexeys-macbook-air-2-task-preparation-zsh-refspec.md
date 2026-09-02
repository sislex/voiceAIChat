---
title: task-preparation-zsh-refspec
date: 2026-09-02
machine: alexeys-macbook-air-2
author: alexeyrozhnov
---

# Zsh-refspec синхронизации перед подготовкой

## Что сделано

- Fetch-refspec системной синхронизации подготовки переведён с `$base:refs` на `${base}:refs`.
- Тест фиксирует точный refspec и запрещает неоднозначную для zsh форму.
- Исправление действует и для обычных проектных чатов: чат и подготовка используют один `ensureProjectMainCurrent`.

## Что выяснили (факты, которых не было в KB)

- В zsh двоеточие после `$base` запускает разбор parameter modifier; `$base:refs` превращал `main:refs` в `mainefs`.

## Куда занесено

- `docs/kb/features/ci-runner.md`, раздел о подготовке к разработке.

## Открытые вопросы / что осталось

- Нет.
