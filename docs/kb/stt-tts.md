---
title: Речь: Whisper (STT) и Piper/say (TTS)
updated: 2026-08-20
checked: 9c99776f
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

Озвучка: `tts/ttsSession.ts` → `PiperTtsEngine` (`piper` + ONNX-голос) либо
`SayTtsEngine` (macOS `say`) как фолбэк. Выбор движка при старте сервера: Piper
берётся, если есть бинарь **и** хотя бы один `*.onnx` в каталоге голосов —
намеренно не завязано на текущий выбранный голос, чтобы смена голоса не
роняла сервер обратно на `say`. Текст перед синтезом чистится
`packages/shared/src/textPrep.ts`, режется на фразы `sentences.ts`, играется
очередью `packages/ui/src/lib/ttsPlayer.ts`.

## Где лежат бинари и модели

STT-пути принадлежат конфигу `apps/stt-runner/src/config.ts`; основной сервер знает только URL и токен runner:

| Что | env | Дефолт |
|---|---|---|
| STT Runner data | `VC_DATA_DIR` | `~/.voicechat-stt-runner` |
| GGML-модели Whisper | `VC_MODELS_DIR` | `<runner-data>/models` |
| `whisper-cli` | `VC_WHISPER_CLI` | `whisper-cli` из PATH |
| Временные WAV | `VC_STT_TEMP_DIR` | `<runner-data>/tmp` |
| Server → Runner | `VC_STT_RUNNER_URL`, `VC_STT_RUNNER_TOKEN` | не настроен |

Автообнаружение репозиторных артефактов осталось только у серверной части TTS: `apps/server/src/config.ts` может выбрать `.venv-piper/bin/piper` и голоса из `apps/desktop/resources/piper-voices`. Whisper сервер больше не ищет и не запускает; для remote STT обязательны `VC_STT_RUNNER_URL` и `VC_STT_RUNNER_TOKEN`.

В Docker `whisper-cli` собирается из whisper.cpp v1.7.5 и копируется только в target `stt-runner-runtime`. Сервис не публикует host-порт, имеет отдельные `/models` и `/stt-tmp`, healthcheck и лимиты 6 CPU/6 GiB; server image бинарь и STT volumes не получает. Внутреннее устройство и административные лимиты описаны в [stt-runner.md](stt-runner.md).

## Скачивание моделей и голосов

Каталог, файлы и операции моделей Whisper находятся в `apps/stt-runner/src/models`; серверные `/api/stt/*` являются прокси и не вычисляют пути к моделям.
Голоса Piper: каталог `tts/piperCatalog.ts`, скачивание `tts/voiceDownload.ts`,
прогресс — `tts.voiceProgress/Done/Error`.

## Доступность функций

`system/resources.ts` и `system/capabilities.ts` по-прежнему считают локальные ресурсные пороги TTS и STT для публичного API. Поверх этого сервер опрашивает health STT Runner: недоступный runner или отсутствующая выбранная модель принудительно выключают только `capabilities.stt`. Текстовый чат и TTS продолжают работать. Проверка обновляется перед status/capabilities-запросами и фоновым интервалом; источником наличия моделей служит runner, а не файловая система сервера.

## Локальная сборка на macOS (проверено)

`nodejs-whisper` собирает whisper.cpp нативно: нужен `cmake` в PATH
(`/opt/homebrew/bin`), иногда — `CPLUS_INCLUDE_PATH` на SDK-хедеры. Piper ставится
как pip-пакет `piper-tts` в `.venv-piper`. Оба факта уже учтены в `dev-web.sh`.
