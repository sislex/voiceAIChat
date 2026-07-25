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

Авторизация живёт **внутри контейнера** — в томах `vc-claude` (`/home/node/.claude`)
и `vc-codex` (`/home/node/.codex`), а не берётся с хоста. Логин выполняется один
раз внутри контейнера (обязательно под пользователем `node`, иначе токены будут
недоступны серверному процессу):

```bash
# Claude — интерактивный вход (или `claude setup-token` для headless-сервера,
# где нельзя открыть браузер: печатает URL, вставляете код обратно):
docker compose exec -u node voicechat claude auth login

# Codex — вход через ChatGPT (или `codex login --with-api-key` из stdin):
docker compose exec -u node voicechat codex login
```

Токены сохраняются в томах и переживают перезапуск/пересоздание контейнера.
Статус входа виден в приложении: **Настройки → Агент → «Вход в CLI»**.

> На headless-сервере (без браузера и с редиректом OAuth на localhost внутри
> контейнера) удобнее token-flow: `claude setup-token` и
> `codex login --with-api-key` / `--with-access-token`.

## Данные

БД (`voicechat.db`) и вложения хранятся в volume `vc-data` (`/data` внутри
контейнера) — переживают пересоздание контейнера. Авторизация CLI — в томах
`vc-claude` / `vc-codex` (тоже переживают пересоздание).

## Переменные окружения

| Переменная | Значение в образе | Назначение |
|---|---|---|
| `HOST` | `0.0.0.0` | слушать все интерфейсы (обязательно для контейнера) |
| `PORT` | `8787` | порт HTTP/WS |
| `VC_DATA_DIR` | `/data` | БД + вложения (volume) |
| `VC_WEB_DIR` | `/app/apps/web/dist` | каталог web-билда для раздачи статики |
| `HOME` | `/home/node` | здесь тома `.claude` / `.codex` с авторизацией (контейнер под пользователем `node`, не root — иначе claude блокирует режим «Полный доступ») |

Опционально (голосовой ввод/озвучка — по умолчанию выключены, сервер работает
и без них): `VC_WHISPER_CLI`, `VC_MODELS_DIR`, `VC_PIPER_BIN`,
`VC_PIPER_VOICES_DIR` — если добавить в образ бинарники whisper-cli/piper.


## Подключение внешнего Claude Code к серверу

Сервер публикует Anthropic-compatible маршруты `POST /v1/messages` и
`POST /v1/messages/count_tokens`. Запросы прозрачно передаются в другой
Anthropic-compatible API: сохраняются tools/tool_result, thinking, prompt caching,
beta-заголовки, ошибки и потоковые SSE-события.

Настройте backend в `.env` рядом с `docker-compose.yml`:

```env
VC_CLAUDE_UPSTREAM_URL=https://llm.example.com
VC_CLAUDE_UPSTREAM_API_KEY=upstream-secret
VC_CLAUDE_UPSTREAM_AUTH=x-api-key
VC_CLAUDE_MODEL_MAP={"claude-opus-4-6":"provider-opus","claude-sonnet-4-6":"provider-sonnet","claude-haiku-4-5-20251001":"provider-haiku"}
```

`VC_CLAUDE_UPSTREAM_URL` может оканчиваться как корнем API, так и `/v1`.
`VC_CLAUDE_UPSTREAM_AUTH` принимает `x-api-key` (по умолчанию), `bearer` или
`both`. `VC_CLAUDE_MODEL_MAP` необязателен: без него имя модели передаётся без
изменений.

Перезапустите контейнер:

```bash
docker compose up -d --build
```

На машине с Claude Code:

```bash
export ANTHROPIC_BASE_URL=https://voicechat.example.com
# Claude Code ожидает наличие учётных данных; сервер закрытой сети это значение
# намеренно не проверяет и не передаёт upstream.
export ANTHROPIC_AUTH_TOKEN=unused-local-network-token
claude --model sonnet
```

Для локальной проверки без Claude Code:

```bash
curl http://localhost:8787/v1/messages \
  -H 'content-type: application/json' \
  -H 'anthropic-version: 2023-06-01' \
  -d '{"model":"claude-sonnet-4-6","max_tokens":64,"messages":[{"role":"user","content":"Ответь: ok"}]}'
```

Входящая авторизация отсутствует намеренно. Не публикуйте эти маршруты в открытый
интернет без VPN, firewall или авторизации на reverse proxy: любой доступ к ним
расходует ключ upstream.

## Сборка образа вручную

```bash
docker build -t voicechat .
docker run --rm -p 8787:8787 \
  -v voicechat-data:/data \
  -v voicechat-claude:/home/node/.claude \
  -v voicechat-codex:/home/node/.codex \
  voicechat
# затем один раз залогиниться внутри контейнера (см. «Аутентификация»).
```

## Заметки по реализации

- Сервер не компилируется в JS — запускается через `tsx` из исходников
  (см. `Dockerfile`), поэтому образ содержит исходники + `node_modules`.
- `better-sqlite3` собирается из исходников в стадии build (toolchain
  `python3/make/g++`), runtime — на той же glibc-базе (bookworm).
- Web собирается без `VITE_SERVER_URL` → тот же origin, что и API (один порт).
