---
title: core-github-token
date: 2026-10-06
machine: alexeys-macbook-air-tailae39a6-ts-net
author: alexeyrozhnov
---

# core-github-token

## Что сделано

- Сервис ядра `voicechat` получает `VC_GITHUB_TOKEN` из окружения прода (docker-compose.yml).

## Что выяснили (факты, которых не было в KB)

- После 0.1.412 модуль БЗ `voiceaichat` индексируется, а закрытый `make` падает: токен был только у сервиса `kanban`, в контейнере ядра его не было.

## Куда занесено

- docs/kb/features/project-knowledge-base.md

## Открытые вопросы / что осталось

- После следующего релиза проверить модули make, agent, readers и убрать дубль `voiceaichat`.
