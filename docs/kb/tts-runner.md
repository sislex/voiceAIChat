---
title: TTS Runner: ресурсный API, движки и жизненный цикл WAV
updated: 2026-10-07
areas:
  - apps/server/src/tts
  - packages/shared/src/tts.ts
  - apps/server/src/session.ts
  - apps/server/src/server.ts
  - apps/server/src/config.ts
  - Dockerfile
  - docker-compose.yml
---

# TTS Runner: ресурсный API, движки и жизненный цикл WAV

Module details: `voice:README.md`

## Граница подсистемы

Основной сервер не импортирует реализации движков: production использует `RemoteTtsClient`, а тесты инъектируют `FakeTtsClient`. Общий versioned-контракт запросов, ресурсов, health и стабильных кодов ошибок находится в `packages/shared/src/tts.ts`.

## Движки и голоса

Старый серверный каталог скачиваемых голосов и серверная загрузка с HuggingFace удалены; совместимый публичный каталог сервера теперь показывает только установленные голоса и `downloadable: false`.

## Сервер и браузерная сессия

`apps/server/src/tts/ttsSession.ts` сохраняет FIFO для браузера: на каждую фразу создаёт remote run, запоминает его `runId`, ждёт ресурс и WAV, затем отправляет прежний WS-кадр `tts.audio` с base64. Barge-in и закрытие WebSocket очищают локальную очередь и отменяют активный remote run; `ownerId` связывает запрос с пользователем. Ошибка одной фразы отправляется как `tts.error` и не блокирует текстовый чат или STT.

Публичные маршруты голосов проксируются через `TtsClient`, поэтому сервер не вычисляет пути и не удаляет файлы сам. Если URL или токен runner не настроены, `capabilities.tts` становится недоступной независимо от STT и текстового чата.

## Конфигурация и контейнер

Сервер получает только внутренние `VC_TTS_RUNNER_URL` и `VC_TTS_RUNNER_TOKEN`.

The UI displays TTS errors through `voiceStore.applyTtsError` → shell banner.

## Проверка

Changes to the shared contract require Core consumer checks: изменение общего контракта дополнительно затрагивает сервер и остальные consumers `@voicechat/shared`.
