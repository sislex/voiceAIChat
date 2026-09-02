---
title: project-main-preflight-bootstrap
date: 2026-09-02
machine: alexeys-macbook-air-2
author: alexeyrozhnov
---

# Preflight общей копии проекта: автоклон и мягкая граница без привязки

## Что сделано

- `projectMainRefreshScript` при известном `gitUrl` клонирует репозиторий в пустой или отсутствующий `projectWorkdir`; непустой не-Git каталог по-прежнему отвергается без перезаписи.
- Проверка «это репозиторий» переведена с `test -d .git` на `rev-parse --show-toplevel` == каталог: принимаются каталоги от `git worktree add`, отвергаются подкаталоги чужих репозиториев.
- Чат Git-проекта на машине, не привязанной к проекту, больше не блокируется: preflight пропускается, модель получает предупреждение в промпте.
- Тесты: реальный клон в пустой/отсутствующий каталог, отказ без URL и на чужих файлах, linked worktree, чат без привязки (`taskPreparation.test.ts`, `turns.test.ts`).

## Что выяснили (факты, которых не было в KB)

- `materializeProjectMachine` создаёт `…/projects/<id>/worktree` пустым; ни CI (клонирует в `tasks/…`), ни релизы (`environments/…`), ни merge (`merge-clones`) в него не клонируют. Preflight из `4cc1886a` требовал там `.git` и падал у каждого проекта на проде: «Не удалось синхронизировать проект с origin: Рабочая директория проекта не является Git-репозиторием».
- `listUsableAgents(userId, projectId)` включает все машины пользователя, поэтому у свежего проекта без привязок ход идёт на его машину по умолчанию, а `getProjectMachine` для неё пуст — отсюда «Не настроена рабочая директория проекта: ход на устаревшем checkout запрещён».

## Куда занесено

- `docs/kb/machines.md` (раздел про preflight общей копии)
- `docs/kb/features/ci-runner.md`
- `docs/kb/features/task-preparation.md`

## Открытые вопросы / что осталось

- Нет.
