---
title: pin-agent-0-22-1
date: 2026-10-04
machine: alexeys-macbook-air-tailae39a6-ts-net
author: alexeyrozhnov
---

# pin-agent-0-22-1

## Что сделано

- Закреплён агент 0.22.1 (контракты 1.2.1): `run.sh` подключает `~/.voicechat-agent/agent.env`.

## Что выяснили (факты, которых не было в KB)

- Обновление агента перезаписывает `run.sh` и plist launchd: `DOCKER_CONFIG` из plist пропал после
  обновления до 0.22.0. Настройки оператора теперь в `agent.env`, который установщик не трогает.

## Куда занесено

- docs/kb/deploy.md — Docker агента на macOS.

## Открытые вопросы / что осталось

- Релиз ядра и обновление агентов до 0.22.1.
