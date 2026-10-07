# board-subproject-view-v1 — доска проекта с задачами подпроектов

Ран `board-subproject-view-v1`. Ветка задач — `dev`.

Владелец, 2026-10-07: в Sislexa на канбан-доске должна быть возможность видеть задачи подпроектов. Меню
«Проекты» со списком: основной проект и его подпроекты, выбор чекбоксами. Выбраны все — видны задачи
всех выбранных проектов. По умолчанию отмечен только проект, в который зашли, подпроекты сняты. На
карточке видно, к какому проекту относится задача.

## Что есть сейчас

- Проекты плоские: связи «основной проект — подпроект» нет. На проде у admin 17 проектов Sislexa
  (по одному на репозиторий, см. [board-subprojects-v1](board-subprojects-v1.md)); основной — Sislexa.
- Доска: `GET /api/projects/:id/board` (Kanban, `apps/server/src/routes/projects.ts`) отдаёт
  `Board {columns, tasks, ciRuns}` одного проекта; состояние карточек приходит второй фазой
  (`TaskStatus`). Колонки у проектов свои, но у каждой есть `semanticType`.
- UI доски — Core UI: `packages/ui/src/modules/projects/components/ProjectBoard.tsx`,
  `kanban/KanbanBoard.tsx`, карточка `kanban/NewTaskCardView.tsx`.
- Контракты — `packages/shared` ядра (источник), архивом у Kanban и Core UI; копия shared в Kanban
  обязана совпадать с архивом.

## Решения

1. У проекта может быть один основной проект (`parentProjectId`), глубина 1; связь задаёт владелец
   обоих проектов.
2. Доска основного проекта по запросу включает задачи выбранных подпроектов: каждая задача подпроекта
   ставится в колонку основной доски с тем же `semanticType` (иначе — в первую видимую), перетаскивание
   таких карточек меняет их статус в их собственном проекте по тому же `semanticType`.
3. Выбор проектов хранится в браузере на пользователя и проект; по умолчанию — только текущий проект.

## Шаги интегратора

- После B01: собрать архив Shared и закрепить в ядре, Kanban (включая копию shared) и Core UI, затем
  настроить C01 и C02 (они идут параллельно).
- После C01: выставить `parentProjectId = Sislexa` шестнадцати проектам на проде.

| B01 | Core | — | Subproject contracts in `packages/shared`. `Project`/`ProjectSummary` gain `parentProjectId: string \| null` and `ProjectSummary.subprojectCount: number`; project update input accepts `parentProjectId` (string or null); new `ProjectSubprojectSummary {id, name, role}` and REST path `subprojects(projectId)` → `GET /api/projects/:id/subprojects`; board request accepts `projects` (list of project ids: the project itself and/or its subprojects) — `REST.board(projectId, {projects})` builds `?projects=a,b`; `Board` gains `projects: {id, name}[]` (projects whose tasks are included) and `Task` on a board gains optional `displayColumnId` (column of the requested board where a subproject task is shown); `TaskStatus` requests accept the same `projects` list. Pure helper `subprojectColumnFor(semanticType, columns)` (same semantic type, else first visible column) with tests. Keep message-type registries in sync. Update docs/kb (protocol, projects). Gate: `npm run gate:task -- --base <sha>`. |
| C01 | Kanban | B01 | Subprojects in the Kanban service. Storage migration `projects.parent_project_id` (SQLite and Postgres, nullable, index); `PATCH /api/projects/:id` accepts `parentProjectId`: caller must be owner of both projects, no self-reference, no cycles, depth 1 (a project with subprojects cannot get a parent; a subproject cannot have subprojects), `null` detaches; `GET /api/projects/:id/subprojects` lists subprojects the caller can view; project list and detail return `parentProjectId` and `subprojectCount`. `GET /api/projects/:id/board?projects=...` accepts only `:id` and its subprojects the caller can view (others → 403), returns tasks of all requested projects, each subproject task with `projectId` and `displayColumnId` via `subprojectColumnFor`, and `projects`; the second-phase task status endpoint accepts the same list; moving a subproject card to a column of the parent board applies the mapped column of the task's own project (`semanticType`) and is authorized against the task's project. Board change events of a subproject also notify viewers of the parent board. Update the Kanban shared copy to the pinned Shared archive. Tests: parent assignment rules, subprojects listing, board aggregation and permissions, column mapping, move authorization, events. Update docs/kb. Gate: `npm run gate:task -- --base <sha>`. |
| C02 | Core UI | B01 | Board project filter in Core UI. On the project board toolbar add a «Проекты» menu (shown when the project has subprojects): a list with the current project first and its subprojects, each with a checkbox and task count; default only the current project checked; the selection is saved per user and project in local storage and restored; «Все» checks all. The board requests `REST.board(id, {projects})` with the checked ids and renders subproject tasks in `displayColumnId`; each card shows a project badge (name, stable color per project) when more than one project is selected, and the task opens in its own project. Drag and drop of subproject cards calls the move of the task's own project. Tests (DOM): menu hidden without subprojects, default selection, toggling and «Все», persistence, badge shown/hidden, card opens the right project, move request target. Stories for the menu and the badged card. Update docs/kb (projects board and task). Gate: `npm run gate:task -- --base <sha>`. |
