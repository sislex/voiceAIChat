# Запуск voiceAIChat в Docker

Один контейнер: Fastify-сервер (`apps/server`) + собранный web (`apps/web`) на
одном порту, плюс `claude` и `codex` CLI внутри образа.

## Быстрый старт

```bash
npm run docker          # = docker compose up --build
# открыть http://localhost:8787
npm run docker:down     # остановить
```

## Аутентификация claude / codex

CLI внутри контейнера используют авторизацию с **хоста** — каталоги
`~/.claude` и `~/.codex` монтируются внутрь (`docker-compose.yml`). Перед
запуском на хосте должны быть выполнены `claude login` и `codex login`.

Эти же каталоги читают Проводник Claude Code и Проводник Codex — история сессий
хоста будет видна в контейнере.

## Данные

БД (`voicechat.db`) и вложения хранятся в volume `vc-data` (`/data` внутри
контейнера) — переживают пересоздание контейнера.

## Переменные окружения

| Переменная | Значение в образе | Назначение |
|---|---|---|
| `HOST` | `0.0.0.0` | слушать все интерфейсы (обязательно для контейнера) |
| `PORT` | `8787` | порт HTTP/WS |
| `VC_DATA_DIR` | `/data` | БД + вложения (volume) |
| `VC_WEB_DIR` | `/app/apps/web/dist` | каталог web-билда для раздачи статики |
| `HOME` | `/home/node` | сюда монтируются `.claude` / `.codex` (контейнер под пользователем `node`, не root — иначе claude блокирует режим «Полный доступ») |

Опционально (голосовой ввод/озвучка — по умолчанию выключены, сервер работает
и без них): `VC_WHISPER_CLI`, `VC_MODELS_DIR`, `VC_PIPER_BIN`,
`VC_PIPER_VOICES_DIR` — если добавить в образ бинарники whisper-cli/piper.

## Сборка образа вручную

```bash
docker build -t voicechat .
docker run --rm -p 8787:8787 \
  -v voicechat-data:/data \
  -v "$HOME/.claude:/home/node/.claude" \
  -v "$HOME/.codex:/home/node/.codex" \
  voicechat
```

## Заметки по реализации

- Сервер не компилируется в JS — запускается через `tsx` из исходников
  (см. `Dockerfile`), поэтому образ содержит исходники + `node_modules`.
- `better-sqlite3` собирается из исходников в стадии build (toolchain
  `python3/make/g++`), runtime — на той же glibc-базе (bookworm).
- Web собирается без `VITE_SERVER_URL` → тот же origin, что и API (один порт).
