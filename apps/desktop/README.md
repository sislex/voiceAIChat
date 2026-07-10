# Голос·Чат

Десктопный голосовой чат-бот на базе **Claude Code CLI**: нажимаете микрофон и
говорите, речь распознаётся локально (Whisper), текст уходит в Claude, ответ
стримится в чат и **озвучивается локально** (macOS `say`). Чат остаётся видимым,
голосовая панель снизу — как голосовой режим ChatGPT.

**Стек:** Electron + electron-vite + React + TypeScript, SQLite (better-sqlite3),
Vitest. Платформа v1: **macOS (Apple Silicon)**.

## Объём v1

- **Реальные:** UI (пиксель-в-пиксель по прототипу), Claude Code CLI (стрим ответа,
  session-id на разговор), Whisper STT (локально, `large-v3-turbo`), захват аудио,
  **TTS-озвучка** (локально: Piper через `piper-tts`, голос ru irina; fallback —
  macOS `say`/Milena; синтез в main → воспроизведение в renderer через Web Audio;
  barge-in/«стоп» прерывают озвучку), звуковые сигналы (старт/стоп записи, «думает»),
  хранение истории/настроек в SQLite.
- **Заглушка с чистым интерфейсом** (реальная реализация — следующий этап):
  диаризация (`DiarizationEngine` → один спикер).

## Требования

- macOS на Apple Silicon (arm64).
- **Node.js** 20+.
- **Claude Code CLI** в `PATH` и выполненный вход:
  ```sh
  claude login
  ```
- **CMake** (для сборки whisper.cpp при первой установке модели):
  ```sh
  brew install cmake
  ```
- **Xcode Command Line Tools** (`xcode-select --install`).

> **Известная особенность окружения.** На свежих Command Line Tools компилятор
> может не находить заголовки C++ stdlib (`fatal error: 'vector'/'climits' file not
> found`) при нативных сборках (`better-sqlite3`, `whisper.cpp`). Если ловите это —
> экспортируйте путь к libc++ перед сборкой/запуском:
> ```sh
> export CPLUS_INCLUDE_PATH="$(xcrun --show-sdk-path)/usr/include/c++/v1"
> ```

## Установка

```sh
npm install
```

## Запуск (разработка)

```sh
npm run dev
```

Собранное приложение (превью продакшн-сборки):

```sh
npm run build && npm start
```

## Первый запуск и модель Whisper

Модель `ggml-large-v3-turbo.bin` (~1.5 ГБ) **не входит в поставку** — она
скачивается при первом запуске. Если модель не найдена, в интерфейсе появится
баннер «Модель распознавания не найдена → Скачать» с прогрессом.

- В dev модель кладётся в `models/` в корне проекта.
- В упакованном приложении — в `userData` (`~/Library/Application Support/Голос·Чат/models`).

Бинарь `whisper-cli` собирается из вложённого в `nodejs-whisper` исходника
whisper.cpp через CMake (см. требования выше). В упакованном приложении бинарь
уже собран и включён в бандл.

## Озвучка (TTS)

По умолчанию озвучка идёт через **macOS `say`** (голос Milena) — работает без
настройки. Для более качественного локального голоса **Piper** (ru irina)
установите его в проектный venv:

```sh
python3 -m venv .venv-piper
.venv-piper/bin/pip install piper-tts
curl -L -o models/piper/ru_RU-irina-medium.onnx \
  https://huggingface.co/rhasspy/piper-voices/resolve/main/ru/ru_RU/irina/medium/ru_RU-irina-medium.onnx
curl -L -o models/piper/ru_RU-irina-medium.onnx.json \
  https://huggingface.co/rhasspy/piper-voices/resolve/main/ru/ru_RU/irina/medium/ru_RU-irina-medium.onnx.json
```

Если `.venv-piper/bin/piper` и голос найдены — используется Piper, иначе `say`
(в логе main: `[tts] движок: Piper` / `say`). Оба варианта полностью локальны.

> Упаковка Piper в `.dmg` пока не сделана — собранное приложение использует `say`.

## Сборка дистрибутива (.dmg)

```sh
npm run dist        # electron-vite build + electron-builder --mac (dmg, arm64)
npm run dist:dir    # то же, но распакованный .app без dmg (быстрее, для проверки)
```

Результат — в `release/`. Сборка без подписи: при первом открытии macOS Gatekeeper
предупредит (ПКМ → «Открыть»). Для распространения добавьте code signing и
нотаризацию в `electron-builder.yml` (`mac.identity`, `afterSign`).

## Тесты

```sh
npm run typecheck
npm run lint
npm test            # unit + интеграционные (whisper/claude запускаются при наличии)
```

Интеграционные тесты (реальное распознавание Whisper, реальный `claude -p`)
автоматически **пропускаются**, если модель/бинарь/CLI недоступны — CI остаётся
зелёным.

## Архитектура

```
src/
  main/               # Electron main
    db/               # SQLite: схема, репозиторий, миграции
    ipc/              # регистрация IPC-каналов (invoke) поверх БД
    stt/              # Whisper: движок, WAV, парсинг, модели, скачивание
    claude/           # Claude CLI: spawn, парсинг stream-json, промпт
    diarization/      # DiarizationEngine (+ заглушка)
    tts/              # TtsEngine (macOS say): синтез, подготовка текста, голоса
  preload/            # contextBridge: window.api / audio / stt / claude / tts
  renderer/src/       # React UI + стор (машина состояний) + аудиозахват
  shared/             # общие типы, контракт IPC, машина состояний
```

- **Машина состояний** (`shared/stateMachine.ts`): `idle → listening → transcribing
  → thinking → speaking → idle` + barge-in. Единый источник переходов.
- **Стор** (`renderer/src/store`): фреймворк-независимый, на её базе; управляет
  разговорами/сообщениями/настройками через `window.api` (IPC → SQLite) и
  оркеструет STT/Claude/TTS через события.
- **Абстракции** `SttEngine` / `LlmClient` / `DiarizationEngine` / `TtsEngine` —
  точки подключения реальных движков; мокаются в тестах.

## Следующий этап (вне v1)

- Реальная диаризация (sherpa-onnx): сегментация + embeddings + кластеризация,
  до 4 спикеров.
- Piper TTS как опция (выбор русских голосов, стрим по предложениям) — движко-
  независимая точка подключения `TtsEngine` уже готова; сейчас используется `say`.
- Hands-free режим, VAD-авто-пауза.
