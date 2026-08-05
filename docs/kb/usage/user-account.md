---
id: usage/user-account
title: Информация о пользователе
kind: runbook
updated: 2026-08-05
tags: [usage, settings, machines, projects]
aliases: [мои настройки, сколько я потратил, какие машины подключены, в каких проектах я участвую]
areas: [apps/server/src/kb/kbMcp.ts, apps/server/src/routes/rest.ts, packages/shared/src/protocol.ts]
symbols: [REST.usage, usageReport, user_settings]
protocols: [REST, MCP]
---

# Информация о пользователе

В чате модель может сама вызвать `mcp__kb__user_settings`, `mcp__kb__usage`, `mcp__kb__machines` и `mcp__kb__projects`. Все они привязаны к владельцу текущего хода: чужие данные, ключи и токены машин не выдаются.

## Настройки и чат

`Settings`: `model` (модель Claude), `whisperModel` (STT), `diarization`, `voice`, `micDeviceId`, `autoSpeak`, `showConsole`, `theme`, `onboarded`, `permissionMode`, `workdir`, `bargeIn`, `handsFree`, `execTarget`, `llmEngineId`, `llmProvider`, `codexModel`, `defaultAgentId`, `aiAssistProvider`, `aiAssistModel`, `aiAssistPrompts`. Их меняет экран «Настройки»: `GET/PUT REST.settings` (`/api/settings`); доступные движки — `GET REST.llmEngines`.

У чата отдельные `execTarget`, `workdir`, `skillNames`, `llmEngineId`, `llmProvider`, `llmModel`, `permissionMode`, `kbContextMode`, `projectId`. Их читают и меняют `REST.conversations`, `REST.conversation(id)`, `REST.conversationProject(id)`, `REST.conversationStatus(id)`. Приоритет: задача → проект → чат → пользователь → системный дефолт.

## Расход, машины и проекты

Личный расход: `GET REST.usage` (`/api/usage`), параметры `unit=hour|day|week`, `from`, `to`, `conversationId`; ответ содержит итоги, динамику UTC, модели и чаты, а `costIncomplete` означает неполный прайс.

Машины: `REST.agents`, `REST.agent(id)`, `REST.agentPolicy(id)`, `REST.agentToken(id)`, `REST.agentUpdate(id)`, `REST.agentFs*`, `REST.agentExec(id)`. Проекты: `REST.projects`, `REST.project(id)`, `REST.projectMembers(id)`, `REST.projectMachines(id)`, `REST.projectDefaultMachine(id)`, `REST.projectBoard(id)`, `REST.projectColumns*`, `REST.projectTasks*`. CI: `REST.projectCi(id)`, `REST.projectCiLlm(id)`, `REST.taskCi(id, taskId)`, `REST.taskCiLlm(id, taskId)`, `REST.ciMetrics(id)`, `REST.ciRunReport(runId)`; телеметрия БЗ — `REST.conversationKbUsage`, `REST.projectKbUsage`, `REST.ciRunKbUsage`, `REST.taskKbUsage`.

`REST.adminUsers`, `REST.adminUserUsage(name)`, `REST.adminUserConversations(name)` и `REST.adminUserMessages(name)` закрыты `requireAdmin`; обычному пользователю они недоступны.
