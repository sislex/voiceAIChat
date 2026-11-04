---
title: file-storage-contract
date: 2026-10-31
machine: alexeys-macbook-air-tailae39a6-ts-net
author: alexeyrozhnov
---

# file-storage-contract

## Что сделано

- Добавлен контракт сервиса хранения файлов `packages/shared/src/fileStorage.ts` и план `docs/plans/file-storage-service.md` с разбивкой на задачи FS-1…FS-5.

## Что выяснили (факты, которых не было в KB)

- Файлы чата сейчас лежат на машине пользователя (`<home>/ChatAI/...`), сервер только пересылает байты; общего интерфейса хранения нет.
- Make хранит проекты на локальном диске через конкретный класс `MakeWorkspaces`, без подменяемого бэкенда.
- Единственный числовой лимит пользователя в Identity сегодня — `llmLimitUsd`; квота хранилища пойдёт по тому же пути.

## Куда занесено

- docs/kb/protocol.md, раздел «File storage contract».

## Открытые вопросы / что осталось

- Реализация по задачам плана; выпуск архива `@voicechat/shared` для Core UI и Make.
