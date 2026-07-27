---
title: codex-usage-explorer-address
date: 2026-07-27
machine: 2470-com
author: alexeyrozhnov
---

# codex-usage-explorer-address

## Что сделано

- Codex usage проведён через live-канал и сохранение TurnMeta.
- Счётчик input/output/cache добавлен в footer сохранённого AI-сообщения.
- В проводник добавлена редактируемая адресная строка с переходом по Enter.
- Добавлены тесты Codex CLI и UI.

## Что выяснили (факты, которых не было в KB)

- `codex exec --json` сообщает точный usage только в финальном `turn.completed`.
- Текущий каталог проводника можно безопасно редактировать отдельно от подтверждённого `cwd`.

## Куда занесено

- docs/kb/llm.md
- docs/kb/ui.md
- docs/kb/machines.md

## Открытые вопросы / что осталось

- Для роста точных счётчиков Codex во время генерации нужен промежуточный usage в JSONL самого CLI.
