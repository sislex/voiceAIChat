---
title: Frontend-модуль Operations: граница, store и подключение
updated: 2026-08-19
checked: 437c35b3
areas:
  - packages/operations-app
  - packages/ui/src/App.tsx
  - packages/ui/src/moduleRegistry.ts
  - packages/app-shell
  - packages/ui/.storybook/main.ts
  - packages/ui/package.json
---

# Frontend-модуль Operations: граница, store и подключение

## Что выделено

Workspace `@voicechat/operations-app` находится в `packages/operations-app` и экспортирует только корень пакета и `./styles.css`; публичный список см. в `src/index.ts`. Пакет содержит контракты, React-независимый store, route parser/builder, navigation model, path helpers, diagnostic redaction, React context/hooks и именованные surface-компоненты. Он зависит от `@voicechat/shared`, `@voicechat/ui-kit` и React, не имеет отдельного Vite entry, контейнера или deploy.

Это пока архитектурный срез, а не полный перенос существующего Operations UI. `src/surfaces.tsx` реализует Machines, MachineUtility, Explorer, LlmHistory, KnowledgeBase, CiMonitor и Diagnostics как общую секционную оболочку с заголовком и `children`; продуктовая логика и terminal emulator остаются в legacy-компонентах `packages/ui`. Новый `packages/ui/src/moduleRegistry.ts` регистрирует публичные parser/builder Operations и после выбора маршрута лениво импортирует `Machines`, но не создаёт Operations store и не запускает его bootstrap. Публичный host `App` всё ещё ведёт в legacy `packages/ui/src/App.tsx`, поэтому новое подключение App Shell пока существует параллельно и не заменило живые legacy surfaces.

## Контракты и границы

Источник публичных типов — `src/contracts.ts`. `OperationsDependencies` инъецирует clients машин, console/terminal/files, наблюдения LLM, KB, CI и diagnostics, а также порты Chat и Projects. Сам пакет не обращается к `window`, `fetch`, WebSocket, EventSource/SSE, Electron или platform apps; transport adapters в текущем срезе отсутствуют. Backend, REST/WS/SSE, agent и runner protocols не изменились.

`MachineCatalogEntry` — безопасная read model с идентификацией, online/version/capabilities и policy summary. `MachineUtilityPort` принимает kind, optional agentId/path и revealFile. Связь наружу направлена через `OperationsChatPort.resume` и `OperationsProjectsPort.openTask`; Operations не импортирует host stores. `KnowledgeNavigationPort` определён как публичный контракт, но в `OperationsDependencies` не входит.

Administration не переносился. В package нет управления пользователями, runner registry/mutations, цен, чужого usage, административного health-check, shell/auth/theme ownership или project workflow mutations.

## Store и lifecycle

`createOperationsStore(deps)` в `src/store/operationsStore.ts` создаёт отдельный store на каждый вызов и возвращает `getState`, `subscribe`, `actions` и идемпотентный `dispose`. State разделён на machines, utility, console, terminal, explorer, observer, knowledge, CI и diagnostics. Store также создаёт controller-generation для каждой области; guard отбрасывает устаревшие async responses, а reset/dispose запускает зарегистрированные cleanup.

Machine refresh защищён generation token и может получать push-обновления через optional `MachinesClient.subscribe`. Utility выбирает запрошенную online-машину либо первую online, устанавливает cwd из запроса или первого allowedDir. На этом срезе store не проверяет `isPathAllowed` перед `explore` и не реализует file write/upload/download/mkdir/rename/delete actions, поэтому path helpers и полный FilesClient contract ещё не связаны с Explorer lifecycle.

Console выполняется через отдельный `ConsoleClient`. PTY открывается отдельно через `TerminalClient`; замена/закрытие снимает listeners, закрывает remote session, а input/resize отправляются только текущему объекту с совпадающим session id. Explorer использует собственный generation guard и дополнительно сверяет agentId и cwd перед применением list response. Закрытие Explorer не сбрасывает Console.

Observer загружает Claude/Codex projects, sessions и transcript и держит одну подписку текущей сессии; reset снимает прежнюю. Live items дописываются с ограничением 4000 элементов. Текущая реализация `resumeObserver` берёт id первого session из state и передаёт project как `null`, то есть выбранные project/session явно в state не хранятся.

Knowledge поддерживает status+search и загрузку документа; CI только загружает список и делегирует переход в задачу Projects port. Optional `CiMonitorClient.subscribe` пока store не использует. Diagnostics пропускает каждое `record.value` через `redactDiagnostics`; redaction удаляет ключи, похожие на credentials/transports, и маскирует secret-like fragments в строках.

## Routes и навигация

`src/routes.ts` является источником hash routes `#/machines`, `#/claude-code`, `#/codex`, `#/kb`, `#/kb/:documentId` и `#/ci`. Builder кодирует documentId как один segment, parser безопасно декодирует его и возвращает `null` для неизвестного или повреждённого URL. Host использует parser для восстановления legacy utility segment и KB document id при загрузке/F5/back-forward.

`createOperationsNavigationModel(hash, context)` возвращает пункты Machines, Claude Code, Codex, KB и CI с label, route, visibility и active. Сейчас visibility зависит только от `context.authenticated`; host Sidebar и command palette ещё не переведены на эту модель.

## Paths, стили и проверки

`src/path.ts` нормализует POSIX и Windows paths, строит breadcrumbs и проверяет принадлежность allowedDirs с boundary separator. Сравнение выполняется в lower case и для POSIX тоже, что нужно учитывать на case-sensitive hosts.

Продуктовые стили пакета находятся в `src/styles.css` и используют theme variables `--bg`, `--text`, `--line`; есть компактный mobile layout. Storybook общего `packages/ui` подхватывает `Operations.stories.tsx`; обязательная матрица показывает online/offline machines и restricted utility policy, а дополнительные stories покрывают Explorer, LLM History, Knowledge Base, CI и diagnostics без production transport.

Локальные команды пакета: `npm run -w @voicechat/operations-app typecheck` и `npm run -w @voicechat/operations-app test`. Пакет также входит в канонический `npm run verify:frontend`, который объединяет статические архитектурные проверки, typecheck/tests и сборочные frontend-гейты. Фактическое покрытие и общий frontend quality gate описаны в [testing-operations.md](testing-operations.md#единый-frontend-quality-gate).
