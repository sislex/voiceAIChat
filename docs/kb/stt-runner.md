---
title: STT Runner: внутренний протокол, ресурсы и lifecycle
updated: 2026-10-07
areas:
  - apps/server/src/stt
  - apps/server/src/session.ts
  - apps/server/src/server.ts
  - apps/server/src/config.ts
  - packages/shared/src/stt.ts
  - Dockerfile
  - docker-compose.yml
---

# STT Runner: внутренний протокол, ресурсы и lifecycle

Module details: `voice:README.md`

## Граница подсистемы

Основной сервер не знает путей к этим ресурсам: `RemoteSttClient` связывает публичную голосовую сессию с внутренним runner, а REST-маршруты моделей проксируют административные операции. Legacy `SttEngine` оставлен как инъекция для существующих unit-тестов; production выбирает remote-клиент по `VC_STT_RUNNER_URL` и `VC_STT_RUNNER_TOKEN`.

Публичный браузерный `/ws` и сообщения `stt.partial` / `stt.final` не изменились. `sttSession.ts` создаёт UUID run, пересылает PCM без промежуточного WAV и при dispose отправляет cancel. События runner преобразуются обратно в публичные сегменты: миллисекунды переводятся в секунды, отсутствие speaker становится `speakerId=1`.

## Протокол v1

Источник форм и runtime-валидации — `packages/shared/src/stt.ts`.

Клиент открывает WS `/v1/transcribe`, первым текстовым кадром отправляет `start` со `schemaVersion=1`, runId, моделью, языком и фиксированным форматом mono PCM16 16 kHz; затем идут бинарные PCM-кадры и текстовый `end` или `cancel`.

Контракт событий допускает `ready`, `partial`, `final`, `error`, `cancelled` и `completed`.

## Модели и health

Сервер опрашивает health при сборке, каждые 10 секунд и перед status/capabilities. Для STT нужны доступный бинарь runner и установленная выбранная модель; их отсутствие выключает только STT. `/api/stt/models`, download и delete работают через `SttClient`, поэтому сервер не читает volume моделей.

## Контейнер и запуск

In Core Compose, the STT service is a server dependency.
Server зависит от этого сервиса и получает только внутренние URL и токен.
