---
title: machines-roadmap-18
date: 2026-08-28
machine: alexeys-macbook-air-2
author: alexeyrozhnov
---

# machines-roadmap-18 — права участников на машину проекта

## Что сделано

- `machine_project_shares.access` (full/read), `machineAccess`/`canWriteAgent`, гейты exec/batch/fs-мутаций/copy-to/PTY, `AgentInfo.ownership`/`access`, UI (селект уровня, read-only проводник и консоль).
- Стенд: у участника при read — `fs list` 200, `exec`/`mkdir` 403; после подъёма до full — `exec` 200.

## Что выяснили

- Роль `developer` не имеет права `project:settings`, поэтому не может ни создавать проекты, ни менять шаринг своей машины — проверки шаринга делаются админским аккаунтом.

## Куда занесено

- docs/kb/machines.md — «Машина проекта vs личная: уровень доступа участников».
