---
title: projects-kanban
date: 2026-07-27
machine: 2470-com
author: server
---

# projects-kanban

## Что сделано

- Реализован режим «Проекты» + канбан-доска (ветка feature/projects-kanban,
  влита в main). Слои: shared-контракт, БД+гейты по членству, роуты, WS-realtime,
  UI (оверлеи + доска с нативным DnD). Собрано и проверено в изолированном docker
  (проект voicechat-feat1, порт 8801).
- Вливал свежий main (фича «project knowledge base», 49ded98): 4 конфликта
  (index.ts, ipc.ts, Sidebar.tsx, app.css) — все типа «оставить обе стороны»,
  фичи сосуществуют.

## Что выяснили (факты, которых не было в KB)

- Первая многопользовательская сущность: доступ по членству (project_members),
  а не по единственному user_id. Гейты isProjectMember/isProjectOwner.
- Колонка = статус задачи; порядок — дробный ранг REAL с ренормализацией.
- Живой board.update по WS через BoardHub (эмиттер, как AgentRegistry.onChange).

## Куда занесено

- docs/kb/projects.md — новая тема (полное описание подсистемы).
- AGENTS.md — строка-указатель в таблице KB.
- docs/kb/protocol.md, docs/kb/data-auth.md — кросс-ссылки на projects.md.

## Открытые вопросы / что осталось

- protocol.md / data-auth.md / architecture.md всё ещё помечены kb:check как
  требующие сверки — частично из-за фичи KB (kb:*-каналы, kb-контекст в разговоре),
  которую документирует её автор. Мои изменения вынесены в projects.md.
- Прод-контейнер (voiceaichat-voicechat-1) не пересобирался — деплой по отдельной
  команде пользователя (npm run docker рвёт live-сессию).
