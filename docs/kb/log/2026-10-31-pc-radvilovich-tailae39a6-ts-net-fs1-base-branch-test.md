---
title: fs1-base-branch-test
date: 2026-10-31
machine: pc-radvilovich-tailae39a6-ts-net
author: voiceAIChat agent
---

# fs1-base-branch-test

## Что сделано

- Воспроизведено падение parseOptions с BASE_BRANCH=dev: фактическая база origin/dev расходилась с жёстким ожиданием origin/main.
- Тест сохраняет и восстанавливает BASE_BRANCH, проверяет отсутствие переменной, пустое значение, dev и приоритет --base/--worktree. Рабочая логика и команда гейта не изменены.
- Весь scripts/affected-check.test.mjs с BASE_BRANCH=dev: 65 тестов прошли. Отдельная проверка parseOptions без BASE_BRANCH также прошла.
- Инструмент run_targeted_tests недоступен; точечные проверки выполнены через remote:bash.

## Что выяснили (факты, которых не было в KB)

- parseOptions использует origin/${BASE_BRANCH}, с main при пустой или отсутствующей переменной; --base и --worktree имеют приоритет над окружением и взаимно исключаются.

## Куда занесено

- docs/kb/testing-operations.md — Task gate for the dev lane.

## Открытые вопросы / что осталось

- Полный gate:task повторит workflow; в этом ходе полный гейт не запускался.
