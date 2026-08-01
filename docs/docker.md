# Запуск voiceAIChat в Docker

Compose поднимает четыре контейнера: `voicechat` (Fastify + web), `caddy` и два
внутренних исполнителя LLM — `runner-work` и `runner-personal`. Порты наружу есть
только у `voicechat`/`caddy`; оба runner'а живут во внутренней docker-сети.

## Быстрый старт

```bash
npm run docker          # = docker compose up --build -d
# открыть http://localhost:8787
npm run docker:down     # остановить
```

По умолчанию сервер отправляет и Claude, и Codex ходы в `runner-work` через
внутренний HTTP API (`http://runner-work:8790`). `runner-personal` поднимается
сразу, но нужен для отдельной личной авторизации и дальнейшей регистрации в UI.

## Аутентификация runner-work / runner-personal

### `runner-work`

`runner-work` переиспользует существующие volume `vc-claude` и `vc-codex`, поэтому
при деплое со старой схемы рабочая авторизация переезжает без повторного логина.
При первом старте compose старые пользовательские профили из `vc-data:/data/cli-users`
копируются в отдельный volume `vc-runner-work-data`.

Для свежей установки логин делается один раз внутри контейнера и обязательно под
пользователем `node`:

```bash
docker compose exec -u node runner-work claude auth login
# или headless:
docker compose exec -u node runner-work claude setup-token

docker compose exec -u node runner-work codex login
```

### `runner-personal`

`runner-personal` хранит собственные volume авторизации и профилей и по умолчанию
несёт только Claude CLI. Логин тоже одноразовый:

```bash
docker compose exec -u node runner-personal claude auth login
# или headless:
docker compose exec -u node runner-personal claude setup-token
```

Статус входа виден в приложении: **Настройки → Агент → «Вход в CLI»**. Если
`runner-personal` нужно использовать для реальных ходов, его URL и токен
добавляются в реестр исполнителей через админку.

## Данные и volume

- `vc-data` — БД (`voicechat.db`) и вложения сервера.
- `vc-runner-work-data` — профили `runner-work` (`/data/cli-users/...`).
- `vc-runner-personal-data` — профили `runner-personal`.
- `vc-claude`, `vc-codex` — прежняя рабочая авторизация `runner-work`.
- `vc-runner-personal-claude`, `vc-runner-personal-codex` — личная авторизация `runner-personal`.
- `vc-caddy` — локальный CA и сертификаты HTTPS.

## Переменные окружения

| Переменная | Где используется | Значение по умолчанию | Назначение |
|---|---|---|---|
| `VC_LLM_RUNNER_TOKEN` | `voicechat`, `runner-*` | `voicechat-runner-local-token` | Bearer-токен внутреннего API исполнителей; для прода задай случайное значение в `.env` |
| `VC_DATA_DIR` | `voicechat`, `runner-*` | `/data` | данные сервера или профили исполнителя |
| `HOST` | все сервисы | `0.0.0.0` | слушать все интерфейсы контейнера |
| `PORT` | `voicechat` / `runner-*` | `8787` / `8790` | HTTP-порт сервера или исполнителя |
| `VC_ADMIN_PASSWORD` | `voicechat` | пусто | пароль admin при первом создании БД |
| `VC_CLAUDE_GATEWAY_*` | `voicechat` | см. compose | входящий Anthropic-compatible gateway |

В проде `VC_LLM_RUNNER_TOKEN`, `VC_ADMIN_PASSWORD` и upstream-ключи держи в
shell/`.env` рядом с `docker-compose.yml`, не в репозитории.

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

Перезапустите контейнеры:

```bash
docker compose up -d --build
```

На машине с Claude Code:

```bash
export ANTHROPIC_BASE_URL=https://voicechat.example.com
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

## Сборка образов вручную

```bash
docker build --target server-runtime -t voicechat-server .
docker build --target llm-runner-runtime -t voicechat-llm-runner .
```

Для `runner-personal` без Codex CLI используйте build-arg:

```bash
docker build \
  --target llm-runner-runtime \
  --build-arg INSTALL_CLAUDE_CLI=1 \
  --build-arg INSTALL_CODEX_CLI=0 \
  -t voicechat-llm-runner-personal .
```

## Заметки по реализации

- Серверный образ больше не содержит `claude`/`codex`; они ставятся только в
  target `llm-runner-runtime`.
- `docker-entrypoint.sh` умеет один раз перенести старые `vc-data:/data/cli-users`
  в отдельный data-volume `runner-work`, не трогая серверную БД и вложения.
- `better-sqlite3` собирается из исходников в build-стадии, runtime остаётся на
  glibc-базе (`bookworm`).
- Web собирается без `VITE_SERVER_URL` → тот же origin, что и API.
