---
title: pin-core-ui-1-5-9-desktop-1-0-28
date: 2026-10-09
machine: alexeys-macbook-air-tailae39a6-ts-net
author: alexeyrozhnov
---

# pin-core-ui-1-5-9-desktop-1-0-28

## Что сделано

- Закреплены Core UI 1.5.9 (owner commit `2919342e`) и Desktop 1.0.28 (owner commit `1b3afd4a`, встраивает Core UI 1.5.9)
  через `scripts/release-composition.mjs apply`.

## Что выяснили (факты, которых не было в KB)

- Выпуск Core UI содержит только `@sislexa/core-ui`; `@sislexa/chat-ui` и `@voicechat/chat-app` закреплены отдельно
  (0.2.0) и `apply` их не трогает.

## Куда занесено

- docs/kb/clients.md — версии Web shell и Desktop.

## Открытые вопросы / что осталось

- Desktop 1.0.28 встраивает агента 0.23.0, Core закрепляет 0.24.0; выпуск Desktop с новым агентом — отдельно.
