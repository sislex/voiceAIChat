---
title: design-links-make
date: 2026-08-31
machine: alexeys-macbook-air-2
author: alexeyrozhnov
---

# design-links-make

## Что сделано

- Связь карточки доски с дизайном из Make: таблица `task_designs`, контракт
  (`TaskDesignLink`, `ProjectDesignSource`, `MakeTaskLink`, `MakeLinkableTask`),
  REST `/api/projects/:id/tasks/:taskId/designs`, `/api/projects/:id/design-sources`,
  `/api/make/:id/task-links[/tasks]`, мосты `tasks:*Design` / `projects:designSources` /
  `make:taskLinks|linkTask|linkableTasks`.
- UI: секция «Дизайн» в карточке (`kanban/TaskDesigns.tsx`) и диалог «Задачи проекта»
  в панели Make (`MakeTaskLinksDialog.tsx`, пункт меню «⋯»).
- Дизайн уходит модели: `designPromptLines` в блоке «Контекст задачи» хода чата
  (`turns.ts`) и в `taskPrompt` CI-рана (`ci/modelHooks.ts`).

## Что выяснили (факты, которых не было в KB)

- Превью Make (`GET /api/preview/make/:id/*`) до этой работы пускало только владельца
  разговора (`own`), поэтому связанный с карточкой макет у остальных участников не
  открылся бы вовсе. Теперь маршрут проверяет `access(…, 'viewer')`, а `viewer`
  дополнительно получает участник проекта, к которому привязан Make-чат
  (`VoiceChatDb.isMakeProjectViewer`).
- `BoardHub` создаётся в `server.ts` ниже регистрации make-роутов, поэтому живая
  доска после связывания из панели Make прокидывается ленивым колбэком
  `MakeRoutesDeps.boardChanged`.
- `getCiTask` возвращает `Task` — того же типа, что и доска, поэтому дизайны
  доезжают до промпта CI-рана без отдельного контракта.

## Куда занесено

- docs/kb/projects.md — раздел «Дизайн из Make в карточке»
- docs/kb/protocol.md — «Дизайн карточки ↔ Make (2026-08-31)»
- docs/kb/ui.md — «Дизайн ↔ карточка доски» в разделе Make

## Открытые вопросы / что осталось

- Связь адресует живой проект; закрепление снимка («дизайн на момент постановки»)
  сознательно не делали — при необходимости это отдельное поле `snapshot_id`.
- Чипа дизайна на карточке доски нет: в снапшот доски `designs` не кладём.
