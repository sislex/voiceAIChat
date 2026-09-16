---
title: run-admission
date: 2026-09-16
machine: pc-radvilovich
author: voiceAIChat agent
---

# run-admission

## Что сделано

- Актуализирована тема автопрохода: описаны матрица отказов, сериализуемый snapshot допуска, retry/backoff и резервации.
- В `areas` темы добавлены файлы политики допуска и восстановления автопрохода.

## Что выяснили (факты, которых не было в KB)

- `classifyPipelineFailure` уже используется для распознавания dirty workspace.
- `admitPipelineRun` и `AdmissionReservations` пока используются только unit-тестами; сквозные production-пути к ним ещё не подключены.

## Куда занесено

- `docs/kb/features/task-autopilot.md`

## Открытые вопросы / что осталось

- Подключить общий допуск и резервации ко всем production-путям запуска, retry, очереди и смены машины.
