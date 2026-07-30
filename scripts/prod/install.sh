#!/usr/bin/env bash
# Ставит на прод-хост деплой-скрипт и сторожа. Идемпотентно, запускать под root:
#   cd /root/voiceAIChat && bash scripts/prod/install.sh
#
# Скрипты копируются в /usr/local/bin намеренно: деплой делает `git pull`, и запускать
# его из файла, который этот же pull перезаписывает, — плохая идея.

set -Eeuo pipefail

SRC=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)

install -m 755 "$SRC/deploy.sh" /usr/local/bin/voicechat-deploy
install -m 755 "$SRC/watchdog.sh" /usr/local/bin/voicechat-watchdog

cat >/etc/systemd/system/voicechat-watchdog.service <<'EOF'
[Unit]
Description=voiceAIChat: поднять контейнер, если деплой оборвался на полпути
After=docker.service
Requires=docker.service

[Service]
Type=oneshot
ExecStart=/usr/local/bin/voicechat-watchdog
EOF

cat >/etc/systemd/system/voicechat-watchdog.timer <<'EOF'
[Unit]
Description=voiceAIChat watchdog раз в минуту

[Timer]
OnBootSec=60
OnUnitActiveSec=60
AccuracySec=10s

[Install]
WantedBy=timers.target
EOF

systemctl daemon-reload
systemctl enable --now voicechat-watchdog.timer

echo 'установлено:'
echo '  /usr/local/bin/voicechat-deploy    — деплой (переживает обрыв канала)'
echo '  /usr/local/bin/voicechat-watchdog  — сторож, systemd-таймер раз в минуту'
systemctl list-timers voicechat-watchdog.timer --no-pager
