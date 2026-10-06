---
title: dev-process-clone-url
date: 2026-10-06
machine: alexeys-macbook-air-tailae39a6-ts-net
author: alexeyrozhnov
---

# dev-process-clone-url

## Что сделано

- Ядро разворачивает сокращение `owner/name` из реестра компонентов стенда в адрес клонирования GitHub перед `devProcess.start`.

## Что выяснили (факты, которых не было в KB)

- Первый стенд разработки на M1 (базовое окружение dev-base из снимка прода) не создался: агент выполнил `git clone sislex/voiceAIChat` и получил «repository does not exist».

## Куда занесено

- docs/kb/machines.md

## Открытые вопросы / что осталось

- Заработает после релиза 0.1.413; затем создать стенд разработки и проверить сценарий владельца.
