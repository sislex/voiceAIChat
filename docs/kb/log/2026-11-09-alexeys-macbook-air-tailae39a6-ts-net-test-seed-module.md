---
title: test-seed-module
date: 2026-11-09
machine: alexeys-macbook-air-tailae39a6-ts-net
author: alexeyrozhnov
---

# test-seed-module

## Что сделано

- 15 писателей-фикстур (createCiRun, updateCiRun, setCiLlmConfig, updateProject, createColumn, setProjectDefaultMachine, transferTenant, addMember, updateMemberRole, updateTask, deleteTask, upsertEnvironment, setEnvironmentState, createProjectRelease, setProjectReleaseStatus) убраны из репозиториев ядра в тестовый модуль `apps/server/src/test/seed.ts`; вместе с ними ушли приватные recordTaskHistoryDiff и addReleaseEvent, у которых других вызовов не было.
- Тесты вызывают их как `dbSeed.<имя>(db, ...)`.

## Что выяснили (факты, которых не было в KB)

- Помощник ждёт `db.ready` и входит в полосу портов, но в отличие от порта всегда уступает ход: вызов без `await` больше не успевает раньше следующего вызова порта (один такой тест исправлен).

## Куда занесено

- docs/kb/architecture.md

## Открытые вопросы / что осталось

- После переноса без вызовов в продовом коде остаются читатели и другие писатели (например, setProjectMachinePath, getProjectRelease, getEnvironment); их стоит разобрать отдельной волной.
