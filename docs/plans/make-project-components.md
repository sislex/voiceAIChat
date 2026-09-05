# Make → компоненты реального проекта (просмотр, правка, тикет к мержу)

Задача: Make сегодня работает только со своей песочницей (`<dataDir>/make/<conversationId>`)
и своим мини-раннером сториз. Нужно, чтобы из Make можно было открыть компоненты
**реального проекта** (рабочая копия репозитория на машине), смотреть их в **настоящем
Storybook проекта**, править файл и одной кнопкой заводить тикет, который сразу
доступен к слиянию через канбан.

Решения (согласованы с пользователем):
* источник кода — **рабочая копия на машине** (`projects:git*`, `GitWorkspaceService`), без копирования в песочницу;
* просмотр — **Storybook dev-сервер на машине** (`npm run storybook`), кадр отдаётся same-origin
  через уже существующий прокси `/api/preview?url=http://<agentId>.machine.internal:<port>/…`;
* тикет — задача + ветка + коммит + push + запись `ci_workspaces(pushed=1)` + колонка `awaiting_merge`,
  дальше штатная кнопка «Мерж в main» merge-рана.

## Что переиспользуется (не пишем заново)

| Кирпич | Где |
|---|---|
| Рабочие копии, git-операции, права, локи, аудит | `apps/server/src/git/workspaceService.ts` (`resolve/file/saveFile/createBranch/commit/push`), `apps/server/src/git/scripts.ts` |
| Каналы моста файлов репозитория | `projects:gitTree|gitFile|gitSaveFile|gitStatus|gitGrep` (`packages/shared/src/ipc.ts`) |
| HTTP-мост к порту машины + same-origin iframe | `apps/server/src/routes/previewProxy.ts` (`<agentId>.machine.internal`), cookie `session:ensurePreview` |
| Живой процесс с логом и остановкой | PTY-сессии `AgentRegistry.ptyStart/ptyInput/ptyKill/ptyBufferText/ptyLive` |
| Проба готовности порта | `AgentRegistry.http(agentId, {method,port,path})` |
| Редактор и диф | `packages/ui/src/components/CodeEditor.tsx`, `CodeDiff.tsx` |
| Создание задачи и слияние | `db.createTask`, `db.moveTask`, `db.createCiWorkspace`, `POST /api/projects/:id/tasks/:taskId/merge` |

## Этапы

1. **Контракт** — `packages/shared/src/projectComponents.ts`: `ProjectComponentEntry`,
   `ProjectStorybookSession`, `PROJECT_STORYBOOK_DEFAULT_PORT`, `storybookStoryId`,
   `projectStorybookFrameUrl`; каналы `projects:components*` в `ipc.ts`, пути в `protocol.ts`.
2. **Сервер** — `apps/server/src/components/storybookSessions.ts` (менеджер сессий поверх PTY:
   старт в каталоге рабочей копии, проба `/index.json`, лог, стоп) и роуты
   `apps/server/src/routes/projectComponents.ts`:
   `GET …/components`, `GET|POST …/components/storybook`, `POST …/components/ticket`.
   Список компонентов: живой Storybook → `/index.json` (настоящие storyId), иначе
   `git ls-files '*.stories.*'` через новый метод `GitWorkspaceService.storyFiles`.
3. **UI-просмотр** — вкладка «Проект» в `MakePane` поверх нового
   `packages/ui/src/components/MakeProjectComponents.tsx`: выбор рабочей копии,
   список компонентов, запуск/остановка Storybook со статусом и логом, кадр стори в iframe.
4. **UI-правка** — тот же `CodeEditor`: чтение `projects:gitFile`, запись `projects:gitSaveFile`,
   после сохранения — перезагрузка кадра (HMR через прокси не проходит, это осознанно).
5. **Тикет к мержу** — диалог «Создать задачу из правки»: сервер создаёт задачу в колонке
   `awaiting_merge`, делает ветку по `ci_branch_template`, коммит выбранных путей, push,
   пишет `ci_workspaces(pushed=1)` и возвращает рабочую копию на базовую ветку.
6. **KB + гейт** — `docs/kb/ui.md`, `docs/kb/projects.md`, журнал `docs/kb/log/`, `npm run gate`.

## Ограничения, которые честно показываем в интерфейсе

* Storybook живёт в PTY-сессии: политика машины `ptyIdleMinutes` может её закрыть, офлайн машины — тоже.
* Прокси не пропускает WebSocket → HMR не работает; после сохранения кадр перезагружается сам.
* Ответ прокси ограничен 5 МиБ, таймаут 10/15 с — первую загрузку «прогреваем» пробой `/index.json`.
* Быстрый путь «правка → тикет → мерж» минует подготовку, CI и QA: это осознанный режим мелкой правки,
  merge-ран со своими проверками (тесты, БЗ, конфликты) остаётся обязательным.
