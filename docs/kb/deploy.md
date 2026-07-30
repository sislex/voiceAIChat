---
title: Деплой: Docker, HTTPS, прод-сервер, env
updated: 2026-07-30
checked: 102bfbf
areas:
  - Dockerfile
  - docker-compose.yml
  - docker-entrypoint.sh
  - Caddyfile
  - .dockerignore
  - apps/server/src/config.ts
---

# Деплой: Docker, HTTPS, прод-сервер, env

Пошаговый рантайм-гайд — `docs/docker.md`. Здесь то, что важно понимать до правок.

## Образ

Многостадийный `Dockerfile`. Особенности, которые легко сломать:

- **Сервер не компилируется в JS** — запускается `tsx` прямо из исходников и
  резолвит `@voicechat/shared` из `.ts` через workspace-симлинки. Поэтому в
  runtime-слой копируются исходники + `node_modules` + `tsx`, а не `dist/`. Не
  добавляй шаг «собрать сервер» — его нет намеренно.
- **better-sqlite3 нативный** → в build-стадии нужен toolchain (python3/make/g++),
  база — glibc (`bookworm`), не musl.
- **whisper-cli** собирается отдельной стадией из whisper.cpp v1.7.5 статически
  (`BUILD_SHARED_LIBS=OFF`); в runtime нужен `libgomp1`.
- **web собирается без `VITE_SERVER_URL`** → same-origin, тот же порт, что и API
  (`VC_WEB_DIR=/app/apps/web/dist` раздаётся сервером).
- Процесс работает под пользователем `node`, не root: claude CLI запрещает
  `--dangerously-skip-permissions` под root/sudo. `gosu` в entrypoint делает
  `chown` томов под root и сбрасывает привилегии.
- `ca-certificates` — codex это Rust-бинарь с rustls, без системного хранилища
  падает на `invalid peer certificate: UnknownIssuer`. `bubblewrap` — его песочница.

## Аутентификация CLI живёт в контейнере

Тома `vc-claude` (`/home/node/.claude`) и `vc-codex` (`/home/node/.codex`) —
**именованные**, не bind-mount с хоста. Логин делается один раз внутри контейнера
и обязательно под `node`:

```bash
docker compose exec -u node voicechat claude auth login   # или claude setup-token
docker compose exec -u node voicechat codex login
```

Каталоги создаются в образе с владельцем `node` — иначе Docker создал бы новые
тома root-овыми и логин был бы недоступен серверному процессу.

## HTTPS по IP

`getUserMedia` (микрофон) работает только в secure-контексте, а у прода нет
домена. Поэтому рядом с приложением стоит Caddy с `tls internal` и
`default_sni <ip>` (браузер при заходе по голому IP не шлёт SNI). Сертификат
локального CA — предупреждение браузера принимается один раз. Порты 80→443
редиректом. Локальный CA и сертификаты — в томе `vc-caddy`.

## Память контейнера — это не просто лимит

`mem_limit` читается автоопределением ресурсов через cgroup и напрямую включает
или выключает распознавание речи (см. `stt-tts.md`). При `1g` доступна модель
`small` и TTS; для `small+medium` нужно `1536m`, для `large-v3-turbo` — 2 ГБ+.
Меняешь `mem_limit` — знай, что меняешь набор возможностей приложения.

## Переменные окружения

Полный разбор — `apps/server/src/config.ts` (одна функция `loadConfig`).
Группы: `PORT`/`HOST`; данные и артефакты (`VC_DATA_DIR`, `VC_MODELS_DIR`,
`VC_WHISPER_CLI`, `VC_PIPER_*`, `VC_WEB_DIR`); раздача сборок
(`VC_AGENT_APP`, `VC_DESKTOP_APP`); первый админ (`VC_ADMIN_PASSWORD`); пороги
памяти (`VC_MIN_MEM_STT`, `VC_MIN_MEM_TTS`); входящий gateway
(`VC_CLAUDE_GATEWAY_BACKEND`, `VC_CLAUDE_UPSTREAM_URL`,
`VC_CLAUDE_UPSTREAM_API_KEY`, `VC_CLAUDE_UPSTREAM_AUTH`, `VC_CLAUDE_MODEL_MAP`); GitHub PR merge (`VC_GITHUB_TOKEN`).
`VC_CLAUDE_MODEL_MAP` — JSON-объект; невалидный JSON валит старт с понятной
ошибкой (это осознанно, а не баг).

## Прод

`ssh root@45.135.182.251`, каталог `/root/voiceAIChat`. Обновление — **только через
`voicechat-deploy`** (ставится `bash scripts/prod/install.sh`, см. ниже):

```bash
voicechat-deploy               # вернётся сразу, деплой идёт в фоне
tail -f /var/log/voicechat-deploy.log
```

Секреты (`VC_ADMIN_PASSWORD`, upstream-ключи) задаются в shell/`.env` на сервере и
в репозиторий не попадают.

### Почему нельзя звать `docker compose up -d --build` напрямую

Любая команда, пришедшая через канал «модель → сервер → агент», живёт ограниченное
время: сервер передаёт агенту `timeoutMs` (MCP-мост `remoteBashMcp.ts` — 120 с по
умолчанию, максимум 300 с), а агент по истечении делает `SIGKILL`
(`apps/agent/src/exec.ts`). Через ssh похожая история — SIGHUP при обрыве сессии.
`docker compose up -d --build` в этот лимит не укладывается, и убийство приходит в
самую опасную точку: старый контейнер уже удалён, новый ещё **создан, но не
запущен**. `restart: unless-stopped` не помогает — политика рестарта применяется
только к контейнеру, который хоть раз стартовал.

Симптом (инцидент 2026-07-30): Caddy жив, `https://45.135.182.251/` отдаёт `502`,
`docker compose ps -a` показывает `voicechat` в `Created` без единой строки логов,
а имя контейнера получает хеш-префикс (`<hash>_voiceaichat-voicechat-1` — так docker
разводит конфликт имён при пересоздании; префикс безвреден и уйдёт при следующем
полном деплое). Разовое лечение — `docker compose up -d`: образ уже собран,
не хватает только старта.

### Две линии защиты (`scripts/prod/`)

- `deploy.sh` → `/usr/local/bin/voicechat-deploy` — первым делом перезапускает себя
  через `setsid nohup` и возвращает управление, поэтому смерть канала деплою
  безразлична (проверено: `SIGKILL` по группе процессов родителя, потомок дошёл до
  конца). Дальше — `flock` (лок на дескрипторе, освобождается даже при `SIGKILL`),
  `git pull --ff-only`, `up -d --build`, ожидание `/api/health` до 5 минут; при
  неудаче в лог попадают `ps -a` и последние 50 строк логов контейнера.
- `watchdog.sh` → `/usr/local/bin/voicechat-watchdog`, systemd-таймер
  `voicechat-watchdog.timer` раз в минуту — поднимает контейнер, если тот в
  `created` или отсутствует. Из `exited`/`paused` **не** поднимает: это результат
  намеренного `docker compose stop`. Глушится файлом
  `/root/voiceAIChat/.deploy-paused`. Берёт тот же lock, что деплой, — во время
  деплоя не вмешивается. Лог: `/var/log/voicechat-watchdog.log`.

Установка/переустановка (идемпотентна): `cd /root/voiceAIChat && bash scripts/prod/install.sh`.
Скрипты копируются в `/usr/local/bin` намеренно — деплой делает `git pull`, и
запускаться из файла, который этот pull перезаписывает, ему нельзя.
