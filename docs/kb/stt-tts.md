---
title: Речь: Whisper (STT) и Piper/say (TTS)
updated: 2026-09-20
checked: 5f3ca49e
areas:
  - apps/stt-runner
  - apps/server/src/stt
  - packages/shared/src/stt.ts
  - apps/server/src/tts
  - apps/server/src/system
  - packages/ui/src/audio
  - scripts/dev-web.sh
---

# Речь: Whisper (STT) и Piper/say (TTS)

## Путь звука

Браузер по-прежнему отдаёт Int16 PCM бинарными кадрами публичного `/ws`; его контракт не менялся. `apps/server/src/stt/sttSession.ts` через `RemoteSttClient` открывает защищённый внутренний WS `STT Runner /v1/transcribe`, передаёт управляющий JSON и исходные PCM-чанки. Только `apps/stt-runner` пишет временный WAV, запускает `whisper-cli`, публикует `ready/partial/final/error/cancelled/completed` и очищает процесс/файл. Разрыв браузерной сессии вызывает cancel связанного remote run. Формы внутреннего schemaVersion=1 и runtime-проверка лежат в `packages/shared/src/stt.ts`; наружу сервер сохраняет `stt.partial` / `stt.final`.

Озвучка также вынесена из сервера: `apps/server/src/tts/ttsSession.ts` создаёт ресурсный запуск через `TtsClient`, получает готовый WAV отдельным запросом и сохраняет публичный WS-кадр `tts.audio`. Только `apps/tts-runner` выбирает Piper или macOS `say`, запускает процесс, управляет очередью и временным файлом. Текст чистится через `packages/shared/src/textPrep.ts`, режется на фразы `sentences.ts`, играется очередью `packages/ui/src/lib/ttsPlayer.ts`. Подробности внутреннего API и lifecycle — в [tts-runner.md](tts-runner.md).

## Где лежат бинари и модели

STT-пути принадлежат конфигу `apps/stt-runner/src/config.ts`; основной сервер знает только URL и токен runner:

| Что | env | Дефолт |
|---|---|---|
| STT Runner data | `VC_DATA_DIR` | `~/.voicechat-stt-runner` |
| GGML-модели Whisper | `VC_MODELS_DIR` | `<runner-data>/models` |
| `whisper-cli` | `VC_WHISPER_CLI` | `whisper-cli` из PATH |
| Временные WAV | `VC_STT_TEMP_DIR` | `<runner-data>/tmp` |
| Server → Runner | `VC_STT_RUNNER_URL`, `VC_STT_RUNNER_TOKEN` | не настроен |

Сервер больше не ищет и не запускает ни Whisper, ни TTS-бинари. Для remote STT обязательны `VC_STT_RUNNER_URL` и `VC_STT_RUNNER_TOKEN`, для TTS — `VC_TTS_RUNNER_URL` и `VC_TTS_RUNNER_TOKEN`; пути Piper, голосов и временных WAV принадлежат конфигурации TTS Runner.

В Docker `whisper-cli` собирается из whisper.cpp v1.7.5 и копируется только в target `stt-runner-runtime`. Сервис не публикует host-порт, имеет отдельные `/models` и `/stt-tmp`, healthcheck и лимиты 6 CPU/6 GiB; server image бинарь и STT volumes не получает. Внутреннее устройство и административные лимиты описаны в [stt-runner.md](stt-runner.md).

## Скачивание моделей и голосов

В Docker голос по умолчанию (`ru_RU-ruslan-medium`) и бинарь Piper входят в образ
`tts-runner` и засеивают пустой том голосов при старте — см. [tts-runner.md](tts-runner.md),
«Конфигурация и контейнер».


Каталог, файлы и операции моделей Whisper находятся в `apps/stt-runner/src/models`; серверные `/api/stt/*` являются прокси и не вычисляют пути к моделям.

Физический каталог голосов Piper принадлежит TTS Runner. Сервер проксирует список и удаление через `TtsClient`; старые серверные каталог разрешённых загрузок и downloader удалены, поэтому публичный каталог показывает только установленные голоса и не предлагает скачивание.

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

`nodejs-whisper` собирает whisper.cpp нативно: нужен `cmake` в PATH
(`/opt/homebrew/bin`), иногда — `CPLUS_INCLUDE_PATH` на SDK-хедеры. Piper ставится
как pip-пакет `piper-tts` в `.venv-piper`. Оба факта уже учтены в `dev-web.sh`.

## Independent Voice repository

STT, TTS and portable browser audio are maintained in `sislex/voice`. Local runner
workspaces and `packages/voice-browser` delegate checks to its pinned source archive.
The services retain separate process IDs, ports, data directories and releases within
one repository. The message composer and conversation orchestration stay in Chat.
Browser playback reports actual output-clock advancement through an injected observer;
the host connects it to UI telemetry without a reverse import from Voice into Chat.

Managed speech uses SISLEXA_COMPONENT_CONFIG, provider-owned registries and exact
read/run/manage scopes. Metadata/readiness are public bootstrap endpoints; health and
speech operations require a grant. Core verifies version/API/environment/consumer
before opening an STT WebSocket, buffers audio while verification is pending, and
cancellation prevents a delayed connection. Each new connection rereads its token
file, so rotation needs no process restart. Legacy runner URL/token settings remain
available for migration. Both real runner entrypoints accept managed configuration
without legacy token variables. TTS also handles SIGTERM/SIGINT through app.close.
