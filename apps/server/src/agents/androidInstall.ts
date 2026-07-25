// Генератор одностраничного установщика агента для Termux (Android).
// Пользователь запускает на телефоне:
//   curl -fsSL <BASE>/api/agents/install-android.sh | bash -s -- 'vcagent:…'
// Строка подключения (с токеном) передаётся аргументом — она НЕ вшита в endpoint.

/** Собирает bash-скрипт установщика с подставленным адресом сервера. */
export function buildAndroidInstallScript(baseUrl: string): string {
  // Отрезаем хвостовой слэш, чтобы не получить '//api/...'.
  const server = baseUrl.replace(/\/+$/, '')
  return `#!/data/data/com.termux/files/usr/bin/bash
# Установщик компаньон-агента Голос·Чат для Termux (Android).
# Использование:
#   curl -fsSLk ${server}/api/agents/install-android.sh | bash -s -- 'vcagent:…'
set -e

SERVER="${server}"
CONN="\${1:-\$VC_AGENT_CONNECTION}"
AGENT_DIR="\$HOME/voicechat-agent"
mkdir -p "\$AGENT_DIR"

echo "[1/5] Устанавливаю Node.js…"
pkg update -y >/dev/null 2>&1 || true
pkg install -y nodejs-lts >/dev/null 2>&1 || pkg install -y nodejs >/dev/null 2>&1 || true
command -v node >/dev/null 2>&1 || { echo "Не удалось установить Node.js. Запустите: pkg install nodejs"; exit 1; }

echo "[2/5] Скачиваю агента…"
curl -fsSLk "\$SERVER/api/agents/script" -o "\$AGENT_DIR/voicechat-agent.cjs"

if [ -n "\$CONN" ]; then
  echo "[3/5] Сохраняю строку подключения…"
  printf '%s' "\$CONN" > "\$AGENT_DIR/connection"
  chmod 600 "\$AGENT_DIR/connection"
else
  echo "[3/5] Строка подключения не передана — впишите её в \$AGENT_DIR/connection и перезапустите."
fi

echo "[4/5] Готовлю запуск и автозапуск (Termux:Boot)…"
cat > "\$AGENT_DIR/run.sh" <<'RUN'
#!/data/data/com.termux/files/usr/bin/bash
# Держим CPU включённым, чтобы Android не усыпил агента.
termux-wake-lock 2>/dev/null || true
# Сервер за Caddy с самоподписанным сертификатом — доверяем ему.
export VC_AGENT_INSECURE_TLS=1
cd "\$HOME/voicechat-agent"
CONN="\$(cat "\$HOME/voicechat-agent/connection" 2>/dev/null)"
exec node voicechat-agent.cjs --connection "\$CONN"
RUN
chmod +x "\$AGENT_DIR/run.sh"
# Автозапуск при загрузке телефона (нужно установить приложение Termux:Boot).
mkdir -p "\$HOME/.termux/boot"
ln -sf "\$AGENT_DIR/run.sh" "\$HOME/.termux/boot/voicechat-agent"

echo "[5/5] Запускаю агента… (Ctrl+C — остановить; автозапуск настроен)"
exec "\$AGENT_DIR/run.sh"
`
}
