#!/usr/bin/env bash
# Страховка на прод-хосте: поднимает voicechat, если деплой оборвался, не доведя
# контейнер до старта. Ставится systemd-таймером (см. install.sh), раз в минуту.
#
# Почему это нужно: убитый на полпути `docker compose up -d --build` оставляет новый
# контейнер в статусе `created` (или вовсе не создаёт его, успев удалить старый).
# `restart: unless-stopped` тут не спасает — политика рестарта применяется только к
# контейнеру, который хоть раз стартовал.
#
# Чего сторож НЕ делает: не поднимает контейнер из `exited`/`paused` — это состояние
# после намеренного `docker compose stop`. Полностью выключить сторож на время работ:
# `touch "$VC_REPO_DIR/.deploy-paused"` (убрать файл — снова включён).

set -Eeuo pipefail

if [[ -z ${VC_REPO_DIR:-} && -r /etc/voicechat/production.env ]]; then
  source /etc/voicechat/production.env
fi
: "${VC_REPO_DIR:?VC_REPO_DIR не задан; переустановите scripts/prod/install.sh}"
REPO=$VC_REPO_DIR
LOG=${VC_WATCHDOG_LOG:-/var/log/voicechat-watchdog.log}
LOCK=${VC_DEPLOY_LOCK:-/var/lock/voicechat-deploy.lock}
PROJECT=${VC_COMPOSE_PROJECT:-voiceaichat}

[[ -e "$REPO/.deploy-paused" ]] && exit 0

# Тот же lock, что у deploy.sh: пока деплой идёт, вмешиваться нельзя — контейнер
# законно находится в промежуточном состоянии.
exec 9>"$LOCK"
flock -n 9 || exit 0

state=$(docker ps -a \
  --filter "label=com.docker.compose.project=$PROJECT" \
  --filter 'label=com.docker.compose.service=voicechat' \
  --format '{{.State}}' | head -1)

case "$state" in
  running) exit 0 ;;
  created) reason='контейнер в created — деплой оборвался до старта' ;;
  '') reason='контейнера нет — деплой оборвался после удаления старого' ;;
  *) exit 0 ;; # exited/paused/dead — намеренная остановка, не трогаем
esac

printf '[%s] %s → docker compose up -d\n' "$(date -Is)" "$reason" >>"$LOG"
cd "$REPO"
docker compose up -d >>"$LOG" 2>&1
printf '[%s] после подъёма: %s\n' "$(date -Is)" \
  "$(curl -fsS -m 5 "${VC_HEALTH_URL:-http://127.0.0.1:8787/api/health}" 2>&1 || echo 'health недоступен')" >>"$LOG"
