---
title: core-image-git
date: 2026-10-05
machine: alexeys-macbook-air-tailae39a6-ts-net
author: alexeyrozhnov
---

# core-image-git

## Что сделано

- Образ сервера ядра ставит `git`: без него модули базы знаний из других репозиториев не скачивались.

## Что выяснили (факты, которых не было в KB)

- На проде 0.1.411 модули `make` и `voiceaichat` (их зарегистрировал Kanban) в статусе `failed`: в контейнере нет `git`, не задан `VC_GITHUB_TOKEN`.

## Куда занесено

- docs/kb/features/project-knowledge-base.md

## Открытые вопросы / что осталось

- `VC_GITHUB_TOKEN` в окружении ядра на проде задаёт владелец.
