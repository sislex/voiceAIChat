---
title: STT Runner: внутренний протокол, ресурсы и lifecycle
updated: 2026-08-20
checked: 9c99776f
areas:
  - apps/stt-runner
  - apps/server/src/stt
  - apps/server/src/session.ts
  - apps/server/src/server.ts
  - apps/server/src/config.ts
  - packages/shared/src/stt.ts
  - Dockerfile
  - docker-compose.yml
---

# STT Runner: внутренний протокол, ресурсы и lifecycle

## Граница подсистемы

`@voicechat/stt-runner` — отдельный Fastify-процесс и единственный владелец `whisper-cli`, GGML-моделей и временных WAV. Основной сервер не знает путей к этим ресурсам: `RemoteSttClient` связывает публичную голосовую сессию с внутренним runner, а REST-маршруты моделей проксируют административные операции. Legacy `SttEngine` оставлен как инъекция для существующих unit-тестов; production выбирает remote-клиент по `VC_STT_RUNNER_URL` и `VC_STT_RUNNER_TOKEN`.

Публичный браузерный `/ws` и сообщения `stt.partial` / `stt.final` не изменились. `sttSession.ts` создаёт UUID run, пересылает PCM без промежуточного WAV и при dispose отправляет cancel. События runner преобразуются обратно в публичные сегменты: миллисекунды переводятся в секунды, отсутствие speaker становится `speakerId=1`.

## Протокол v1

Источник форм и runtime-валидации — `packages/shared/src/stt.ts`. Весь `/v1/*` закрыт одним Bearer-токеном с constant-time сравнением. Клиент открывает WS `/v1/transcribe`, первым текстовым кадром отправляет `start` со `schemaVersion=1`, runId, моделью, языком и фиксированным форматом mono PCM16 16 kHz; затем идут бинарные PCM-кадры и текстовый `end` или `cancel`. Повторный start на сокете, живой дубликат runId, неизвестная модель/язык или иной аудиоформат отвергаются.

Контракт событий допускает `ready`, `partial`, `final`, `error`, `cancelled` и `completed`. Текущая реализация накапливает аудио до `end`, один раз запускает Whisper и фактически выдаёт `final`, затем `completed`; периодический partial в runner пока не производится. Пустой поток завершается пустым final/completed без spawn. Терминальное событие отправляется не более одного раза и удаляет run из реестра.

## Очередь, лимиты и отмена

`apps/stt-runner/src/config.ts` — источник всех административных лимитов. По умолчанию одновременно исполняются два распознавания, ещё четыре ожидают; переполненная очередь возвращает retryable `busy`. Ограничены суммарный PCM, размер одного принятого бинарного кадра, длительность сессии, простой без аудио и время работы Whisper. Значения env обязаны быть положительными целыми числами, иначе процесс не стартует.

Cancel удаляет ожидающий run из очереди либо посылает активному child `SIGTERM`, после grace-периода — `SIGKILL`. Закрытие клиентского WS планирует orphan-cancel, а закрытие Fastify отменяет все живые runs. `startWhisper` всегда удаляет свой WAV в `finally`; при старте runner дополнительно удаляет старые файлы, подходящие под его собственный шаблон имени. Timeout и ошибки Whisper классифицируются в стабильные коды внутреннего протокола.

## Модели и health

Runner обслуживает `GET /v1/health`, `GET /v1/models`, загрузку и удаление allowlisted моделей. Каталог и проверка ожидаемого размера находятся в `apps/stt-runner/src/models/catalog.ts`; загрузчик пишет `.part` и переименовывает файл после успешного скачивания. Ошибка нехватки места при download отображается в HTTP 507 `storage_exhausted`.

Сервер опрашивает health при сборке, каждые 10 секунд и перед status/capabilities. Для STT нужны доступный бинарь runner и установленная выбранная модель; их отсутствие выключает только STT. `/api/stt/models`, download и delete работают через `SttClient`, поэтому сервер не читает volume моделей.

## Контейнер и запуск

`buildRunner()` отделён от `listen()`; конфиг и fake spawn инъектируются для тестов. Пакет запускается из TypeScript через `tsx`, поэтому относительные импорты имеют суффикс `.js`. Без `VC_STT_RUNNER_TOKEN` entrypoint завершает процесс, а `buildRunner` также запрещает создать незащищённое приложение.

Docker target `stt-runner-runtime` — единственный образ с `/usr/local/bin/whisper-cli`. Compose подключает к нему отдельные volumes `/models` и `/stt-tmp`, задаёт 6 CPU/6 GiB и проверяет authenticated health; host-порт не публикуется. Server зависит от этого сервиса и получает только внутренние URL и токен.
