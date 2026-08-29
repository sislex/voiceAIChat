#!/usr/bin/env bash
# Локальный browser-runner для живой проверки Playwright Reader.
#
# Зачем отдельно от docker-compose: compose поднимает весь стенд (сервер, БД,
# исполнителей) и занимает 8787 — а разработчику для проверки Reader нужен
# только изолированный Chromium. Контейнер один, порт свой, чужие данные не
# трогаются.
set -Eeuo pipefail

NAME=${VC_BROWSER_LOCAL_NAME:-vc-browser-local}
PORT=${VC_BROWSER_LOCAL_PORT:-8892}
TOKEN=${VC_BROWSER_RUNNER_TOKEN:-vc-local-reader}
IMAGE=voicechat-browser-runner:local

case "${1:-up}" in
  up)
    if [[ -z $(docker images -q "$IMAGE") ]]; then
      echo "собираю $IMAGE (первый раз тянется образ Playwright, ~2 ГБ)…"
      docker build --target browser-runner-runtime -t "$IMAGE" "$(dirname "$0")/.."
    fi
    docker rm -f "$NAME" >/dev/null 2>&1 || true
    # shm по умолчанию 64 МБ — Chromium на таком умирает.
    docker run -d --name "$NAME" --shm-size=1g \
      -e VC_BROWSER_RUNNER_TOKEN="$TOKEN" \
      ${VC_BROWSER_HOST_ALIASES:+-e VC_BROWSER_HOST_ALIASES="$VC_BROWSER_HOST_ALIASES"} \
      -p "$PORT:8792" "$IMAGE" >/dev/null
    for _ in $(seq 1 30); do
      if curl -fsS -m 3 -H "Authorization: Bearer $TOKEN" "http://localhost:$PORT/v1/health" >/dev/null 2>&1; then
        echo "раннер готов: http://localhost:$PORT (токен $TOKEN)"
        exit 0
      fi
      sleep 1
    done
    echo "раннер не поднялся, лог:" >&2
    docker logs "$NAME" 2>&1 | tail -20 >&2
    exit 1
    ;;
  down) docker rm -f "$NAME" >/dev/null 2>&1 && echo "остановлен" || echo "не запущен" ;;
  logs) docker logs -f "$NAME" ;;
  *) echo "использование: $0 [up|down|logs]" >&2; exit 2 ;;
esac
