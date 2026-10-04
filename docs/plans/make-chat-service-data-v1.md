# make-chat-service-data-v1 — служебные данные чата загружаются только по настройке

Ран `make-chat-service-data-v1`. Задача доски «Make/чат: разговор грузится дважды и целиком (70 МБ
служебных данных) — не загружать журнал действий и запросы к модели без настройки чата».

Замер 2026-10-05 (разговор Make, 360 сообщений): `GET /api/conversations/:id?scope=make` — 69,9 МБ без
сжатия, загрузка 61 с. Текст сообщений — 0,19 МБ; `meta.activity` ответов ИИ (журнал действий агента) —
30,5 МБ, `meta.request` (полный запрос к модели) — 22,1 МБ. Запрос уходит дважды при открытии чата.

## Решение владельца (2026-10-05)

1. Служебные данные сообщений (`meta.activity`, `meta.request`) по умолчанию **не загружаются**. В
   настройках чата появляется переключатель «Загружать служебные данные ответов»; выключен по умолчанию.
2. Выключен — ответы разговора и события сообщений приходят без журнала действий и без полного запроса;
   интерфейс показывает подсказку «включите в настройках чата». Включён — данные одного сообщения
   загружаются по запросу при раскрытии, с прогрессом «загружено X из Y МБ».
3. Ответы JSON API сжимаются (gzip/br) в любом случае. Разговор запрашивается один раз.

## Задачи интегратора (Claude, вне манифеста)

- После приёмки B01: собрать и закрепить архив `@voicechat/shared` 0.1.18 в Core и в sislexa-core-ui
  (контракты — первый коммит, архив — второй), затем настроить C03.
- U01: выпуски, закрепление Core UI в ядре, релиз и выкат прода; проверка на разговоре из замера: ответ
  без настройки меньше 1 МБ, сжатие включено, один запрос, журнал действий открывается при включённой
  настройке; данные сообщений в базе не теряются после смены статуса запуска задачи.

| B01 | Core | — | Shared contracts for chat service data per docs/plans/make-chat-service-data-v1.md «Решение владельца»: in packages/shared add the conversation chat setting loadServiceData (boolean, default false) to ChatSettingsSnapshot/ChatSettingsPatch, CHAT_SETTING_OWNERS.conversation and the settings parser (chatContract.ts); add optional TurnMeta.serviceData summary { activityEntries, activityBytes, requestBytes } (types.ts TurnMeta); add a pure helper stripServiceData(meta) that removes meta.activity and reduces meta.request to model, permissionMode, promptChars and kbContext entries without their text bodies, filling serviceData with the sizes of the removed JSON; add REST.messageServiceData(conversationId, messageId) and the response type MessageServiceData { activity, request }; unit tests for the parser, the helper (sizes, idempotence, meta without service data) and the route constant; do not build or pin the shared archive (integrator step); update docs/kb/protocol.md with the KB workflow |
| C01 | Core | B01 | Server side of chat service data per docs/plans/make-chat-service-data-v1.md: unless the conversation setting loadServiceData is on, apply stripServiceData to every message sent to clients — GET /api/conversations/:id (apps/server/src/routes/rest.ts ~1025), the kanban-assistant conversation route (~954), the cc/cx resume routes (~1549, ~1597), the admin conversation route (routes/admin.ts ~627), draft/ensure routes (routes/chat.ts ~321, ~344), WS claude.done payloads (turns.ts ~1170, ~1324, ~1484) and chat.message (server.ts ~651); the live claude.active activity of the running turn stays as is; server-side readers (context snapshot rest.ts ~447/~532, prompt building) keep full meta; add GET REST.messageServiceData returning { activity, request } of one message with the same access rules as the conversation and 409 when the setting is off; make PATCH /api/conversations/:id/messages/:messageId merge meta on the server so that a client patch without activity/request (e.g. taskLaunches) never erases them (db/repos/chat.ts updateMessageMeta); tests for each route and event with the setting off and on, the new route, and the meta merge; update docs/kb/server-internals.md with the KB workflow |
| C02 | Core | — | HTTP compression of API responses per docs/plans/make-chat-service-data-v1.md «Решение владельца» item 3: register @fastify/compress in apps/server for JSON and text responses above 1 KB with br and gzip by Accept-Encoding; exclude WebSocket upgrades, server-sent or streamed responses (exec-stream, tunnel, logs follow, previews), range requests and already compressed media/archives; keep Content-Length absent only where compression applies; tests that a large JSON response is compressed with each encoding, small and streamed responses are not, and the body round-trips; update docs/kb/server-internals.md with the KB workflow |
| C03 | core-ui | B01 | Chat service data in Core UI per docs/plans/make-chat-service-data-v1.md (requires @voicechat/shared 0.1.18 pinned by the integrator): add the switch «Загружать служебные данные ответов» to ConversationSettings (packages/ui/src/modules/chat/components/ConversationSettings.tsx) saved through the conversation chat settings route; with the setting off MessageActivity and MessageMeta (ChatColumn.tsx ~855–1030, MessageMeta.tsx ~71) show a hint to enable it instead of the activity log and request details, and plan detection, model label and KB usage (kbUsage.ts, chatStore.ts ~1097/~2223) keep working from the reduced meta.request; with the setting on, expanding a message loads REST.messageServiceData on demand with a progress bar «загружено X из Y МБ» (stream reading, total from meta.serviceData sizes) and retry on error; make selectConversation (packages/chat-app/src/store/chatStore.ts ~1286) share one in-flight request per conversation id so opening a chat from bootstrap (runtime/appRuntime.ts ~396) and the route effect (shell/App.tsx ~1561) issues one GET; updateTaskLaunchStatus sends only the changed taskLaunches; DOM tests for the switch, hint, on-demand loading with progress, single request and the task launch patch; update docs/kb |
