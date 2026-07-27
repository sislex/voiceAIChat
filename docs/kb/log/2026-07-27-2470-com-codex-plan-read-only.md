---
title: codex-plan-read-only
date: 2026-07-27
machine: 2470-com
author: server
---

# codex-plan-read-only

## Что сделано

- Убран remote MCP и опасный bypass у Codex в режиме `plan`.
- Добавлен регрессионный тест read-only запуска с выбранной машиной.

## Что выяснили (факты, которых не было в KB)

- Remote-ветка Codex безусловно включала `--dangerously-bypass-approvals-and-sandbox` и обходила режим разговора.

## Куда занесено

- `docs/kb/llm.md`

## Открытые вопросы / что осталось

- Нет.
