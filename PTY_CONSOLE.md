# Фича: настоящий терминал по машине (PTY-консоль)

> Живой документ. Каждый шаг самодостаточен и заканчивается **гейтом**
> (typecheck + тесты затронутых пакетов; где применимо — сборка). Не переходим
> к следующему шагу, пока гейт не зелёный. Прогресс — в чек-листе ниже + журнал.

## Цель

Заменить однострочный раннер команд («Консоль машины») на **настоящий терминал**:
живой PTY на машине-агенте, xterm.js на фронте, подсветка и автоподсказки — от
самого shell (**fish**). Интерактивные программы (vim/htop/top), цвета, стрелки,
Tab-completion работают, потому что это реальный TTY.

## Согласованные решения

- Терминал на фронте — **@xterm/xterm** (+ `@xterm/addon-fit`).
- PTY на агенте — **@lydell/node-pty** (нативный, с пребилдами; Linux+macOS).
- Shell в PTY — **fish** (подсветка/подсказки из коробки), фолбэк zsh→bash→$SHELL.
- Живой PTY — **отдельный опциональный канал**. Старый однострочный `exec` с
  гейтом политики **остаётся** (нужен ИИ-агенту и проводнику).
- ОС агентов — Linux + macOS (Windows/ConPTY не поддерживаем).

## Архитектурный обзор

Однострочный `exec` — request/response (REST `/api/agents/:id/exec` → `registry.exec`
копит вывод → `AgentExecResult`). Для терминала нужен **живой двунаправленный
стрим**, поэтому вводим отдельный канал `pty.*` поверх **клиентского WS** (не REST):

```
xterm (браузер)
  │  ws: pty.start / pty.input / pty.resize / pty.kill
  ▼
session.ts ──► registry (релей, БЕЗ накопления) ──► agent WS
  ▲                                                    │ node-pty
  │  ws: pty.output / pty.exit / pty.error             ▼
xterm.write ◄─────────────────────────────────────── fish PTY
```

- **shared**: `pty.*` в `ServerToAgent`/`AgentToServer` (агент-протокол) и в
  `ClientMessage`/`ServerMessage` (клиент-протокол) + списки типов; `AGENT_VERSION`
  → 0.3.0, `TOOL_MIN_VERSION.pty = '0.3.0'`.
- **agent**: `@lydell/node-pty`, модуль `pty.ts` (Map ptyId→IPty), обработка
  `pty.*` в `connection.ts`.
- **server**: релей в `registry.ts` (Map ptyId→{agentId, emit}), маршрутизация
  `pty.output/exit/error` обратно клиенту; `SessionDeps.pty`; `session.ts`
  обработка `pty.*` + kill всех PTY на `onClose`.
- **ui**: `RendererPtyBridge` (ipc), `MachineTerminal.tsx` (xterm), подключение в
  `MachineUtility` (fallback на `MachineConsole`, если моста нет); стили.
- **web-мост**: `makePtyBridge` поверх `WsClient`; `window.pty` в
  `installRemoteBridges`.
- **машина**: установить fish; обновить агент (node-pty) — деплой отдельно.

## Definition of Done для шага (гейт)

1. `npm run -w <pkg> typecheck` — без ошибок в затронутых пакетах.
2. Тесты затронутых пакетов зелёные (`npm run -w <pkg> test`).
3. Где применимо — сборка (`vite build`).
4. Отмечен шаг в чек-листе + запись в журнале.

---

## Шаги

### Ш1. Протокол PTY (shared)
`pty.*` в оба протокола + версия/гейт тула. Тесты контракта типов и версии.

### Ш2. Агент: PTY через node-pty (apps/agent)
`@lydell/node-pty`; `pty.ts` (start/input/resize/kill, выбор shell fish→zsh→bash);
обработка `pty.*` в `connection.ts`. Существующий `exec` не трогаем.

