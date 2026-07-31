---
title: Разработка, тестирование, диагностика и эксплуатация
updated: 2026-07-31
checked: c769754
areas:
  - package.json
  - scripts
  - apps/server/vitest.config.ts
  - apps/agent/vitest.config.ts
  - packages/shared/vitest.config.ts
  - packages/ui/vitest.config.ts
  - Dockerfile
  - docker-compose.yml
  - docker-compose.parallel.yml
  - Caddyfile
---

# Разработка, тестирование, диагностика и эксплуатация

## Установка зависимостей

Корневой `npm install` обслуживает `packages/shared`, `packages/ui`, `apps/server`, `apps/web`, `apps/agent`. `apps/desktop` и `apps/agent-tray` устанавливаются отдельно из-за Electron/native ABI и собственных lockfiles.

Не переносить Electron-пакеты в workspaces без отдельного решения миграции: корневой hoisting способен подменить native module сборкой под другой runtime.

## Development

`npm run dev:web` запускает Fastify :8787 и Vite совместно через `scripts/dev-web.sh`. Обычно этот процесс принадлежит пользователю; автоматизированный агент не должен оставлять второй server на том же порту. Для диагностического запуска использовать другой `PORT` и временный `VC_DATA_DIR`.

Server запускает исходники через tsx. Web dev proxy сохраняет same-origin семантику API и WebSocket. Агент для разработки запускается `npx tsx apps/agent/src/index.ts --server ws://host:8787/agent --token ...`.

## Матрица проверок

| Область | Typecheck | Tests | Дополнительно |
|---|---|---|---|
| shared contract | `npm run -w @voicechat/shared typecheck` | `npm run -w @voicechat/shared test` | consumers при изменении публичного типа |
| server | `npm run -w @voicechat/server typecheck` | `npm run -w @voicechat/server test` | HTTP/WS integration |
| agent | `npm run -w @voicechat/agent typecheck` | `npm run -w @voicechat/agent test` | bundle test при протоколе/deps |
| UI | `npm run -w @voicechat/ui typecheck` | `npm run -w @voicechat/ui test` | web build для CSS/bootstrap; `npm run build:storybook` при правке сториз/фикстур |
| web | `npm run -w @voicechat/web typecheck` | package test при наличии | `npm run -w @voicechat/web build` |
| desktop | `npm run typecheck:desktop` | `npm run test:desktop` | electron-vite build; native rebuild |
| agent tray | `npm run typecheck:agent-tray` | `npm run test:agent-tray` | electron-vite build/dist |

`npm run verify` выполняет полный набор. Для локального шага предпочтителен узкий гейт затронутых пакетов, затем полный verify перед релизом/крупным merge.

## Стратегия тестов

Shared — чистые unit и contract tests без моков. Здесь проверяются union/runtime lists, parsers, policy, state machine, prompt и преобразования.

Server HTTP тестируется `app.inject()` с `:memory:` SQLite. WebSocket поднимает ephemeral listener и реальный ws-клиент, но engines/CLI заменяются fake. Spawn, fetch, filesystem и resource probes инъектируются. Тест никогда не использует настоящий HOME или найденные repo-модели; `VITEST` отключает autodiscovery.

UI store тестируется без React; DOM components — jsdom + Testing Library + fake bridges. Проверяются пользовательские действия и наблюдаемый результат, не внутренние state setters. Таймеры voice/TTS управляются fake clock.

Agent тестирует config/platform/exec/fs/pty/telemetry/shutdown/single-instance отдельно от socket. Connection test проверяет routing/reconnect с fake ws. Платформенные ветки должны покрывать Linux/macOS/Windows/Termux через инъекцию или controlled platform override.

Electron main/preload код тестируется без запуска реального окна, где возможно. Native SQLite перед тестом пересобирается под Node ABI, перед Electron build — обратно под Electron ABI.

## Диагностика по слоям

1. `/api/health` — процесс и HTTP доступны.
2. `/api/session/me` — bearer token и пользователь.
3. `/api/system/capabilities` — сервер видит CPU/RAM и разрешает STT/TTS.
4. `/api/auth/status` — CLI profile авторизован.
5. `/api/agents` — machine зарегистрирована, online, версия и telemetry.
6. Browser devtools network — REST status и `/ws` reconnect.
7. Server stdout — Fastify/CLI ошибки; UI console panel — нормализованные LLM events.
8. Agent/tray log — connection, shell, PTY и fs ошибки на удалённой машине.

При «генерация пропала после refresh» проверять `claude.active` и TurnManager, а не только UI. При дублированных событиях — cleanup subscriptions после reconnect. При недоступном TTS/STT — capabilities и cgroup limit до проверки binary.

## Docker

Dockerfile многостадийный: устанавливает workspace dependencies, собирает web, формирует runtime с server source, shared и необходимыми системными binary/libs. Приложение слушает configurable `HOST/PORT`, persistent data монтируется в `VC_DATA_DIR`.

Web build в образе использует same-origin. CLI credentials и пользовательские profiles должны жить в persistent volume; пересборка образа не должна стирать SQLite, модели и auth.

`docker-compose.yml` — основной сервис. `docker-compose.parallel.yml` предназначен для параллельного/альтернативного экземпляра с разнесёнными портами/томами. Перед запуском второго экземпляра проверять уникальность host port и data volume.

## Caddy и TLS

Caddy завершает HTTPS и проксирует HTTP/WebSocket на Fastify. Для microphone APIs браузеру нужен secure context (HTTPS или localhost). Proxy обязан сохранять Upgrade для `/ws` и `/agent`, request host/proto и достаточные timeouts для долгих потоков.

Публичный reverse proxy не должен открывать LAN-only Anthropic gateway без дополнительной аутентификации/ACL. Machine install scripts строят URL из публичной базы, поэтому `VC_PUBLIC_URL`/forwarded host должны соответствовать адресу, доступному самой машине.

## Данные и backup

Резервировать весь `VC_DATA_DIR`: SQLite с WAL/SHM согласованным snapshot, session secret, user CLI profiles, uploads и скачанные модели/голоса по выбранной раскладке. Простой copy только `.db` во время активной записи может быть неполным; использовать SQLite backup/остановку или копировать согласованный набор.

Machine tokens восстановить из hash нельзя. Потеря БД требует перерегистрации машин. Потеря session secret инвалидирует пользовательские bearer tokens, но не пароли и machine token hashes.

Перед обновлением: backup data volume, зафиксировать текущий image/commit, выполнить typecheck/tests/build, затем rolling restart. Схема обновляется идемпотентно при старте; обратимость конкретной миграции нужно оценивать по `database.ts`.

## База знаний

Перед задачей: `npm run kb:context -- "запрос"`. После кода: `npm run kb:impact`, правка тематической статьи, `node scripts/kb.mjs touch <topic>`, `npm run kb:log -- slug`, `npm run kb:index`, `npm run kb:check`. README генерируется и руками не редактируется.
