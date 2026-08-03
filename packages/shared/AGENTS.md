# @voicechat/shared — контракт и чистая логика

Единственный источник истины для типов и протокола; **без внешних зависимостей**
и без обращений к DOM, сети, файлам и процессам. Всё, что тут лежит, обязано
тестироваться юнит-тестом без моков.

Подключается как `@voicechat/shared` (server, agent) и как `@shared/*` (ui, web,
desktop — алиас на исходники).

## Что где

| Файл | Содержимое |
|---|---|
| `types.ts` | `Message`, `Conversation`, `Settings`, `SessionUser`, роли, модели (`isModelAllowed`, `clampModelForRole`) |
| `protocol.ts` | REST-пути (`REST`), WS-сообщения (`ClientMessage`/`ServerMessage`) + списки типов для тестов контракта |
| `ipc.ts` | формы мостов `window.*` (`Renderer*Bridge`) — общие для web (REST/WS) и desktop (IPC) |
| `agentProtocol.ts` | сервер↔машина: сообщения, `AgentPolicy` + `evaluateAgentCommand`, `FsOp`, телеметрия |
| `version.ts` | `AGENT_VERSION`, `TOOL_MIN_VERSION`, `compareVersions` |
| `stateMachine.ts` | голосовой цикл `idle→listening→transcribing→thinking→speaking`, barge-in |
| `streamJson.ts`, `codexStream.ts` | разбор stream-json claude/codex (текст + активность) |
| `prompt.ts` | сборка промпта, метки спикеров, вложения, подсказки `TOOL_HINT`/questions |
| `tools.ts`, `questions.ts`, `images.ts` | fenced-блоки ` ```tool ` / ` ```questions ` / ` ```image ` в ответе модели (служебные — их список в `sentences.ts`, чтобы TTS их не читал) |
| `kb.ts`, `kbGaps.ts` | контракт базы знаний, политика «БЗ в первую очередь» (`kbToolHint`) и пробелы базы: правило `KB_GAP_RULE`, блок ` ```kb-gaps ` и его разбор |
| `sentences.ts`, `textPrep.ts`, `pcm.ts`, `format.ts`, `export.ts` | нарезка на фразы, подготовка текста к синтезу, аудио-утилиты, форматирование, экспорт разговора |
| `cc.ts`, `codexSessions.ts`, `mcp.ts`, `auth.ts`, `admin.ts` | типы наблюдателей сессий, MCP, статуса входа, админки |

Новый файл — не забудь реэкспорт в `index.ts`.

## Правила

- Добавление в контракт начинается **здесь**, потом сервер, потом мосты и UI
  (`docs/kb/protocol.md`).
- Новое WS-сообщение — и в union, и в `CLIENT_MESSAGE_TYPES`/`SERVER_MESSAGE_TYPES`
  (иначе падает `protocol.test.ts`).
- Ломающее изменение типа задевает сразу server + ui + desktop + agent: прогоняй
  `npm run typecheck` целиком, а не только свой пакет.
- Возможность агента → бампни `AGENT_VERSION` и `TOOL_MIN_VERSION`.

Гейт: `npm run -w @voicechat/shared test` + `npm run typecheck`.
