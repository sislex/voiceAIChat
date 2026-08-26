---
title: TTS Runner: ресурсный API, движки и жизненный цикл WAV
updated: 2026-08-26
checked: 1de46edc
areas:
  - apps/tts-runner
  - apps/server/src/tts
  - packages/shared/src/tts.ts
  - apps/server/src/session.ts
  - apps/server/src/server.ts
  - apps/server/src/config.ts
  - Dockerfile
  - docker-compose.yml
---

# TTS Runner: ресурсный API, движки и жизненный цикл WAV

## Граница подсистемы

`@voicechat/tts-runner` — единственный процесс, который запускает Piper или macOS `say`, читает физический каталог голосов и владеет временными WAV. Основной сервер не импортирует реализации движков: production использует `RemoteTtsClient`, а тесты инъектируют `FakeTtsClient`. Общий versioned-контракт запросов, ресурсов, health и стабильных кодов ошибок находится в `packages/shared/src/tts.ts`.

Все операции `/v1/*` закрыты одним Bearer-токеном. `POST /v1/runs` валидирует запрос и возвращает ресурс со статусом `queued`; `GET /v1/runs/:runId` показывает lifecycle, фактически выбранные engine/voice и стабильную ошибку; WAV читается отдельно через `GET /v1/runs/:runId/audio`; `DELETE` идемпотентно отменяет живой запуск. Пока звук не готов, audio endpoint отвечает 425, после failed/cancelled — 410, неизвестный run — 404.

## Очередь и очистка

`TtsRunManager` хранит ресурсы в памяти, ограничивает число одновременно работающих процессов и длину очереди. Переполнение становится ошибкой `busy`; конфигурация также ограничивает длину текста, длительность процесса и максимальный размер WAV. Таймаут и явная отмена останавливают дочерний процесс через SIGTERM с последующим SIGKILL после grace period.

На старте runner создаёт временный каталог и удаляет оставшиеся `.wav`/`.part`. Неуспешный запуск удаляет файл сразу; терминальный ресурс и успешный WAV живут до orphan timeout, а после отдачи audio файл и ресурс быстро очищаются. Закрытие Fastify отменяет все нетерминальные запуски. Точные состояния и переходы реализованы в `apps/tts-runner/src/run/runManager.ts`.

## Движки и голоса

`TtsEngines` выбирает Piper первым для `engine: auto`, если доступен бинарник и в физическом каталоге есть хотя бы одна полная пара `.onnx` + `.onnx.json`; на macOS альтернативой служит `say`. Запрос может зафиксировать движок. Перед spawn текст очищается через `prepareTtsText`, voice id ограничен безопасным форматом, а результат проверяется по минимальному WAV-размеру и лимиту байтов. Источник поведения — `apps/tts-runner/src/engines/ttsEngine.ts`.

`GET /v1/voices` перечисляет реально доступные голоса выбранного окружения. Удаление голоса удаляет обе части Piper-модели только внутри runner-owned `voicesDir`. Старый серверный каталог скачиваемых голосов и серверная загрузка с HuggingFace удалены; совместимый публичный каталог сервера теперь показывает только установленные голоса и `downloadable: false`.

## Сервер и браузерная сессия

`apps/server/src/tts/ttsSession.ts` сохраняет FIFO для браузера: на каждую фразу создаёт remote run, запоминает его `runId`, ждёт ресурс и WAV, затем отправляет прежний WS-кадр `tts.audio` с base64. Barge-in и закрытие WebSocket очищают локальную очередь и отменяют активный remote run; `ownerId` связывает запрос с пользователем. Ошибка одной фразы отправляется как `tts.error` и не блокирует текстовый чат или STT.

Публичные маршруты голосов проксируются через `TtsClient`, поэтому сервер не вычисляет пути и не удаляет файлы сам. Если URL или токен runner не настроены, `capabilities.tts` становится недоступной независимо от STT и текстового чата.

## Конфигурация и контейнер

**Piper и голос по умолчанию в образе.** Стадия `piper-assets` в `Dockerfile` скачивает
бинарный релиз Piper по `TARGETARCH` (amd64→x86_64, arm64→aarch64) в `/opt/piper` и голос
`ru_RU-ruslan-medium` (HuggingFace `rhasspy/piper-voices`) в `/opt/piper-voices-seed`;
`tts-runner-runtime` получает `VC_PIPER_BIN=/opt/piper/piper` и
`VC_PIPER_SEED_VOICES_DIR`. На старте `seedVoices` (`engines/seedVoices.ts`) копирует
полные пары `.onnx`+`.onnx.json` из seed-каталога в пустой `voicesDir`; непустой каталог
не трогается (пользователь мог удалить голос). До этого образ Piper не содержал, том
голосов был пуст, и любая озвучка в Docker падала с `No TTS engine available`, а UI
эту ошибку не показывал (теперь `voiceStore.applyTtsError` → баннер оболочки).


Runner требует `VC_TTS_RUNNER_TOKEN`; остальные пределы и пути собраны в `apps/tts-runner/src/config.ts`. Docker target `tts-runner-runtime` слушает 8791, использует отдельные persistent data и temp volumes, CPU/RAM limits и token-authenticated healthcheck. Сервер получает только внутренние `VC_TTS_RUNNER_URL` и `VC_TTS_RUNNER_TOKEN`. Workspace включён в корневые npm scripts и карту affected-check.

## Проверка

HTTP-контракт проверяется через Fastify `inject`, а реальные процессы заменяются инъектированными `TtsRunManager` и `TtsEngines`. Гейт пакета: `npm run -w @voicechat/tts-runner typecheck && npm run -w @voicechat/tts-runner test`; изменение общего контракта дополнительно затрагивает сервер и остальные consumers `@voicechat/shared`.
