---
title: stand-seed-and-owner-gaps
date: 2026-11-14
machine: alexeys-macbook-air-tailae39a6-ts-net
author: alexeyrozhnov
---

# stand-seed-and-owner-gaps

## Что сделано

Сверены и актуализированы сведения о воспроизводимом PostgreSQL-дампе стенда,
remote checkout Kanban, границе фонового запуска Kanban и модульном Agent entry point.

## Что выяснили (факты, которых не было в KB)

Kanban передаёт task runtime `waitMs: 0`, поэтому занятое зеркало не задерживает
checkout: чужая живая блокировка сохраняется, а клон создаётся напрямую из origin.
`VC_KANBAN_BACKGROUND` отключает восстановление ранов и фоновые таймеры, но не
инициализацию, project knowledge reconciliation и обработку явных запросов.
`agent:README.md` — модульный ID для `sislex/agent/docs/kb/README.md`, а не
буквальное имя файла в Core.

## Куда занесено

- docs/kb/features/ci-runner.md
- docs/kb/projects.md
- docs/kb/modules.md
- docs/kb/features/project-knowledge-base.md
- docs/kb/architecture.md, conventions.md, deploy.md, testing-operations.md

## Открытые вопросы / что осталось

Нет.
