---
title: kanban-assistant-approvals
date: 2026-09-02
machine: alexeys-macbook-air-2
author: alexeyrozhnov
---

# Канбан-ассистент: снят блок подтверждений MCP, планы по событиям колонок

## Что сделано

- `codexCli.ts`: каждый HTTP-MCP регистрируется с `default_tools_approval_mode="approve"` (`mcpServerArgs`).
- `turns.ts`: `ro=1` для инструментов доски — только при явном `permissionMode: 'plan'` разговора; ход канбан-ассистента без машины для Claude идёт в `default` с запретом встроенных инструментов, для Codex — в `plan`.
- Оркестрация: новые шаги `wait_column` (по `semantic`/`columnId`) и `run_preparation`; `run_ci` принимает `provider/model/agentId/launch`; валидация плана и хинт модели обновлены.
- Тесты: codexCli (флаг одобрения), turns (режим прав канбан-хода), orchestration (wait_column, run_preparation, настройки run_ci), shared (валидация).

## Что выяснили (факты, которых не было в KB)

- Сообщение «Kanban API требует подтверждения доступа, но в текущей сессии подтверждения запрещены» — пересказ ошибки Codex `MCP tool call requires approval, but approval policy is never`; она возникает для любого MCP-инструмента в `codex exec`, включая read-only. `codex exec` не принимает `-a`, но принимает `-c approval_policy=…` (не помогает) и `-c mcp_servers.<name>.default_tools_approval_mode="approve"` (помогает). Воспроизведено на codex-cli 0.152 пробным MCP-сервером на `@modelcontextprotocol/sdk` (новый `McpServer` на каждый запрос, иначе «Already connected to a transport»).
- Прежняя формулировка KB «read-only sandbox блокирует HTTP-MCP» была неверна: блокировал механизм одобрений.
- Ход канбан-ассистента всегда идёт с `execTarget: 'none'`, поэтому `executionDisabled` форсил `plan` и доска получала `ro=1` — второй, независимый источник отказов.
- Завершение подготовки переводит задачу в колонку `ready` (`completeTaskPreparationRun`), поэтому «после подготовки» в плане — это `wait_column { semantic: 'ready' }`.

## Куда занесено

- `docs/kb/llm.md` — абзацы про Make без машины и режим plan
- `docs/kb/features/kanban-assistant.md` — «Автономия и подтверждения», оркестрация

## Открытые вопросы / что осталось

- Make без машины у не-admin на Codex по-прежнему получает `ro=1` от принудительного plan; с флагом одобрения его можно снять так же, как у канбана — отдельным шагом.
