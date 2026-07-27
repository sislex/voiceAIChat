import { describe, it, expect } from 'vitest'
import { buildUnixInstallScript } from './unixInstall.js'

describe('buildUnixInstallScript', () => {
  const linux = buildUnixInstallScript('https://host.example/', 'linux')
  const mac = buildUnixInstallScript('https://host.example', 'macos')

  it('подставляет адрес сервера без двойного слэша', () => {
    expect(linux).toContain('SERVER="https://host.example"')
    expect(linux).toContain('"$SERVER/api/agents/script"')
    expect(linux).not.toContain('host.example//')
  })

  it('требует Node 22+ и умеет портативный', () => {
    expect(linux).toContain('-ge 22')
    expect(linux).toContain('nodejs.org/dist/index.json')
    expect(linux).toContain('node-$NVER-linux-$NARCH.tar.gz')
    expect(mac).toContain('node-$NVER-darwin-$NARCH.tar.gz')
  })

  it('ставит и проверяет нативный PTY рядом с агентом до перезапуска', () => {
    for (const s of [linux, mac]) {
      const install = s.indexOf('$NPM_BIN" install --prefix "$AGENT_DIR"')
      const verify = s.indexOf("require('$AGENT_DIR/node_modules/@lydell/node-pty')")
      const restart = s.indexOf('[7/7]')
      expect(install).toBeGreaterThan(0)
      expect(verify).toBeGreaterThan(install)
      expect(verify).toBeLessThan(restart)
    }
  })

  it('перезапуск — ПОСЛЕДНИЙ шаг: файлы подменяются раньше, чем гибнет агент', () => {
    // Установщик запускает сам агент (кнопка «обновить»), и его смерть уносит нас:
    // на systemd — вместе со всем cgroup сервиса. Значит вся работа должна быть
    // закончена до остановки.
    for (const s of [linux, mac]) {
      const swap = s.indexOf('voicechat-agent.new.cjs" "$AGENT_DIR/voicechat-agent.cjs"')
      const runSh = s.indexOf('cat > "$AGENT_DIR/run.sh"')
      const restart = s.indexOf('[7/7]')
      expect(swap).toBeGreaterThan(0)
      expect(swap).toBeLessThan(restart)
      expect(runSh).toBeLessThan(restart)
      expect(s.indexOf('pkill')).toBeGreaterThan(restart)
    }
  })

  it('перезапуск поручен супервизору, а без него — отдельному скрипту с добиванием', () => {
    expect(linux).toContain('systemctl --user restart voicechat-agent.service')
    expect(mac).toContain('launchctl kickstart -k')
    for (const s of [linux, mac]) {
      // Имя переключателя не должно попадать под шаблон pkill, иначе он убьёт себя.
      expect(s).toContain('vc-switch.sh')
      expect('vc-switch.sh').not.toMatch(/voicechat-agent.cjs/)
      expect(s).toContain('pkill -9 -f "voicechat-agent[.]cjs"')
    }
  })

  it('идемпотентен: гасит старый агент и сохраняет прежний скрипт как .prev', () => {
    for (const s of [linux, mac]) {
      expect(s).toContain('pkill -f "voicechat-agent[.]cjs"')
      expect(s).toContain('voicechat-agent.cjs.prev')
    }
  })

  it('проверяет скачанный скрипт до подмены рабочего', () => {
    const check = linux.indexOf('--check')
    const swap = linux.indexOf('mv "$AGENT_DIR/voicechat-agent.new.cjs" "$AGENT_DIR/voicechat-agent.cjs"')
    expect(check).toBeGreaterThan(0)
    expect(swap).toBeGreaterThan(check)
  })

  it('строку подключения ищет ДО остановки агента (иначе её негде взять)', () => {
    const recover = linux.indexOf("grep -m1 '^vcagent:'")
    const kill = linux.indexOf('pkill -f "voicechat-agent[.]cjs"')
    expect(recover).toBeGreaterThan(0)
    expect(recover).toBeLessThan(kill)
  })

  it('без строки подключения выходит с ошибкой, а не стартует пустышку', () => {
    expect(linux).toContain('Не нашёл строку подключения')
    expect(linux).toContain('exit 1')
  })

  it('автозапуск: systemd на linux, launchd на macOS', () => {
    expect(linux).toContain('systemctl --user enable voicechat-agent.service')
    expect(linux).not.toContain('LaunchAgents')
    expect(mac).toContain('LaunchAgents/com.voicechat.agent.plist')
    expect(mac).not.toContain('systemctl --user enable')
  })

  it('macOS читает командную строку через ps (нет /proc)', () => {
    expect(mac).toContain('ps -o command=')
    expect(linux).toContain('/proc/$1/cmdline')
  })

  it('доверяет самоподписанному TLS сервера в run.sh', () => {
    expect(linux).toContain('VC_AGENT_INSECURE_TLS=1')
  })
})
