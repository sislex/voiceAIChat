# Core KB section assignment (Core `d58a37e0`)

| Core topic | Section | Owner module | Core keeps |
|---|---|---|---|
| llm.md | Independent runner boundary | core | everything |
| llm.md | Scoped preview generation | llm-runner | Core preview gateway that strips caller identity, cwd, MCP config and session continuation before forwarding generation |
| llm.md | Модель вызывается как CLI, а не по API | llm-runner | turns.ts provider/model deny-list (llmAccess.ts), CLAUDE_MODELS/CODEX_MODELS catalogs, LLM settings/chat model menus, normalizeClaudeModel, CI default model, KB reranker one-shot calls, per-user auth.status state + /ws frame, /api/auth/status proxy via RunnerFsClient, Core LlmRequest contract |
| llm.md | Исполнитель по HTTP (`RemoteLlmClient`) | llm-runner | RemoteLlmClient, llm/sinks.ts, server-generated runId and cancel, mapping of 409 codex_thread_in_use and transport errors to safe hints, VC_LLM_RUNNER_* env in config.ts/buildServer |
| llm.md | Форму тела `/v1/run` держит только `packages/shared` | core | everything |
| llm.md | Local Make with a server-hosted model runner | core | everything |
| llm.md | Разбор потока | core | everything |
| llm.md | Ход модели (`turns.ts`) | core | everything |
| llm.md | Make: инструменты `mcp__make__*` | core | everything |
| llm.md | Канбан: инструменты `mcp__kanban__*` | core | everything |
| llm.md | Старт хода: `claude.start` | core | everything |
| llm.md | Договорённости в тексте ответа (fenced-блоки) | core | everything |
| llm.md | База знаний в ходе модели (авто-контекст + `mcp__kb__*`) | core | everything |
| llm.md | Наблюдатели сессий Claude Code и Codex | llm-runner | /api/cc/*, /api/cx/*, /api/files/read proxying via RunnerFsClient, session.ts observerTail selection and Last-Event-ID reconnect, imageRelocate.ts |
| llm.md | Anthropic-совместимый gateway (входящий) | core | everything |
| llm.md | Проброс Bash на машину пользователя | core | everything |
| llm.md | AI-помощник формулировки | core | everything |
| llm.md | Предпросмотр контекста обязан совпадать с ходом | core | everything |
| llm.md | Генерация картинок для студии (2026-09-12) | core | everything |
| stt-runner.md | Граница подсистемы | voice | RemoteSttClient, sttSession.ts run/cancel bridging and public /ws stt.partial/stt.final mapping, VC_STT_RUNNER_URL/TOKEN selection |
| stt-runner.md | Протокол v1 | voice | packages/shared/src/stt.ts public wire contract (Core consumer copy) |
| stt-runner.md | Очередь, лимиты и отмена | voice | — |
| stt-runner.md | Модели и health | voice | server health polling (build, every 10 s, before status/capabilities), capabilities.stt, /api/stt/models proxy through SttClient |
| stt-runner.md | Контейнер и запуск | voice | Core compose wiring: server depends on the STT service and receives only internal URL/token |
| tts-runner.md | Граница подсистемы | voice | RemoteTtsClient/FakeTtsClient in Core server, packages/shared/src/tts.ts public contract |
| tts-runner.md | Очередь и очистка | voice | — |
| tts-runner.md | Движки и голоса | voice | Core public voice catalog shows installed voices only with downloadable: false |
| tts-runner.md | Сервер и браузерная сессия | core | everything |
| tts-runner.md | Конфигурация и контейнер | voice | server receives only VC_TTS_RUNNER_URL/TOKEN; UI voiceStore.applyTtsError banner |
| tts-runner.md | Проверка | voice | shared-contract consumer checks in Core |
| stt-tts.md | Путь звука | voice | sttSession.ts/ttsSession.ts orchestration, public /ws frames, textPrep.ts and sentences.ts in shared |
| stt-tts.md | Где лежат бинари и модели | voice | Server -> Runner URL/token row; server spawns no speech binaries |
| stt-tts.md | Скачивание моделей и голосов | voice | /api/stt/* and voice list/delete proxies via SttClient/TtsClient |
| stt-tts.md | Неблокирующий мастер первого запуска | core | everything |
| stt-tts.md | Доступность функций | core | everything |
| stt-tts.md | Локальная сборка на macOS (проверено) | voice | scripts/dev-web.sh is a Core script |
| stt-tts.md | Independent Voice repository | voice | Core verification of version/API/environment/consumer before opening the STT WebSocket, audio buffering, legacy URL/token migration settings |
| architecture.md | Голосовой цикл | voice | stateMachine.ts in shared, voiceStore/chatStore/appRuntime host orchestration |
| architecture.md | Tool repository ownership | core | everything |
| architecture.md | Voice and Image Studio ownership | core | everything |
| server-internals.md | LLM и MCP | core | everything |
| server-internals.md | STT, TTS и ресурсы | voice | system/resources.ts and capabilities.ts, RemoteSttClient, TtsClient/ttsSession FIFO and barge-in |
| deploy.md | Образ | core | everything |
| deploy.md | Аутентификация CLI живёт в контейнере | llm-runner | Core server sees only the runner HTTP API and bearer token |
| deploy.md | External runner ownership at the September 2026 release checkpoint | core | everything |
| deploy.md | Voice and Image Studio release inputs | core | everything |
| deploy.md | Retired work-runner volume removal (2026-09-20) | core | everything |
| deploy.md | Image Studio executor repair (LLM Runner 0.3.4) | llm-runner | — |
| deploy.md | Server-owned LLM Runner releases (0.3.5) | llm-runner | — |
| testing-operations.md | Extracted application test ownership | core | everything |
| testing-operations.md | Development | core | everything |
| testing-operations.md | Матрица проверок | core | everything |
