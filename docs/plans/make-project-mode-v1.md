# make-project-mode-v1 — Make работает с проектами пользователя и стендами

Ран `make-project-mode-v1`. Ветка задач — `dev`.

Владелец, 2026-10-07: Make делает маленькие проекты как сейчас, а большие — из любого проекта
пользователя, который у него настроен. Make подключает основной проект, понимает, какие в нём
подпроекты, находит стили, компоненты и токены (например, Sislexa UI), позволяет изменить компонент,
подготовить вариант стилей для этого проекта или подготовить компоненты к переносу в Sislexa (ChatAI).
Правки можно делать прямо на стенде: Make даёт команду стенду развернуться и править «вживую».
Если в проекте настроен git — появляются кнопки pull, push, commit, новая ветка. Всё то же — из ассистента.

## Решения владельца

1. Маленькие проекты (мастерские Make) работают как сейчас; их варианты стилей хранятся как сейчас.
2. Подключённый проект: вариант стилей хранится в самом проекте (файл темы на ветке проекта).
3. Сайт в режиме проекта показывается как сейчас (превью Make) или на выбранном стенде.
4. Перенос в Sislexa — задачей на доске ChatAI: дизайн из Make плюс ветка в Core UI или UI Kit; дальше
   обычный конвейер с гейтами.

## Шаги интегратора

- После приёмки B01: собрать архив `@voicechat/make-contracts` с новым портом (версия поднимается
  интегратором) и закрепить его в ядре (`vendor/voicechat-make-contracts-<версия>-<sha>.tgz`, три
  `package.json`, `npm install`), затем настроить C01. Воркеры версию контрактов не меняют.
- Задачи Make C02–C04 идут одна за другой (общие файлы панели); база берётся в момент выдачи.

## Что есть сейчас

- Make: мастерская на разговор, импорт ZIP/публичного GitHub, витрина stories, токены мастерской
  (`makeTokens.ts`, `MakeTokensDialog.tsx`), вкладка «Проект» для разговора с `projectId` (Storybook
  проекта на машине, правка рабочей копии через `projects:gitFile`/`projects:gitSaveFile`), быстрый тикет
  к слиянию, «Дизайн из Make в карточке» (`task_designs`). Порт ядра — `MakeCore`
  (`packages/make-contracts/src/core.ts`), реализация в ядре — `makeBridge` (локально и RPC
  `/internal/make/core`). Списка проектов пользователя в порте нет; токены и тему проекта Make не ищет.
- Ядро: git в рабочей копии проекта — `/api/projects/:id/git/*` (status, branches, branch, checkout,
  commit, pull, push, diff, file, stage, discard, conflict, resolve, log).
- Kanban: стенды разработки — `POST /api/projects/:id/dev-stands`, подмена компонента на ветку или SHA
  (`POST /:standId/components/:component`), адреса шлюза в `GET /:standId`. Правки «вживую» без коммита
  нет.
- Токены Sislexa UI: ссылки на переменные в `packages/ui-kit/src/designTokens.ts`; значения цветов —
  в Core UI `packages/ui/src/styles/app.css` (`:root`, `[data-theme=…]`).

| B01 | Make | — | Project mode contracts in packages/make-contracts. Extend the `MakeCore` port with: `listProjects(user)` → projects the user can view (`{id, name, type, gitUrl, hasGit, machines, defaultAgentId, role}`); `projectStructure(user, projectId)` → subprojects found in the project working copy (`{path, name, kind: 'app'\|'library'\|'storybook'\|'other', packageName?, stories: number, styleFiles: string[]}` from package.json workspaces, `apps/*`, `packages/*`); `projectDesign(user, projectId, subprojectPath)` → design inventory (`tokens`: CSS custom properties with values from `:root` and `[data-theme=…]` blocks of css/scss files plus TS/JSON token maps, with file and line; `themes`: theme names; `components`: stories and exported components with file paths); `projectGit(user, projectId, op)` for status, branches, pull, commit, push and new branch on the project working copy; `standPreview(user, projectId, …)` for stand start/status/URL (see Kanban B02); `createTransferTask(user, {targetProjectId, targetRepository: 'core-ui'\|'ui-kit', title, files, designConversationId})`. Types, zod schemas, a fake implementation for Make tests, and docs/kb. No UI. Gate: `npm run gate:task -- --base <sha>`. |
| B02 | Kanban | — | Live edit on development stands. Add a live mode for a stand component: `POST /api/projects/:id/dev-stands/:standId/components/:component/live {workingCopyPath}` makes the stand run that component's dev server from the project working copy on the stand machine (hot reload) instead of a frozen branch or SHA; `DELETE …/live` returns to the previous override; `GET /:standId` reports the live component, its working copy and gateway URL. Only project owners and developers; the working copy must belong to the project on that machine; the existing durable job and audit rules apply. Tests for start, status, stop, authorization and path validation. Update docs/kb (environments-service). Gate: `npm run gate:task -- --base <sha>`. |
| C01 | Core | B01, B02 | Core implements the new `MakeCore` methods (local and the remote `/internal/make/core` RPC): `listProjects` from the projects service with the user's role; `projectStructure` and `projectDesign` by reading the project working copy through the existing machine file access (read-only, bounded size and file count; parse CSS custom properties in `:root` and `[data-theme=…]`, TS/JSON token maps, `*.stories.*` and package entry exports); `projectGit` by calling the existing project git service (`/api/projects/:id/git/*` logic) with its authorization (`repository:write` for writes, protected branches refused); `standPreview` by calling Kanban dev stands including live mode (B02); `createTransferTask` creates a task on the target project's board with a Make design link (`task_designs`) and a new branch in the chosen repository (Core UI or UI Kit) containing the selected files. Expose the same operations to the assistant as MCP tools (list projects, project structure and design, git status/pull/commit/push/new branch, stand start/status, transfer task). Tests for each method, authorization, bounds and MCP tool schemas. Update docs/kb. Gate: `npm run gate:task -- --base <sha>`. |
| C02 | Make | B01, C01 | Project mode in Make: next to «Маленький проект» a «Проект» source lets the user pick any configured project (`listProjects`); show its subprojects (`projectStructure`); a design panel lists tokens with values and themes and components (`projectDesign`); editing a component or style writes to the project working copy; a style variant for a connected project is saved inside the project as a theme file (`themes/<name>.css` in the chosen subproject, overriding the discovered variables) — small projects keep today's storage; when the project has git, show controls status, pull, commit (message), push and new branch (`projectGit`), with errors and protected branches surfaced. Tests (DOM and API) for picking, structure, design panel, variant save, git controls hidden without git. Update docs/kb. Gate: `npm run gate:task -- --base <sha>`. |
| C03 | Make | C02 | Stand view in project mode: the site is shown either as today (Make preview) or on a chosen development stand; «Развернуть на стенде» starts a stand for the project (or reuses one) through `standPreview`, enables live mode for the edited subproject so Make edits appear on the stand with hot reload, shows stand status and gateway URL, and can stop live mode. Tests for choosing preview vs stand, start/status/stop and error states. Update docs/kb. Gate: `npm run gate:task -- --base <sha>`. |
| C04 | Make | C02 | Transfer to Sislexa: in project mode the user selects components, styles or a style variant and «Перенести в Sislexa» creates, through `createTransferTask`, a task on the ChatAI board with the Make design link and a branch in Core UI or UI Kit with the selected files (user chooses the target repository); the task then follows the normal pipeline. Show the created task and branch with links. Tests for selection, target choice, created task links and failures. Update docs/kb. Gate: `npm run gate:task -- --base <sha>`. |
