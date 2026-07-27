---
title: project-chat-link
date: 2026-07-27
machine: 2470-com
author: server
---

# project-chat-link

## Что сделано

- Итерация 2 проектов (ветка feature/project-chat-link): папка проекта на каждую
  машину (project_machines.path), машина по умолчанию (projects.default_agent_id),
  привязка чата к проекту (conversations.project_id) с перезаписью машины/папки/
  навыков, фильтр машин в настройках чата по проекту, инъекция контекста проекта
  (git/технологии/навыки/описание) в промпт хода, кнопки сайдбара проводник/консоль
  открываются на эффективной машине+папке активного чата (папка — как директория).

## Что выяснили (факты, которых не было в KB)

- ProjectDetail теперь несёт machines[]{agentId,path} + defaultAgentId (вместо
  machineIds).
- setConversationProject перезаписывает exec_target/workdir/skill_names из проекта.
- openUtility ранее игнорировал workdir; добавлен openUtilityForActiveChat.
- FileExplorer раньше трактовал path как файл (открывал родителя); добавлен initialDir
  и ToolSpec.dir для открытия самой папки.

## Куда занесено

- docs/kb/projects.md (раздел «итерация 2»), docs/kb/machines.md (проводник/консоль).

## Открытые вопросы / что осталось

- project.skills (свободные теги) применяются в conversation.skillNames как есть;
  реально действуют лишь совпавшие с политикой машины (фильтр policySummary).
- Проекты одновладельческие для exec (мультиюзер-доступ к чужим машинам не делаем).
