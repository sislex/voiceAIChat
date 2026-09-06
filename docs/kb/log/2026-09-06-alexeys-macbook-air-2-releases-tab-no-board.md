---
title: releases-tab-no-board
date: 2026-09-06
machine: alexeys-macbook-air-2
author: alexeyrozhnov
---

# releases-tab-no-board

## Что сделано

- `projectsStore`: `openProject(id, { board })` + `ensureBoard(id)`; `openBoard`
  стал обёрткой. Вкладки без канбана (`releases`, `settings`, `code`) грузят
  только `projects:get`.
- `App.tsx`: `routeNeedsBoard` по разобранному маршруту решает, звать
  `openProject` с доской или без; возврат на «Канбан» — `ensureBoard`.
- Тесты: два кейса в `appRuntime.projects.test.ts` (без доски → только детали;
  `ensureBoard` не дублирует запросы и открывает чужой проект целиком) и
  dom-кейс в `App.projects.dom.test.tsx` (`#/projects/:id/releases` не зовёт
  `board:get`, клик по «Канбан» зовёт ровно один раз).

## Что выяснили (факты, которых не было в KB)

- На вкладке релизов уходило 4 лишних запроса (`board:get`, `board:getView`,
  `board:getStatuses`, при включённом «показывать завершённые» — второй
  `board:get?includeCompleted=1`) плюс WS-подписка `board.changed`: на проекте
  с работающим раном она перечитывала доску каждые пару секунд.
- Жалоба на `/api/conversations*` с той же страницы относится к уже влитому в
  `main` коммиту `f222dc9c` (`skipConversations` в `AppRuntimeHost`): прод на
  0.1.246 (`7a0ac158`) его ещё не содержит — лечится выкаткой, а не кодом.
- `refreshConversations` в `@voicechat/chat-app` сам выходит, пока индекс чатов
  не загружен, поэтому `syncSidebarProjects` из `App.tsx` на проектных
  маршрутах запросов не делает.

## Куда занесено

- docs/kb/projects.md — раздел «Фронтенд».

## Открытые вопросы / что осталось

- На вкладках без доски палитра команд не покажет пункты задач (нет
  `board.tasks`). Если это заметят — догружать доску по открытию палитры.
