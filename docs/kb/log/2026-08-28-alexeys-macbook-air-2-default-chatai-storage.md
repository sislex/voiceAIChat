---
title: default-chatai-storage
date: 2026-08-28
machine: alexeys-macbook-air-2
author: alexeyrozhnov
---

# default-chatai-storage

## Что сделано

- `apps/server/src/agents/defaultStorage.ts`: `ensureDefaultStorage` (каталог `<home>/ChatAI` при подключении машины) и
  `ensureDefaultChatBinding` (привязка чата по рекомендуемому пути перед первой записью файла).
- `AgentRegistry.onAgentReady` — хук первой телеметрии; `db.agentOwnerId`.
- `turns.ts` (`deps.ensureChatStorage`) и обёртка `managedChatStorage` в `server.ts` привязывают чат по умолчанию.
- Удалены упоминания старого прод-пути `/root/voiceAIChat` (AGENTS.md, deploy.md, releases.md): прод-каталог — `target.path` из Release Center.

## Что выяснили (факты, которых не было в KB)

- Файлы чата без привязки раньше уходили в `<корень проводника>/.generated_images` машины хода — так файл оказался в `~/.generated_images` на MacBook.

## Куда занесено

- docs/kb/machines.md — «Каталог ChatAI по умолчанию».

## Открытые вопросы / что осталось

- Релиз с этим кодом ждёт возврата прод-агента в сеть (сборка 0.1.174 упала «Машина не в сети»).
