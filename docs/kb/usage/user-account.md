---
id: usage/user-account
title: Информация о пользователе
kind: runbook
updated: 2026-08-13
checked: aecf8a0
tags: [usage, settings, machines, projects]
aliases: [мои настройки, сколько я потратил, какие машины подключены, в каких проектах я участвую]
areas: [apps/server/src/kb/kbMcp.ts, apps/server/src/routes/rest.ts, apps/server/src/turns.ts, packages/shared/src/types.ts, packages/ui/src/components/SettingsPage.tsx]
symbols: [REST.usage, usageReport, user_settings]
protocols: [REST, MCP]
---

# Информация о пользователе

В чате модель может сама вызвать `mcp__kb__user_settings`, `mcp__kb__usage`, `mcp__kb__machines` и `mcp__kb__projects`. Все они привязаны к владельцу текущего хода: чужие данные, ключи и токены машин не выдаются.

## Настройки и чат

`Settings` определён в `packages/shared/src/types.ts`: выбор Claude/Codex, STT/TTS, поведение интерфейса и голосового диалога, исполнение, помощник ввода и вложенный объект `personalization`. Экран «Настройки» и отдельная страница `#/personalization` читают и сохраняют полный объект через `GET/PUT REST.settings` (`/api/settings`); ключ `app:<userId>` в SQLite изолирует его по владельцу сессии. Сервер нормализует пробелы обращения, ограничивает его 80 символами, проверяет диапазоны и календарную корректность полной даты; частичная дата допустима. Дефолты персонализации: без обращения и даты, автоязык, обычный стиль, нейтральный тон. Пользовательский выбор LLM вынесен в отдельный таб `LLM`; форму исполнителя/provider/model рисует общий `LlmSettingsEditor`, который также используется проектом и чатом.

`turns.ts` добавляет сохранённую персонализацию в `basePrompt` каждого обычного пользовательского хода до общего вызова Claude/Codex. Передаются короткие инструкции обращения, языка, стиля и тона; дата рождения целиком не передаётся — только вычисленный возраст, если указан год. В самом блоке закреплён приоритет: явное указание текущего сообщения → настройки разговора/проекта → персонализация → дефолт. CI-раны идут отдельным путём и этот блок не получают; изменение действует только после сохранения и не переписывает сообщения истории.

У чата отдельные `execTarget`, `workdir`, `skillNames`, `llmEngineId`, `llmProvider`, `llmModel`, `permissionMode`, `kbContextMode`, `projectId`. Их читают и меняют `REST.conversations`, `REST.conversation(id)`, `REST.conversationProject(id)`, `REST.conversationStatus(id)`. Для LLM приоритет: собственное переопределение чата → эффективная настройка проекта → настройка пользователя → системный дефолт; `null` в LLM-полях чата означает динамическое наследование, поэтому смена проекта или пользовательского дефолта не требует копировать значения в разговор. `mcp__kb__user_settings` получает полный снимок этих пользовательских настроек и вложенное эффективное состояние текущего чата после наследования; секретов в снимке нет. В текущем MCP наборе нет инструментов записи: модель может запросить эти сведения, но не изменить настройки от имени пользователя.

## Расход, машины и проекты

Личный расход: `GET REST.usage` (`/api/usage`), параметры `unit=hour|day|week`, `from`, `to`, `conversationId`; ответ содержит итоги, динамику UTC, модели и чаты, а `costIncomplete` означает неполный прайс.

Машины: `REST.agents`, `REST.agent(id)`, `REST.agentPolicy(id)`, `REST.agentToken(id)`, `REST.agentUpdate(id)`, `REST.agentFs*`, `REST.agentExec(id)`. Проекты: `REST.projects`, `REST.project(id)`, `REST.projectMembers(id)`, `REST.projectMachines(id)`, `REST.projectDefaultMachine(id)`, `REST.projectBoard(id)`, `REST.projectColumns*`, `REST.projectTasks*`. CI: `REST.projectCi(id)`, `REST.projectCiLlm(id)`, `REST.taskCi(id, taskId)`, `REST.taskCiLlm(id, taskId)`, `REST.ciMetrics(id)`, `REST.ciRunReport(runId)`; телеметрия БЗ — `REST.conversationKbUsage`, `REST.projectKbUsage`, `REST.ciRunKbUsage`, `REST.taskKbUsage`.

`REST.adminUsers`, `REST.adminUserUsage(name)`, `REST.adminUserConversations(name)` и `REST.adminUserMessages(name)` закрыты `requireAdmin`; обычному пользователю они недоступны.
