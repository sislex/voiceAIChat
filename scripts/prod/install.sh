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
install -d -m 755 /usr/local/lib/voicechat

# Маленький host-side HTTP API. Он слушает только Unix-сокет, принимает один
# фиксированный POST /deploy и никогда не передаёт пользовательский ввод в shell.
cat >/usr/local/lib/voicechat/deploy-api.py <<'PY'
#!/usr/bin/env python3
import fcntl
import http.server
import json
import os
import socketserver
import subprocess

SOCKET = '/run/voicechat/deploy-api.sock'
SOCKET_UID = 1000  # node in the server container
SOCKET_GID = 65532
LOCK = '/var/lock/voicechat-deploy.lock'
COMMAND = '/usr/local/bin/voicechat-deploy'


def deploy_running():
    fd = os.open(LOCK, os.O_CREAT | os.O_RDWR, 0o644)
    try:
        try:
            fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            return True
        fcntl.flock(fd, fcntl.LOCK_UN)
        return False
    finally:
        os.close(fd)


class Handler(http.server.BaseHTTPRequestHandler):
    def send_json(self, status, body):
        payload = json.dumps(body, ensure_ascii=False).encode()
        self.send_response(status)
        self.send_header('content-type', 'application/json; charset=utf-8')
        self.send_header('content-length', str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)

    def do_POST(self):
        if self.path != '/deploy':
            self.send_json(404, {'error': 'not found'})
            return
        if deploy_running():
            self.send_json(409, {'status': 'running', 'message': 'deployment already running'})
            return
        try:
            completed = subprocess.run(
                [COMMAND], stdin=subprocess.DEVNULL, capture_output=True,
                text=True, timeout=10, check=False)
        except (OSError, subprocess.TimeoutExpired) as error:
            print(f'deploy launch failed: {error}', flush=True)
            self.send_json(503, {'error': str(error)})
            return
        if completed.returncode != 0:
            detail = completed.stderr.strip() or completed.stdout.strip() or f'exit {completed.returncode}'
            print(f'deploy launch failed: {detail}', flush=True)
            self.send_json(503, {'error': detail})
            return
        message = completed.stdout.strip() or 'deployment started'
        print(message, flush=True)
        self.send_json(202, {'status': 'accepted', 'message': message})

    def log_message(self, fmt, *args):
        # AF_UNIX client_address is not an (address, port) tuple, so the base
        # address_string() raises IndexError before response headers are sent.
        print('unix - %s' % (fmt % args), flush=True)


class UnixServer(socketserver.UnixStreamServer):
    allow_reuse_address = True


if os.path.exists(SOCKET):
    os.unlink(SOCKET)
with UnixServer(SOCKET, Handler) as server:
    os.chmod(SOCKET, 0o660)
    os.chown(SOCKET, SOCKET_UID, SOCKET_GID)
    server.serve_forever()
PY
chmod 755 /usr/local/lib/voicechat/deploy-api.py

cat >/etc/systemd/system/voicechat-deploy-api.service <<'EOF'
[Unit]
Description=voiceAIChat host-side deploy API (Unix socket only)
After=docker.service
Requires=docker.service

[Service]
Type=simple
RuntimeDirectory=voicechat
RuntimeDirectoryMode=0755
RuntimeDirectoryPreserve=restart
ExecStart=/usr/bin/python3 /usr/local/lib/voicechat/deploy-api.py
Restart=on-failure

[Install]
WantedBy=multi-user.target
EOF

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
systemctl enable voicechat-deploy-api.service
systemctl restart voicechat-deploy-api.service
systemctl enable --now voicechat-watchdog.timer

echo 'установлено:'
echo '  /usr/local/bin/voicechat-deploy    — деплой (переживает обрыв канала)'
echo '  /usr/local/bin/voicechat-watchdog  — сторож, systemd-таймер раз в минуту'
echo '  /run/voicechat/deploy-api.sock      — host-side API запуска деплоя'
systemctl --no-pager --full status voicechat-deploy-api.service
systemctl list-timers voicechat-watchdog.timer --no-pager
