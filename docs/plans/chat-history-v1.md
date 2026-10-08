# chat-history-v1 — длинные разговоры (Make и чат) без потери контекста и без огромных промптов

Ран `chat-history-v1`. Ветка задач — `dev`.

Владелец, 2026-10-08: пользователь работает в проекте Make неделями, в истории больше 10 000 сообщений.
Оформить прогоном пункты 2–5 предложения оператора; пункт 1 (лимит холодного старта) — задача B01.

## Что есть сейчас

- Пока у разговора есть тред CLI (`conversations.claude_session_id`, `claude:`/`codex:`), ядро шлёт только
  новое сообщение (`buildPrompt`); контекст держит и сжимает сам CLI.
- Холодный старт (новый тред: новый разговор, правка/удаление сообщения, смена движка, потерянный тред
  Codex) склеивает всю историю БД в один промпт — `buildConversationPrompt` (`packages/shared/src/prompt.ts`)
  без ограничения размера. На 10 000 сообщений это за пределами окна модели.
- Контекст Make подмешивается блоком `makeContextBlock` (`apps/server/src/turns.ts`), собранным сервисом Make.
- MCP-инструменты ядра: `kbMcp` (`apps/server/src/kb/kbMcp.ts`), консоль, remote bash.

## Решения

1. Холодный старт — сводка разговора плюс последние сообщения в пределах бюджета.
2. Сводка старой части разговора обновляется в фоне и хранится в разговоре.
3. Для Make источник памяти — заметки проекта (`make/notes.md`), а не переписка.
4. Модель может искать по всей истории разговора инструментом, а не держать её в контексте.
5. Пользователь видит заполненность контекста и может начать новый тред со сводкой.

| B01 | Core | — | Bounded cold start. In `packages/shared/src/prompt.ts` add `buildConversationPromptWithin(messages, budget, {summary?})`: keeps the newest messages whose total length fits the character budget (default 200 000 characters, about 50k tokens; the last message is always kept, truncated from the start if it alone exceeds the budget), prefixes «История разговора до этого места сокращена: N ранних сообщений опущены.» and, when given, the conversation summary block; `buildConversationPrompt` keeps its behaviour for short histories. `apps/server/src/turns.ts` uses it for every cold start (no session, edited history, engine switch, lost Codex thread), with the budget from `VC_COLD_START_PROMPT_CHARS`. The context inspector shows the same truncation. Tests: short history unchanged, 10 000 messages bounded, summary placement, oversize last message, inspector parity. Update docs/kb (server-internals). Gate: `npm run gate:task -- --base <sha>`. |
| B02 | Core | — | Rolling conversation summary. Shared contract: `Conversation.summary?: {text, coversUntilMessageId, updatedAt}`; server storage (SQLite and Postgres migration). After every 40 published messages beyond the summary point (and on demand, see C01) a background job asks the cheapest available model through the existing runner client (no tools, plan permission, its own session) to update the summary with the messages since `coversUntilMessageId` (decisions, chosen styles and tokens, open tasks, names of files and components; at most 1 500 words), stores it and emits a conversation update; failures are logged and retried at the next threshold, never block a turn. Cold start (B01) passes this summary. `REST.conversationSummary(id)` GET returns it; `POST …/summary/refresh` triggers the job. Tests with a fake runner: threshold, incremental update, failure tolerance, storage migration. Update docs/kb (protocol, server-internals). Gate: `npm run gate:task -- --base <sha>`. |
| B03 | Make | — | Project notes as Make memory. For connected projects and small projects keep a notes file (`make/notes.md` in the subproject for connected projects, the workshop root for small ones) with sections «Решения», «Стили и токены», «Компоненты», «Открытые вопросы»; add MCP tools `make_notes_read` and `make_notes_update` (section-level replace, size limit 32 KB) and instruct the Make assistant to record durable decisions there; include the notes (bounded to 8 KB, newest sections first) in the Make context block returned to Core. Tests: tools, size limit, context inclusion for both project kinds. Update docs/kb (project-mode, api-events). Gate: `npm run gate:task -- --base <sha>`. |
| B04 | Core | — | Chat history search tool for the assistant. A new MCP server in `apps/server` (`mcp__history__*`, registered like `kbMcp`, conversation-scoped token per turn): `history_search {query, limit≤20}` (full-text over the conversation's published messages, newest first, with message id, role, time and a 400-character snippet) and `history_get {messageId, around≤5}` (the message and neighbours, each truncated to 4 000 characters). Only the conversation of the turn is searchable; read-only; disabled for delegated/text-only turns. Wire it into turns with a context toggle (`mcp-history`) and a prompt hint for long conversations (more than 200 messages). Tests: scoping, search ranking, truncation, toggle, token revocation at turn end. Update docs/kb. Gate: `npm run gate:task -- --base <sha>`. |
| C01 | core-ui | B02 | Context fill and fresh thread in the chat UI (and Make chat). Show the thread context fill of the conversation (from the existing Codex/Claude thread usage in turn meta: used / window, with colour at 70% and 90%) next to the composer, and a «Новый тред со сводкой» action: calls `POST …/summary/refresh` and then clears the conversation session (existing reset), so the next turn cold-starts with summary + recent messages (B01); confirm dialog explains that the conversation history stays. Tests (DOM): indicator thresholds, action flow and errors. Stories. Update docs/kb. Gate: `npm run gate:task -- --base <sha>`. |
