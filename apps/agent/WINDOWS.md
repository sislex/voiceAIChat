# Агент на Windows

Компаньон-агент — обычный Node-скрипт (`voicechat-agent.cjs`), на Windows он
запускается без отдельного приложения и становится «машиной» в разделе
Настройки → Агент → Машины: выполнение команд, файловый проводник, консоль.

## Быстрый старт (рекомендуется)

1. В веб-клиенте: Настройки → Агент → «Добавить машину».
2. Нажмите **«🪟 Команда для Windows (PowerShell)»** — команда скопируется в буфер.
3. Откройте **PowerShell** (Win+X → «Терминал»; права администратора не нужны),
   вставьте команду и выполните. Она сама:
   - проверит Node.js: если нет версии 22+, скачает последнюю портативную с
     nodejs.org в `%LOCALAPPDATA%\voicechat-agent\node` (система не трогается);
   - скачает `voicechat-agent.cjs`;
   - сохранит строку подключения;
   - настроит автозапуск при входе (HKCU `Run` → `wscript` — без окна консоли);
   - запустит агента в фоне.

Команда работает как в PowerShell, так и в обычном cmd.exe:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -Command "Set-Location ([Environment]::GetEnvironmentVariable('TEMP')); curl.exe -fsSLk https://<сервер>/api/agents/install-windows.ps1 -o vc-agent-install.ps1; & .\vc-agent-install.ps1 'vcagent:…'"
```

## Вручную

```powershell
curl.exe -fsSLk https://<сервер>/api/agents/script -o voicechat-agent.cjs
$env:VC_AGENT_INSECURE_TLS='1'   # если сервер с самоподписанным сертификатом
node voicechat-agent.cjs --connection 'vcagent:…'
```

## Что работает и нюансы Windows

- **Выполнение команд (exec)** — через `cmd.exe` (`%ComSpec%`); синтаксис команд
  соответственно cmd, а не bash.
- **Консоль (PTY)** — открывается PowerShell. Нативный `@lydell/node-pty` в бандл
  не входит, поэтому по умолчанию работает **упрощённый режим** (pipe, без
  настоящего TTY и ресайза). Полноценный ConPTY — если рядом с `.cjs` выполнить
  `npm i @lydell/node-pty`.
- **Корневой каталог проводника** — `%USERPROFILE%` (так запускает `run.cmd`);
  переопределяется `VC_AGENT_ROOT`.
- **Файлы агента**: `%LOCALAPPDATA%\voicechat-agent` (`voicechat-agent.cjs`,
  `connection`, `run.cmd`, `run-hidden.vbs`, портативная `node\`).
- **Убрать автозапуск**: удалить значение `voicechat-agent` в
  `HKCU\Software\Microsoft\Windows\CurrentVersion\Run` (или через «Автозагрузка»
  в диспетчере задач), остановить процесс `node`.

## Самоподписанный сертификат

Если сервер за Caddy с `tls internal`, установщик качает с `curl.exe -k`, а
`run.cmd` выставляет `VC_AGENT_INSECURE_TLS=1` — агент доверяет такому серверу.

## Переменные окружения

Те же, что и на других платформах: `VC_AGENT_CONNECTION`, `VC_AGENT_SERVER` +
`VC_AGENT_TOKEN`, `VC_AGENT_ROOT`, `VC_PTY_SHELL`, `VC_PTY_FORCE_FALLBACK`,
`VC_AGENT_INSECURE_TLS` (см. `ANDROID.md`).
