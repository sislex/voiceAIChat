# @voicechat/shared — контракт и чистая логика

Core transport contracts and pure orchestration logic. Product models belong to
their published owner contract packages, declared as explicit dependencies. No
DOM, network, filesystem or process access belongs in Shared.

Core consumes this package as `@voicechat/shared` or `@shared/*`. Independent
Agent and Desktop clients consume published contracts/artifacts instead.

## Что где

| Файл | Содержимое |
|---|---|
| `types.ts` | `Message`, `Conversation`, `Settings`, `SessionUser`, роли, модели (`isModelAllowed`, `clampModelForRole`) |
| `protocol.ts` | REST-пути (`REST`), WS-сообщения (`ClientMessage`/`ServerMessage`) + списки типов для тестов контракта |
| `ipc.ts` | формы мостов `window.*` (`Renderer*Bridge`) — общие для web (REST/WS) и desktop (IPC) |
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
- Agent version and capability minimums are maintained in `sislex/agent/packages/contracts`.

Гейт: `npm run -w @voicechat/shared test` + `npm run typecheck`.

Product implementation helpers belong to their owner contract packages. Shared
retains Core wire contracts; type-only references may name a published product
contract (for example Make replacement previews in IPC), without runtime imports
or barrel re-exports that create a Shared-to-product runtime cycle.

Make, Browser/Preview and Image Studio models are imported from their owner
contract packages. Operation context, usage and billing models come from the SDK.
Core does not re-export or test their internal models; it tests its own transport
and authorization integration with those public contracts.

Agent contracts are implemented and tested in `@sislexa/agent-contracts`. The
Shared barrel and `agentProtocol.ts` preserve compatibility for already published
consumers; they only re-export owner definitions and own no duplicate tests.
