---
title: make-preview-kb-verify
date: 2026-10-30
machine: pc-radvilovich-tailae39a6-ts-net
author: voiceAIChat agent
---

# make-preview-kb-verify

## Что сделано

- Сверены обязательные пробелы Make preview с текущим merge SHA `2d610322`.
- Подтверждена актуальность уже добавленных абзацев и обновлена свежесть трёх тем.

## Что выяснили (подтверждённые факты)

- Make без привязанного браузера получает preview MCP с токеном самого Make-разговора и surface `make-preview`; промпт требует `browser_capabilities` и объясняет `make_preview_closed`.
- Inspector-enabled stand lease внедряет Make inspector и preview executor; служебный путь получает executor Web Reader с сохранённым `parentOrigin` аренды и отвечает с `no-store`.
- Make входит в виды чатов с `mcp__browser__*`; привязанный Reader-браузер сохраняет приоритет и собственные `panel`/`chromium` маршруты.

## Куда занесено

- `docs/kb/features/make-browser.md`
- `docs/kb/server-internals.md`
- `docs/kb/llm.md`

## Открытые вопросы / что осталось

- Нет.
