// Генератор установщика агента для Linux и macOS (bash) — брат androidInstall.ts
// и windowsInstall.ts. Пользователь копирует одну команду из UI:
//   curl -fsSLk <BASE>/api/agents/install-linux.sh | bash -s -- 'vcagent:…'
//
// Скрипт идемпотентен: повторный запуск = обновление (гасит старый агент, кладёт
// свежий скрипт, стартует новый). Поэтому отдельной «команды обновления» нет.
//
// Node ставим ПОРТАТИВНЫЙ в каталог агента, а не пакетным менеджером: sudo может
// не быть, дистрибутивы дают древние версии, а нам нужна 22+. Системный node
// используем, если он подходит по версии.
//
// Строку подключения ищем в три шага: аргумент → сохранённый файл → командная
// строка ЖИВОГО агента. Третий шаг важен: машина могла быть установлена вручную
// или в другой каталог, и без него обновление оставило бы её без токена.

export type UnixOs = 'linux' | 'macos'

/** Собирает bash-установщик с подставленным адресом сервера. */
export function buildUnixInstallScript(baseUrl: string, os: UnixOs): string {
  // Отрезаем хвостовой слэш, чтобы не получить '//api/...'.
  const server = baseUrl.replace(/\/+$/, '')
  const isMac = os === 'macos'
  const nodePlatform = isMac ? 'darwin' : 'linux'
  const osName = isMac ? 'macOS' : 'Linux'

  // Как достать командную строку процесса: на macOS нет /proc.
  const cmdlineOf = isMac
    ? `ps -o command= -p "$1" 2>/dev/null | tr ' ' '\\n'`
    : `tr '\\0' '\\n' < "/proc/$1/cmdline" 2>/dev/null`

  // Перезапуск поручаем супервизору: он доведёт дело до конца, даже если наш
  // процесс погибнет вместе со старым агентом.
  const restart = isMac
    ? `launchctl kickstart -k "gui/$(id -u)/com.voicechat.agent" 2>/dev/null || true`
    : `systemctl --user restart voicechat-agent.service 2>/dev/null || true`

  const autostart = isMac
    ? `PLIST="$HOME/Library/LaunchAgents/com.voicechat.agent.plist"
mkdir -p "$HOME/Library/LaunchAgents"
cat > "$PLIST" <<PLISTEOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>com.voicechat.agent</string>
  <key>ProgramArguments</key><array><string>$AGENT_DIR/run.sh</string></array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>$AGENT_DIR/agent.log</string>
  <key>StandardErrorPath</key><string>$AGENT_DIR/agent.log</string>
</dict></plist>
PLISTEOF
if launchctl bootstrap "gui/$(id -u)" "$PLIST" 2>/dev/null || launchctl load "$PLIST" 2>/dev/null; then
  echo "  автозапуск: launchd (com.voicechat.agent)"
  SUPERVISED=1
fi`
    : `if command -v systemctl >/dev/null 2>&1 && systemctl --user show-environment >/dev/null 2>&1; then
  UNIT_DIR="$HOME/.config/systemd/user"
  mkdir -p "$UNIT_DIR"
  cat > "$UNIT_DIR/voicechat-agent.service" <<UNITEOF
[Unit]
Description=Голос·Чат — компаньон-агент
After=network-online.target

[Service]
ExecStart=$AGENT_DIR/run.sh
Restart=always
RestartSec=5

[Install]
WantedBy=default.target
UNITEOF
  systemctl --user daemon-reload
  if systemctl --user enable voicechat-agent.service 2>/dev/null; then
    echo "  автозапуск: systemd --user (voicechat-agent.service)"
    # Чтобы агент жил и без активной сессии пользователя.
    loginctl enable-linger "$USER" 2>/dev/null || true
    SUPERVISED=1
  fi
else
  echo "  systemd --user недоступен — автозапуск не настроен"
fi`

  return `#!/usr/bin/env bash
# Установщик компаньон-агента Голос·Чат для ${osName}.
# Повторный запуск обновляет агента: гасит старый, кладёт свежий скрипт, стартует новый.
set -euo pipefail

SERVER="${server}"
CONN="\${1:-\${VC_AGENT_CONNECTION:-}}"
AGENT_DIR="$HOME/.voicechat-agent"
SUPERVISED=0
mkdir -p "$AGENT_DIR"

# --- Node.js -------------------------------------------------------------
echo "[1/7] Проверяю Node.js (нужна 22+)…"
node_major() {
  local out
  out="$("$1" -v 2>/dev/null || true)"
  case "$out" in
    v*) echo "\${out#v}" | cut -d. -f1 ;;
    *) echo 0 ;;
  esac
}

NODE_BIN=""
if command -v node >/dev/null 2>&1 && [ "$(node_major node)" -ge 22 ]; then
  NODE_BIN="$(command -v node)"
elif [ -x "$AGENT_DIR/node/bin/node" ] && [ "$(node_major "$AGENT_DIR/node/bin/node")" -ge 22 ]; then
  NODE_BIN="$AGENT_DIR/node/bin/node"
else
  echo "  Node.js 22+ не найден — качаю портативный (без sudo)…"
  ARCH="$(uname -m)"
  case "$ARCH" in
    x86_64|amd64) NARCH=x64 ;;
    aarch64|arm64) NARCH=arm64 ;;
    armv7l) NARCH=armv7l ;;
    *) echo "Неизвестная архитектура $ARCH — поставьте Node.js 22+ вручную и повторите."; exit 1 ;;
  esac
  # Первая запись в index.json — самая свежая версия.
  NVER="$(curl -fsSL https://nodejs.org/dist/index.json | grep -o '"version":"v[0-9.]*"' | awk 'NR == 1 { first = $0 } END { print first }' | sed 's/.*"v/v/;s/"//')"
  [ -n "$NVER" ] || { echo "не удалось узнать версию Node.js"; exit 1; }
  echo "  $NVER ($NARCH)"
  curl -fsSL "https://nodejs.org/dist/$NVER/node-$NVER-${nodePlatform}-$NARCH.tar.gz" -o "$AGENT_DIR/node.tar.gz"
  rm -rf "$AGENT_DIR/node" "$AGENT_DIR/node.tmp"
  mkdir -p "$AGENT_DIR/node.tmp"
  tar -xzf "$AGENT_DIR/node.tar.gz" -C "$AGENT_DIR/node.tmp" --strip-components=1
  mv "$AGENT_DIR/node.tmp" "$AGENT_DIR/node"
  rm -f "$AGENT_DIR/node.tar.gz"
  NODE_BIN="$AGENT_DIR/node/bin/node"
fi
echo "  использую $NODE_BIN ($("$NODE_BIN" -v))"

# --- Свежий скрипт агента ------------------------------------------------
echo "[2/7] Ставлю нативный терминал…"
NODE_DIR="$(dirname "$NODE_BIN")"
if [ -x "$NODE_DIR/npm" ]; then
  NPM_BIN="$NODE_DIR/npm"
elif command -v npm >/dev/null 2>&1; then
  NPM_BIN="$(command -v npm)"
else
  echo "npm не найден рядом с Node.js — невозможно установить нативный терминал"
  exit 1
fi
# Пакет публикует готовые бинарники для Linux/macOS x64 и arm64, компилятор не нужен.
# --prefix кладёт node_modules рядом с voicechat-agent.cjs, откуда обычный require
# находит модуль даже у самодостаточного CJS-бандла.
PATH="$NODE_DIR:$PATH" "$NPM_BIN" install --prefix "$AGENT_DIR" --omit=dev --no-save --no-audit --no-fund @lydell/node-pty@1.1.0
"$NODE_BIN" -e "require('$AGENT_DIR/node_modules/@lydell/node-pty')"

echo "[3/7] Скачиваю агента…"
# Имя временного файла ОБЯЗАНО оканчиваться на .cjs: node --check выбирает
# модульную систему по расширению и на «.cjs.new» падает с UNKNOWN_FILE_EXTENSION.
curl -fsSLk "$SERVER/api/agents/script" -o "$AGENT_DIR/voicechat-agent.new.cjs"
test -s "$AGENT_DIR/voicechat-agent.new.cjs"
"$NODE_BIN" --check "$AGENT_DIR/voicechat-agent.new.cjs" 2>/dev/null || {
  echo "скачанный скрипт битый — обновление отменено"
  rm -f "$AGENT_DIR/voicechat-agent.new.cjs"
  exit 1
}

# --- Строка подключения --------------------------------------------------
echo "[4/7] Ищу строку подключения…"
cmdline_of() { ${cmdlineOf}; }

if [ -n "$CONN" ]; then
  echo "  из аргумента"
elif [ -f "$AGENT_DIR/connection" ] && [ -s "$AGENT_DIR/connection" ]; then
  CONN="$(cat "$AGENT_DIR/connection")"
  echo "  из сохранённого файла"
else
  # Агент мог быть установлен вручную или в другой каталог — забираем строку из
  # аргументов живого процесса, ПОКА он жив.
  for pid in $(pgrep -f "voicechat-agent[.]cjs" 2>/dev/null || true); do
    found="$(cmdline_of "$pid" | grep -m1 '^vcagent:' || true)"
    if [ -n "$found" ]; then
      CONN="$found"
      echo "  восстановил из работающего агента (pid $pid)"
      break
    fi
  done
fi
[ -n "$CONN" ] || {
  echo "Не нашёл строку подключения. Скопируйте команду установки из настроек — в ней она есть."
  exit 1
}

# --- Подмена файлов (старый агент ещё работает — ему это не мешает) -------
# Порядок важен: сначала ВСЯ работа с файлами, и только последним действием —
# перезапуск. Иначе установщик убивает сам себя: агент живёт в cgroup своего
# systemd-сервиса, а systemctl stop гасит весь cgroup, включая процессы,
# которые агент запустил (setsid меняет сессию, но не cgroup).
echo "[5/7] Ставлю новый скрипт…"
[ -f "$AGENT_DIR/voicechat-agent.cjs" ] &&
  mv "$AGENT_DIR/voicechat-agent.cjs" "$AGENT_DIR/voicechat-agent.cjs.prev" || true
mv "$AGENT_DIR/voicechat-agent.new.cjs" "$AGENT_DIR/voicechat-agent.cjs"
printf '%s' "$CONN" > "$AGENT_DIR/connection"
chmod 600 "$AGENT_DIR/connection"

cat > "$AGENT_DIR/run.sh" <<RUNEOF
#!/usr/bin/env bash
# Сервер может стоять за самоподписанным TLS — агент должен ему доверять.
export VC_AGENT_INSECURE_TLS=1
cd "\\$HOME"
exec "$NODE_BIN" "$AGENT_DIR/voicechat-agent.cjs" --connection "\\$(cat "$AGENT_DIR/connection")"
RUNEOF
chmod +x "$AGENT_DIR/run.sh"

echo "[6/7] Настраиваю автозапуск…"
${autostart}

echo "[7/7] Перезапускаю агента…"
# Дальше этой строки код может не выполниться: перезапуск гасит старый агент, а
# вместе с ним — и нас (см. про cgroup выше). Поэтому всё, что нужно, уже сделано,
# а сам перезапуск поручаем супервизору: systemd/launchd доведут его до конца даже
# если наш процесс умрёт. Проверять результат здесь нельзя — только по версии в UI.
if [ "$SUPERVISED" = "1" ]; then
  ${restart}
  echo "Перезапуск поручен супервизору. Машина вернётся в список через несколько секунд."
else
  # Супервизора нет: переключаем отдельным отвязанным скриптом. Его имя намеренно
  # не совпадает с шаблоном pkill, иначе он погасит сам себя.
  cat > "$AGENT_DIR/vc-switch.sh" <<'SWEOF'
#!/usr/bin/env bash
cd "$(dirname "$0")"
agents_alive() { pgrep -f "voicechat-agent[.]cjs" 2>/dev/null | wc -l | tr -d ' '; }
for i in 1 2 3; do
  [ "$(agents_alive)" = "0" ] && break
  pkill -f "voicechat-agent[.]cjs" 2>/dev/null || true
  sleep 1
done
# Агент мог унаследовать SIG_IGN на SIGTERM от обёртки — тогда добиваем.
[ "$(agents_alive)" != "0" ] && { pkill -9 -f "voicechat-agent[.]cjs" 2>/dev/null || true; sleep 1; }
nohup ./run.sh >> agent.log 2>&1 &
SWEOF
  chmod +x "$AGENT_DIR/vc-switch.sh"
  ( setsid nohup "$AGENT_DIR/vc-switch.sh" > /dev/null 2>&1 < /dev/null & ) 2>/dev/null ||
    ( nohup "$AGENT_DIR/vc-switch.sh" > /dev/null 2>&1 < /dev/null & )
  echo "Перезапуск запущен. Машина вернётся в список через несколько секунд."
fi
`
}