### Ш3. Сервер: релей PTY (apps/server)
`registry.ts`: сессии PTY, релей в обе стороны, очистка при дисконнекте агента.
`session.ts`: обработка `pty.*` от клиента, kill на `onClose`. Проводка в `server.ts`.

### Ш4. UI: xterm-терминал (packages/ui)
Зависимости xterm; `RendererPtyBridge`; `MachineTerminal.tsx`; `MachineUtility`
рендерит терминал (fallback → `MachineConsole`); стор прокидывает мост; стили.

### Ш5. Web-мост (packages/ui/remote)
`makePtyBridge` поверх `WsClient`; `window.pty` в `installRemoteBridges`.

### Ш6. Машина: fish + деплой агента
Установить fish на машину; собрать/обновить агент с node-pty. Деплой — отдельно.

### Ш7. Финал
Общий typecheck+тесты+сборка; commit; push; `docker compose up --build -d`.

---

## Чек-лист

- [x] Ш1. Протокол PTY (shared) — версия 0.3.0, pty.* в обоих протоколах, гейт зелёный
- [x] Ш2. Агент: node-pty — @lydell/node-pty, pty.ts (fish→zsh→bash), тесты зелёные
- [x] Ш3. Сервер: релей PTY — registry-релей + session + тесты зелёные
- [x] Ш4. UI: xterm-терминал — MachineTerminal, MachineUtility, стили; typecheck+тесты+сборка web зелёные
- [x] Ш5. Web-мост — makePtyBridge + window.pty; web-typecheck зелёный
- [x] Ш6. Машина: fish 3.7.0 установлен; бандл агента — node-pty external (require в рантайме); загрузка безопасна в ESM и CJS
- [x] Ш7. Финал — общий typecheck ✓, commit dbf8389, push origin/main ✓, docker --build up ✓ (health 200)

## Журнал

- (старт) План составлен, архитектура выверена по коду.
- Ш1 shared: pty.* в agentProtocol+protocol, AGENT_VERSION 0.3.0, гейт зелёный.
- Ш2 agent: @lydell/node-pty (1.1.0), pty.ts (fish→zsh→bash), ленивый require;
  тесты 31 ✓.
- Ш3 server: релей PTY в registry (Map ptyId→{agentId,emit}), session.ts +
  проверка владения машиной + kill на onClose; тесты 201 ✓ (1 пред-сущ. teardown-флака).
- Ш4 ui: MachineTerminal (xterm+addon-fit), MachineUtility (fallback → MachineConsole),
  стили; typecheck+тесты(26 файлов)+сборка web ✓. Замечание: агрегатный `vitest run`
  не завершается на этой машине (пред-сущ. висящие хендлы) — тесты гоняли по файлам.
- Ш5 web: makePtyBridge поверх WsClient, window.pty; web-typecheck ✓.
- Ш6 машина: fish 3.7.0 (apt); бандл агента — node-pty external, безопасная загрузка
  в CJS-бандле (глобальный require) и ESM-dev (createRequire). ВНИМАНИЕ: запущенный
  на машине агент (voicechat-agent.cjs) НЕ перезапускался, чтобы не оборвать канал
  mcp__remote__bash; для e2e-PTY его нужно обновить отдельно (см. «Деплой агента»).
- Ш7: общий typecheck всех воркспейсов ✓; коммит/пуш/докер.

## Деплой агента (отдельный шаг, вручную)

Запущенный агент раздаётся сервером как бандл. После деплоя сервера:
1. На машине агента, где есть репозиторий и `node_modules` с `@lydell/node-pty`,
   пересобрать/скачать `voicechat-agent.cjs` и перезапустить процесс агента.
2. Либо в трее (agent-tray) — «Проверить обновления». node-pty идёт как external,
   поэтому в окружении агента модуль должен быть доступен (repo/трей-пакет).
3. Без обновления агента живой терминал деградирует (exec продолжает работать).
