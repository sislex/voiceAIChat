---
title: Речь: Whisper (STT) и Piper/say (TTS)
updated: 2026-07-26
checked: 4805be2
areas:
  - apps/server/src/stt
  - apps/server/src/tts
  - apps/server/src/system
  - apps/desktop/src/main/stt
  - apps/desktop/src/main/tts
  - packages/ui/src/audio
  - scripts/dev-web.sh
---

# Речь: Whisper (STT) и Piper/say (TTS)

## Путь звука

Браузер отдаёт Int16 PCM бинарными WS-кадрами (`packages/ui/src/audio/*`:
`browserAudio`, `pcmWorkletSource`, `microphones`). Сервер копит чанки в
`stt/sttSession.ts`, пишет WAV (`stt/wav.ts`) и зовёт `whisper-cli`
(`stt/whisperEngine.ts`) — то есть распознавание идёт **внешним бинарём
whisper.cpp через spawn**, а не биндингами. Результат уходит как
`stt.partial` / `stt.final`. Диаризация — заглушка с чистым интерфейсом
(`diarization/stubDiarization.ts`).

Озвучка: `tts/ttsSession.ts` → `PiperTtsEngine` (`piper` + ONNX-голос) либо
`SayTtsEngine` (macOS `say`) как фолбэк. Выбор движка при старте сервера: Piper
берётся, если есть бинарь **и** хотя бы один `*.onnx` в каталоге голосов —
намеренно не завязано на текущий выбранный голос, чтобы смена голоса не
роняла сервер обратно на `say`. Текст перед синтезом чистится
`packages/shared/src/textPrep.ts`, режется на фразы `sentences.ts`, играется
очередью `packages/ui/src/lib/ttsPlayer.ts`.

## Где лежат бинари и модели

Конфиг (`apps/server/src/config.ts`) резолвит каждый путь по цепочке
**env → артефакт внутри репозитория → дефолт в `dataDir`**:

| Что | env | Дефолт |
|---|---|---|
| Каталог данных | `VC_DATA_DIR` | `~/.voicechat-server` |
| GGML-модели Whisper | `VC_MODELS_DIR` | `<dataDir>/models` |
| `whisper-cli` | `VC_WHISPER_CLI` | `<dataDir>/whisper-cli` |
| Голоса Piper | `VC_PIPER_VOICES_DIR` | `<modelsDir>/piper` |
| Бинарь Piper | `VC_PIPER_BIN`, `VC_PIPER_ARGS` | `piper` из PATH |

Автообнаружение внутри репозитория переиспользует то, что уже собрано для
desktop: `apps/desktop/node_modules/nodejs-whisper/cpp/whisper.cpp/build/bin/whisper-cli`,
модели рядом, `.venv-piper/bin/piper` (pip `piper-tts`), голоса
`apps/desktop/resources/piper-voices` (русские Irina/Dmitri/Ruslan). Поэтому
`npm run dev:web` работает без env — те же пути прописаны и в `scripts/dev-web.sh`.

**Под vitest автообнаружение выключено** (`AUTODISCOVER = !process.env.VITEST`):
иначе деструктивные тесты (удаление модели/голоса) стирали бы реальные файлы
репозитория. Не убирай этот флаг.

В Docker `whisper-cli` собирается отдельной стадией из whisper.cpp v1.7.5
статически и кладётся в `/usr/local/bin/whisper-cli`; нужен `libgomp1` в runtime,
без него STT в контейнере не работает вовсе.

## Скачивание моделей и голосов

Модели Whisper: `stt/models.ts` (список/наличие/путь), `stt/download.ts`,
`stt/downloadManager.ts` — процесс-глобальный менеджер, переживающий
переподключения клиента; прогресс уходит как `stt.downloadProgress/Done/Error`.
Голоса Piper: каталог `tts/piperCatalog.ts`, скачивание `tts/voiceDownload.ts`,
прогресс — `tts.voiceProgress/Done/Error`.

## Блокировка по памяти

`system/resources.ts` определяет ресурсы (в контейнере — из cgroup, то есть
уважает `mem_limit`), `system/capabilities.ts` считает `SystemCapabilities`:
доступны ли STT и TTS и почему нет. Пороги (пиковое потребление с запасом, не
вес модели): `large-v3-turbo` 2 ГБ, `medium` ~1.2 ГБ, `small` ~0.6 ГБ, TTS ~0.4 ГБ;
переопределяются `VC_MIN_MEM_STT` / `VC_MIN_MEM_TTS` (число или `1.5G`).
Недоступная функция отдаётся в UI с причиной **и** жёстко блокируется на сервере
на уровне WS-команд. При `mem_limit: 1g` в compose это осознанно оставляет
рабочими `small` и озвучку.

## Локальная сборка на macOS (проверено)

`nodejs-whisper` собирает whisper.cpp нативно: нужен `cmake` в PATH
(`/opt/homebrew/bin`), иногда — `CPLUS_INCLUDE_PATH` на SDK-хедеры. Piper ставится
как pip-пакет `piper-tts` в `.venv-piper`. Оба факта уже учтены в `dev-web.sh`.
