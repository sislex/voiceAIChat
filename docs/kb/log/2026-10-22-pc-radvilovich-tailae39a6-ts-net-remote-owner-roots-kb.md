---
title: remote-owner-roots-kb
date: 2026-10-22
machine: pc-radvilovich-tailae39a6-ts-net
author: voiceAIChat agent
---

# remote-owner-roots-kb

## Что сделано

- Зафиксированы правила дополнительных owner-корней remote MCP и безопасного именования NUL-регрессии для task gate.

## Что выяснили (факты, которых не было в KB)

- Повторяемый URL-параметр `root` расширяет доступ `read/edit/grep` только на выбранной машине; относительные пути остаются привязаны к `cwd`.
- `task-gate.mjs` выводит Vitest `assertion.fullName` без экранирования, поэтому параметр теста с NUL попадает в лог.

## Куда занесено

- docs/kb/llm.md
- docs/kb/testing-operations.md

## Открытые вопросы / что осталось

- Нет.
