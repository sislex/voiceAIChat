---
title: multiple-project-owners
date: 2026-08-14
machine: alexeys-macbook-air-2
author: alexeyrozhnov
---

# multiple-project-owners

## Что сделано

- Дополнена тема проектов точной сигнатурой единой серверной проверки владельца.

## Что выяснили (факты, которых не было в KB)

- `VoiceChatDb.isProjectOwner(userId, projectId)` принимает сначала пользователя, затем проект и проверяет роль `owner` в `project_members`, не `projects.created_by` и не отдельный `ownerId`.

## Куда занесено

- `docs/kb/projects.md`, раздел «Данные и доступ».

## Открытые вопросы / что осталось

- Нет.
