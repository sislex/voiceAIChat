---
title: Деплой: Docker, HTTPS, прод-сервер, env
updated: 2026-07-30
checked: a87feea
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

`ssh root@45.135.182.251`, каталог `/root/voiceAIChat`. Обновление:

```bash
git pull && docker compose up -d --build
```

Секреты (`VC_ADMIN_PASSWORD`, upstream-ключи) задаются в shell/`.env` на сервере и
в репозиторий не попадают.
## Прод-каталог заодно рабочая копия — коммит там пушится сразу

`/root/voiceAIChat` — не только прод-чекаут, из которого `docker compose` собирает
образ, но и общая рабочая копия чат-сессий на этой машине. Второй писатель в `main`
— CI-раннер: шаг «Влить ветку задачи в прод-ветку» пушит мерж в `origin/main` из
клона в `repos_root`, а шаг «Обновить прод-контейнер» поднимает прод
**только `git pull --ff-only`** (см. [features/ci-runner.md](features/ci-runner.md)).

Отсюда правило: **закоммитил в `/root/voiceAIChat` — сразу `git push origin main`.**
Незапушенный локальный коммит проходит проверку на локальные изменения (дерево-то
чистое) и разводит ветки в момент, когда CI пушит свой мерж; `pull --ff-only`
падает с `fatal: Not possible to fast-forward` (код `128`), и ран встаёт на шаге
обновления прода. Лечится это на стороне прод-каталога — поднять локальный коммит
в `origin/main` (`git pull --rebase` + `push`, либо влить его через клон), а не
ослаблением `--ff-only`: прод обязан оставаться линейным продолжением `origin/main`,
иначе он собирается из кода, которого ни у кого больше нет.

Длинные правки и гейт держи в отдельном клоне (`docs/kb/features/ci-runner.md` →
`repos_root`), а прод-каталог используй как деплой-чекаут.

