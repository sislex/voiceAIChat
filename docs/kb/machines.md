---
title: Машины: компаньон-агент, политика, PTY, проводник
updated: 2026-07-26
areas:
  - apps/agent/src
  - apps/agent-tray/src
  - apps/server/src/agents
  - apps/server/src/mcp
  - packages/shared/src/agentProtocol.ts
  - packages/shared/src/version.ts
  - packages/ui/src/components/Machine*.tsx
---

# Машины: компаньон-агент, политика, PTY, проводник

«Машина» — хост пользователя с запущенным `@voicechat/agent`. Он даёт модели
выполнять команды **там**, а не на сервере, плюс файловый проводник, живой
терминал и телеметрию.

## Подключение и жизненный цикл

Агент коннектится по WS на `/agent` и шлёт `agent.register{token, version}`.
Сервер (`apps/server/src/agents/wsAgent.ts` + `registry.ts`) сверяет хеш токена с
таблицей `agents` и отвечает `agent.registered{name, policy}` либо
`agent.denied{reason}`. Токен показывается пользователю **один раз** при создании
машины (`AgentCreated.token`), в БД лежит только `token_hash`; отзыв — удаление
машины. `AgentRegistry` держит подключения **в памяти** (перезапуск сервера = все
машины офлайн до переподключения); онлайн-список пушится клиентам сообщением
`agents`. Агент переподключается сам с backoff до 30 с.

Три способа установки: скачать самодостаточный `voicechat-agent.cjs` (собирается
esbuild'ом на сервере — `agents/agentScript.ts`, адрес и токен вшиваются, нужен
только Node.js), поставить трей-приложение (`apps/agent-tray`), или запустить из
репозитория (`npx tsx apps/agent/src/index.ts --server … --token …`, либо env
`VC_AGENT_SERVER`/`VC_AGENT_TOKEN`). Android — Termux, скрипт
`/api/agents/install-android.sh` (`agents/androidInstall.ts`), подробности в
`apps/agent/ANDROID.md`.

## Версии и гейтинг возможностей

`packages/shared/src/version.ts`: `AGENT_VERSION` — канонная версия (её рапортует
свежий агент и её же сервер отдаёт как «последнюю доступную» на публичном
`/api/agents/version`). `TOOL_MIN_VERSION` задаёт минимальную версию агента для
инструмента: `exec` 0.1.0, `fs` 0.2.0 (проводник), `pty` 0.3.0 (терминал);
телеметрия появилась в 0.4.0. Старый агент → инструмент не выполняется, UI просит
обновиться. **Добавил возможность агента — бампни `AGENT_VERSION` и допиши
`TOOL_MIN_VERSION`**, иначе сервер разрешит вызов агенту, который его не умеет.

## Политика команд

`AgentPolicy` (`agentProtocol.ts`): `allowedDirs`, `allowNetwork`, `allowWrite`,
`denyPatterns`, `allowPatterns`, `skills`. Проверка — чистая функция
`evaluateAgentCommand(policy, command)`: сначала белый список (если непуст), потом
чёрный, потом эвристики сети (`curl|wget|ssh|…`) и записи (`rm|mv|dd|>|>>|…`),
потом абсолютные пути вне разрешённых каталогов.

**Это best-effort гейт, а не песочница** — так и написано в коде. Не полагайся на
него как на границу безопасности и не усложняй регулярки в надежде «закрыть всё»:
защита строится на том, что машину подключает сам пользователь своим токеном.
Дефолт (`DEFAULT_AGENT_POLICY`) разрешает всё; политика правится в UI (трей и
настройки) и хранится в `agents.policy`.

Однострочный `exec` — request/response через REST `/api/agents/:id/exec` →
`registry.exec`, с гейтом политики, таймаутом и капом вывода 200 КБ (вывод уходит
в контекст модели, поэтому кап обязателен). Именно этот путь использует MCP-тул
`bash` (см. `llm.md`).

## Живой PTY-терминал

Отдельный опциональный канал, `docs/plans/PTY_CONSOLE.md`. Фронт — `@xterm/xterm`
+ `addon-fit` (`packages/ui/src/components/MachineTerminal.tsx`), на агенте —
`@lydell/node-pty`, shell — `fish` с фолбэком zsh→bash→`$SHELL`. Клиентский WS
несёт `pty.start/input/resize/kill` → сервер релеит агенту → назад
`pty.output/exit/error`.

Внутри живого PTY **per-command гейта политики нет**: это доверенный shell
пользователя (см. комментарий в `apps/agent/src/connection.ts`). Однострочный
`exec` с гейтом остался — он нужен модели и проводнику. `node-pty` не бандлится в
`.cjs` (нативный модуль): нет модуля → `startPty` ловит ошибку, терминал
деградирует, `exec` продолжает работать.

## Проводник и файловые операции

`FsOp` (`fs.list/read/write/delete/rename/mkdir`) идут REST'ом на сервер
(`/api/agents/:id/fs*`), оттуда — агенту, ответ `fs.result`/`fs.error` по `opId`.
Реализация на агенте — `apps/agent/src/fileOps.ts`, UI — `FileExplorer.tsx`.

## Телеметрия

Агент push-only шлёт `agent.telemetry` (ОС, CPU%, память, диск, батарея на
Android). CPU считается по дельте `os.cpus()` между вызовами — `loadavg` на
Windows/Android недостоверен. Телеметрия и версия есть в `AgentInfo` **только
когда машина онлайн**. UI — `MachineStatus.tsx`, `AgentCard.tsx`.

## Termux (Android) — грабли

`apps/agent/src/platform.ts`: в Termux **нет `/bin/bash`**, бинарники лежат в
`/data/data/com.termux/files/usr/bin`, PATH бывает урезанным. Поэтому shell для
`exec` и `pty` резолвится одной общей функцией `resolveShell()`, а признак Termux
определяется по `TERMUX_VERSION`/`PREFIX`/наличию bin-каталога. Любой новый спавн
на агенте должен идти через `platform.ts`, а не через хардкод `/bin/bash`.
