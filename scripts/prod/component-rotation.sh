#!/usr/bin/env bash
set -euo pipefail
# Install without rerunning install.sh (which replaces the operator environment).
if [[ ${1:-} == --install ]]; then
  [[ $EUID == 0 ]] || { echo 'Timer installation requires root' >&2; exit 1; }
  rotation_repo=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)
  install -d -m 755 /usr/local/lib/voicechat
  install -m 755 "$rotation_repo/scripts/prod/component-rotation.sh" /usr/local/lib/voicechat/component-rotation.sh
  install -m 644 "$rotation_repo/deploy/voicechat-component-rotation.service" /etc/systemd/system/
  install -m 644 "$rotation_repo/deploy/voicechat-component-rotation.timer" /etc/systemd/system/
  systemctl daemon-reload
  systemctl enable --now voicechat-component-rotation.timer
  exit 0
fi
# systemd reads the root-owned environment before dropping to the registry owner.
: "${VC_REPO_DIR:?}"
: "${SISLEXA_COMPONENTS_DIR:?}"
cd "$VC_REPO_DIR"
exec node --import tsx scripts/component-rotation.mjs --directory "$SISLEXA_COMPONENTS_DIR" --days 7 --apply
