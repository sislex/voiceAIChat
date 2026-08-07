---
title: chat-preview-split-kb-gaps
date: 2026-08-07
machine: alexeys-macbook-air-2
author: alexeyrozhnov
---

# chat-preview-split-kb-gaps

## Что сделано

- Закрыты два пробела о подготовке MacBook для команд CI-раннера.

## Что выяснили (факты, которых не было в KB)

- GitHub SSH URL прозрачно переписывается в HTTPS глобальной настройкой Git; команда clone остаётся прежней.
- Неинтерактивный zsh агента получает `/usr/local/bin` через `~/.zshenv` и `launchctl`, поэтому видит установленные Node и npm.

## Куда занесено

- docs/kb/features/ci-runner.md

## Открытые вопросы / что осталось

- Нет.
