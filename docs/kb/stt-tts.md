---
title: Речь: Whisper (STT) и Piper/say (TTS)
updated: 2026-10-07
areas:
  - apps/server/src/stt
  - packages/shared/src/stt.ts
  - apps/server/src/tts
  - apps/server/src/system
  - packages/ui/src/audio
  - scripts/dev-web.sh
---

# Речь: Whisper (STT) и Piper/say (TTS)

Module details: `voice:README.md`

## Путь звука

Браузер по-прежнему отдаёт Int16 PCM бинарными кадрами публичного `/ws`; его контракт не менялся. `apps/server/src/stt/sttSession.ts` через `RemoteSttClient` открывает защищённый внутренний WS `STT Runner /v1/transcribe`, передаёт управляющий JSON и исходные PCM-чанки. Разрыв браузерной сессии вызывает cancel связанного remote run. Формы внутреннего schemaVersion=1 и runtime-проверка лежат в `packages/shared/src/stt.ts`; наружу сервер сохраняет `stt.partial` / `stt.final`.

Озвучка также вынесена из сервера: `apps/server/src/tts/ttsSession.ts` создаёт ресурсный запуск через `TtsClient`, получает готовый WAV отдельным запросом и сохраняет публичный WS-кадр `tts.audio`. Текст чистится через `packages/shared/src/textPrep.ts`, режется на фразы `sentences.ts`.

## Где лежат бинари и модели

| Что | env | Дефолт |
|---|---|---|
| Server → Runner | `VC_STT_RUNNER_URL`, `VC_STT_RUNNER_TOKEN` | не настроен |

Сервер больше не ищет и не запускает ни Whisper, ни TTS-бинари. Для remote STT обязательны `VC_STT_RUNNER_URL` и `VC_STT_RUNNER_TOKEN`, для TTS — `VC_TTS_RUNNER_URL` и `VC_TTS_RUNNER_TOKEN`.

## Скачивание моделей и голосов

Core model operations use `SttClient`: серверные `/api/stt/*` являются прокси и не вычисляют пути к моделям.

Сервер проксирует список и удаление через `TtsClient`; старые серверные каталог разрешённых загрузок и downloader удалены, поэтому публичный каталог показывает только установленные голоса и не предлагает скачивание.

## Неблокирующий мастер первого запуска

Возобновляемый мастер хранит прогресс в версионированном `Settings.onboarding`; контракт, начальное состояние, переходы и проверка входящего settings patch находятся в `packages/shared/src/types.ts`. Пять независимых шагов проверяют microphone/Whisper, TTS, Claude/Codex, выбранную машину и полный голосовой запрос. У каждого шага один из статусов `idle`, `checking`, `success`, `warning`, `error` или `skipped`, фиксированная безопасная диагностика и явные действия повтора и пропуска. Закрытие мастера не блокирует чат, из настроек его можно открыть снова, а отдельный reset заменяет только onboarding-прогресс.

При восстановлении сохранённый `checking` становится `warning`, поэтому reload или restart не создаёт вечную проверку, ложный успех и автоматический повтор записи либо запроса. Отпечатки относящихся к шагу настроек переводят только затронутый результат в предупреждение; переход любого шага сбрасывает зависимый итоговый voice-тест, но не независимые успехи. Ошибка сохранения остаётся видимой и предлагает явный повтор.

`installRemoteBridges`, shared by web and Electron, exposes a lazy
`RendererOnboardingBridge`. Each check opens a private WebSocket so STT/TTS
events are separate from chat. Recording starts only on a click; closing, reset
and timeout release that capture. TTS success requires decoded audio and playback
completion through its own AudioContext. Model/voice presence is not success.
The LLM check reads both providers' access and login states, then probes a
permitted provider in a separate test conversation. Voice transcripts and replies
are ordinary test-chat messages, not onboarding-state fields. The progress
stores only fixed diagnostics and configuration identifiers. Each active stage has
a 120-second timeout; a slow earlier stage does not consume the next stage's budget.

`e2e/settings.e2e.test.ts` covers the renderer in Chromium and Electron, server
restart and isolated reset, both themes at 1440×900, 1280×720, 768×1024, 390×844
and 320×700, touch, keyboard focus, overflow and CDP safe-area insets. Reduced
viewport checks emulate keyboard occlusion; they do not claim a physical mobile
keyboard test. Screenshots are written to `artifacts/onboarding`. Existing
`SettingsModal.stories.tsx` covers settings loading and missing voices; wizard
states are covered by component tests and the integrated browser matrix. A page
`ToolFrame` without close/Escape actions does not register a dialog layer: the
empty chat page can mount after the wizard and must not steal its Escape key.

The real voice E2E requires built web assets, Electron dependencies/Xvfb and
reachable authorized speech/LLM runners. It accepts `VC_QA_STT_URL/TOKEN`,
`VC_QA_TTS_URL/TOKEN` and `VC_QA_LLM_URL/TOKEN`; the production queue can discover
local runner containers without printing their credentials. `VC_QA_LLM_SERVICE`
selects the local LLM container (default `runner-work`). Its temporary server uses
an isolated data directory. Full Chromium (`channel: 'chromium'`) supplies a
controlled WAV microphone through its fake-device switches; Whisper, the selected
CLI and TTS remain real services. The test records boundary timestamps and waits
for actual AudioContext playback completion. Missing prerequisites fail the test
instead of skipping required coverage.

## Доступность функций

`system/resources.ts` и `system/capabilities.ts` по-прежнему считают ресурсные пороги TTS и STT для публичного API. Сервер дополнительно опрашивает health STT Runner; недоступный runner или отсутствующая выбранная модель выключают только `capabilities.stt`. Отсутствующие URL или токен TTS Runner выключают только `capabilities.tts`. Отказ любой речевой подсистемы не блокирует текстовый чат, а отказ TTS не блокирует STT.

## Локальная сборка на macOS (проверено)

`scripts/dev-web.sh` is the Core development launcher.

## Independent Voice repository

The message composer and conversation orchestration stay in Chat.
The host connects browser playback to UI telemetry.

Core verifies version/API/environment/consumer
before opening an STT WebSocket, buffers audio while verification is pending, and
cancellation prevents a delayed connection. Each new connection rereads its token
file, so rotation needs no process restart. Legacy runner URL/token settings remain
available for migration.
