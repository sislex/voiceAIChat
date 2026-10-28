#!/usr/bin/env bash
set -euo pipefail
# Execute as the common component registry owner (UID 1000).
source /etc/voicechat/production.env
: "${VC_REPO_DIR:?}"
: "${SISLEXA_COMPONENTS_DIR:?}"
cd "$VC_REPO_DIR"
exec node --import tsx scripts/component-rotation.mjs --directory "$SISLEXA_COMPONENTS_DIR" --days 7 --apply
