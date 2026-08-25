---
title: manual-qa-machine-labels
date: 2026-08-25
machine: macbook-air-user
author: NikolayTola
---

# manual-qa-machine-labels

## Что сделано

- Актуализировано описание выбора машины подготовки и сверено текущее поведение формы ручного QA.

## Что выяснили (факты, которых не было в KB)

- `TaskPreparationTab` показывает trim-имя машины, использует `agentId` при пустом имени и не создаёт option для пустого `agentId`.
- Каждая карточка активного критерия ручного QA хранит независимый status/comment и сохраняет один из трёх пользовательских результатов; ошибка сохранения не уничтожает локальный ввод.

## Куда занесено

- `docs/kb/features/ci-runner.md`
- `docs/kb/features/task-preparation.md`
- Поведение ручного QA уже полностью отражено в `docs/kb/features/manual-qa.md`.

## Открытые вопросы / что осталось

- Нет.
