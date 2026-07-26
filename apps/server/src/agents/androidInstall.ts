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

echo "[1/6] Проверяю Node.js (нужна 22+)…"
# Мажорная версия node (0 — нет или не запускается).
node_major() {
  local out
  out="\$(node -v 2>/dev/null || true)"
  case "\$out" in
    v*) echo "\${out#v}" | cut -d. -f1 ;;
    *) echo 0 ;;
  esac
}
if [ "\$(node_major)" -lt 22 ]; then
  echo "  ставлю/обновляю Node.js через pkg…"
  pkg update -y >/dev/null 2>&1 || true
  pkg install -y nodejs-lts >/dev/null 2>&1 || pkg install -y nodejs >/dev/null 2>&1 || true
fi
command -v node >/dev/null 2>&1 || { echo "Не удалось установить Node.js. Запустите: pkg install nodejs"; exit 1; }
if [ "\$(node_major)" -lt 22 ]; then
  echo "Node.js \$(node -v) слишком старый (нужна 22+). Запустите: pkg install nodejs"; exit 1
fi
echo "  Node.js \$(node -v)"

echo "[2/6] Скачиваю агента…"
curl -fsSLk "\$SERVER/api/agents/script" -o "\$AGENT_DIR/voicechat-agent.new.cjs"
test -s "\$AGENT_DIR/voicechat-agent.new.cjs"
node --check "\$AGENT_DIR/voicechat-agent.new.cjs" 2>/dev/null || {
  echo "скачанный скрипт битый — обновление отменено"; rm -f "\$AGENT_DIR/voicechat-agent.new.cjs"; exit 1
}

echo "[3/6] Ищу строку подключения…"
if [ -n "\$CONN" ]; then
  echo "  из аргумента"
elif [ -f "\$AGENT_DIR/connection" ] && [ -s "\$AGENT_DIR/connection" ]; then
  CONN="\$(cat "\$AGENT_DIR/connection")"
  echo "  из сохранённого файла"
else
  # Агент мог стоять в другом каталоге — забираем строку у живого процесса.
  for pid in \$(pgrep -f "voicechat-agent[.]cjs" 2>/dev/null || true); do
    found="\$(tr '\\0' '\\n' < "/proc/\$pid/cmdline" 2>/dev/null | grep -m1 '^vcagent:' || true)"
    if [ -n "\$found" ]; then CONN="\$found"; echo "  восстановил из работающего агента"; break; fi
  done
fi

echo "Останавливаю старый агент (если запущен)…"
# Одного pkill мало: агент мог унаследовать SIG_IGN на SIGTERM от обёртки, которой
# его запускали, — тогда он выживает, и мы поднимаем ВТОРОЙ агент с тем же токеном.
# Шаблон со скобками — иначе pkill найдёт сам себя в своей командной строке.
agents_alive() { pgrep -f "voicechat-agent[.]cjs" 2>/dev/null | wc -l | tr -d " "; }
for i in 1 2 3; do
  [ "\$(agents_alive)" = "0" ] && break
  pkill -f "voicechat-agent[.]cjs" 2>/dev/null || true
  sleep 1
done
if [ "\$(agents_alive)" != "0" ]; then
  echo "  не отреагировал на SIGTERM — добиваю"
  pkill -9 -f "voicechat-agent[.]cjs" 2>/dev/null || true
  sleep 1
fi
if [ "\$(agents_alive)" != "0" ]; then
  echo "Старый агент не останавливается — прерываюсь, чтобы не поднять второй."
  exit 1
fi
[ -f "\$AGENT_DIR/voicechat-agent.cjs" ] && mv "\$AGENT_DIR/voicechat-agent.cjs" "\$AGENT_DIR/voicechat-agent.cjs.prev" || true
mv "\$AGENT_DIR/voicechat-agent.new.cjs" "\$AGENT_DIR/voicechat-agent.cjs"

[ -n "\$CONN" ] || {
  echo "Не нашёл строку подключения. Скопируйте команду установки из списка машин — в ней она есть."
  exit 1
}
echo "[4/6] Сохраняю строку подключения…"
printf '%s' "\$CONN" > "\$AGENT_DIR/connection"
chmod 600 "\$AGENT_DIR/connection"

echo "[5/6] Готовлю запуск и автозапуск (Termux:Boot)…"
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

echo "[6/6] Запускаю агента… (Ctrl+C — остановить; автозапуск настроен)"
exec "\$AGENT_DIR/run.sh"
`
}
