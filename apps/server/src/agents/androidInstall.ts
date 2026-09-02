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

echo "[1/7] Проверяю Node.js (нужна 22+)…"
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

echo "[2/7] Готовлю сборку нативных npm-модулей…"
pkg install -y clang make python pkg-config >/dev/null 2>&1 || {
  echo "Не удалось установить clang/make/python/pkg-config. Запустите pkg update и повторите установку."
  exit 1
}
for tool in npm clang make python; do
  command -v "\$tool" >/dev/null 2>&1 || { echo "После подготовки не найден \$tool"; exit 1; }
done
export GYP_DEFINES="android_ndk_path=\$PREFIX"
SMOKE_DIR="\$(mktemp -d "\$AGENT_DIR/native-smoke.XXXXXX")"
(
  trap 'rm -rf "\$SMOKE_DIR"' EXIT
  cd "\$SMOKE_DIR"
  npm install --no-save --no-package-lock --silent better-sqlite3@11.10.0
  node -e "const Database=require('better-sqlite3'); const db=new Database(':memory:'); db.prepare('select 1').get(); db.close()"
) || { echo "Тестовая сборка better-sqlite3 не удалась"; exit 1; }
echo "  better-sqlite3 успешно установлен и загружен"
# CLI-команды даёт пакет termux-api, а системный provider — отдельное приложение Termux:API.
if ! command -v termux-wake-lock >/dev/null 2>&1 || ! command -v termux-wake-unlock >/dev/null 2>&1; then
  pkg install -y termux-api >/dev/null 2>&1 || true
fi
if ! command -v termux-wake-lock >/dev/null 2>&1 || ! command -v termux-wake-unlock >/dev/null 2>&1; then
  echo "  Предупреждение: wake lock недоступен. Установите пакет termux-api и приложение Termux:API."
fi

echo "[3/7] Скачиваю агента…"
curl -fsSLk "\$SERVER/api/agents/script" -o "\$AGENT_DIR/voicechat-agent.new.cjs"
test -s "\$AGENT_DIR/voicechat-agent.new.cjs"
node --check "\$AGENT_DIR/voicechat-agent.new.cjs" 2>/dev/null || {
  echo "скачанный скрипт битый — обновление отменено"; rm -f "\$AGENT_DIR/voicechat-agent.new.cjs"; exit 1
}

echo "[4/7] Ищу строку подключения…"
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

[ -n "\$CONN" ] || {
  echo "Не нашёл строку подключения. Скопируйте команду установки из списка машин — в ней она есть."
  rm -f "\$AGENT_DIR/voicechat-agent.new.cjs"
  exit 1
}
echo "[5/7] Сохраняю строку подключения и новый агент…"
printf '%s' "\$CONN" > "\$AGENT_DIR/connection"
mv "\$AGENT_DIR/voicechat-agent.new.cjs" "\$AGENT_DIR/voicechat-agent.cjs"
chmod 600 "\$AGENT_DIR/connection"

echo "[6/7] Готовлю запуск и автозапуск (Termux:Boot)…"
cat > "\$AGENT_DIR/run.sh" <<'RUN'
#!/data/data/com.termux/files/usr/bin/bash
# Wake lock принадлежит lifecycle агента: он сам делает lock/unlock.
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

echo "[7/7] Перезапускаю агента…"
# Гасить старый агент нужно ПОСЛЕДНИМ действием: он мог запустить нас сам (кнопка
# «обновить»), и его смерть уносит нас с собой. Поэтому переключение делает отдельный
# отвязанный скрипт — его имя намеренно не совпадает с шаблоном pkill, иначе он
# погасил бы сам себя.
cat > "\$AGENT_DIR/vc-switch.sh" <<'SWEOF'
#!/data/data/com.termux/files/usr/bin/bash
cd "\$(dirname "\$0")"
agents_alive() { pgrep -f "voicechat-agent[.]cjs" 2>/dev/null | wc -l | tr -d " "; }
for i in 1 2 3; do
  [ "\$(agents_alive)" = "0" ] && break
  pkill -f "voicechat-agent[.]cjs" 2>/dev/null || true
  sleep 1
done
# Агент мог унаследовать SIG_IGN на SIGTERM от обёртки — тогда добиваем.
[ "\$(agents_alive)" != "0" ] && { pkill -9 -f "voicechat-agent[.]cjs" 2>/dev/null || true; sleep 1; }
nohup ./run.sh >> agent.log 2>&1 &
SWEOF
chmod +x "\$AGENT_DIR/vc-switch.sh"
setsid nohup "\$AGENT_DIR/vc-switch.sh" > /dev/null 2>&1 < /dev/null &
echo "Готово. Агент перезапускается, машина вернётся в список через несколько секунд."
`
}
