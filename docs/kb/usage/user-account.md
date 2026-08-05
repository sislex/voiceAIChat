---
id: usage/user-account
title: Информация о пользователе
kind: runbook
updated: 2026-08-05
checked: 5cad358
tags: [usage, settings, machines, projects]
aliases: [мои настройки, сколько я потратил, какие машины подключены, в каких проектах я участвую]
areas: [apps/server/src/kb/kbMcp.ts, apps/server/src/routes/rest.ts, packages/shared/src/protocol.ts]
symbols: [REST.usage, usageReport, user_settings]
protocols: [REST, MCP]
---

# Информация о пользователе

В чате модель может сама вызвать `mcp__kb__user_settings`, `mcp__kb__usage`, `mcp__kb__machines` и `mcp__kb__projects`. Все они привязаны к владельцу текущего хода: чужие данные, ключи и токены машин не выдаются.

## Настройки и чат

`Settings` определён в `packages/shared/src/types.ts`: 21 поле — выбор Claude (`model`) и Codex (`llmProvider`, `codexModel`, `llmEngineId`), STT/TTS (`whisperModel`, `diarization`, `voice`, `micDeviceId`, `autoSpeak`), поведение интерфейса и голосового диалога (`showConsole`, `theme`, `onboarded`, `bargeIn`, `handsFree`), исполнение (`permissionMode`, `workdir`, `execTarget`, `defaultAgentId`) и помощник ввода (`aiAssistProvider`, `aiAssistModel`, `aiAssistPrompts`). Экран «Настройки» читает и сохраняет полный объект через `GET/PUT REST.settings` (`/api/settings`); список разрешённых движков — `GET REST.llmEngines`.

У чата отдельные `execTarget`, `workdir`, `skillNames`, `llmEngineId`, `llmProvider`, `llmModel`, `permissionMode`, `kbContextMode`, `projectId`. Их читают и меняют `REST.conversations`, `REST.conversation(id)`, `REST.conversationProject(id)`, `REST.conversationStatus(id)`. Приоритет: задача → проект → чат → пользователь → системный дефолт. `mcp__kb__user_settings` получает полный снимок этих пользовательских настроек и вложенное эффективное состояние текущего чата после наследования; секретов в снимке нет. В текущем MCP наборе нет инструментов записи: модель может запросить эти сведения, но не изменить настройки от имени пользователя.

## Расход, машины и проекты

Личный расход: `GET REST.usage` (`/api/usage`), параметры `unit=hour|day|week`, `from`, `to`, `conversationId`; ответ содержит итоги, динамику UTC, модели и чаты, а `costIncomplete` означает неполный прайс.

Машины: `REST.agents`, `REST.agent(id)`, `REST.agentPolicy(id)`, `REST.agentToken(id)`, `REST.agentUpdate(id)`, `REST.agentFs*`, `REST.agentExec(id)`. Проекты: `REST.projects`, `REST.project(id)`, `REST.projectMembers(id)`, `REST.projectMachines(id)`, `REST.projectDefaultMachine(id)`, `REST.projectBoard(id)`, `REST.projectColumns*`, `REST.projectTasks*`. CI: `REST.projectCi(id)`, `REST.projectCiLlm(id)`, `REST.taskCi(id, taskId)`, `REST.taskCiLlm(id, taskId)`, `REST.ciMetrics(id)`, `REST.ciRunReport(runId)`; телеметрия БЗ — `REST.conversationKbUsage`, `REST.projectKbUsage`, `REST.ciRunKbUsage`, `REST.taskKbUsage`.

`REST.adminUsers`, `REST.adminUserUsage(name)`, `REST.adminUserConversations(name)` и `REST.adminUserMessages(name)` закрыты `requireAdmin`; обычному пользователю они недоступны.
