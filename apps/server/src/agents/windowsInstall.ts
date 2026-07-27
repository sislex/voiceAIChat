// Генератор установщика агента для Windows (PowerShell) — аналог androidInstall.ts.
// Пользователь запускает в PowerShell одну команду (копируется из настроек):
//   powershell -NoProfile -ExecutionPolicy Bypass -Command 'Set-Location $env:TEMP;
//     curl.exe -fsSLk <BASE>/api/agents/install-windows.ps1 -o vc-agent-install.ps1;
//     & .\vc-agent-install.ps1 "vcagent:…"'
// Строка подключения (с токеном) передаётся аргументом — она НЕ вшита в endpoint.

/**
 * Собирает PowerShell-скрипт установщика с подставленным адресом сервера.
 * Начинается с BOM: Windows PowerShell 5.1 без него читает файл в ANSI
 * и портит русские строки.
 */
export function buildWindowsInstallScript(baseUrl: string): string {
  // Отрезаем хвостовой слэш, чтобы не получить '//api/...'.
  const server = baseUrl.replace(/\/+$/, '')
  return `﻿# Установщик компаньон-агента Голос·Чат для Windows (PowerShell 5.1+).
# Использование: скопируйте готовую команду из веб-настроек («Команда для Windows»)
# и вставьте в PowerShell. Строка подключения vcagent:… передаётся аргументом.
param([string]$Connection)

$ErrorActionPreference = 'Stop'
$Server = '${server}'
if (-not $Connection) { $Connection = $env:VC_AGENT_CONNECTION }
$AgentDir = Join-Path $env:LOCALAPPDATA 'voicechat-agent'
New-Item -ItemType Directory -Force -Path $AgentDir | Out-Null

# Сервер может стоять за Caddy с самоподписанным сертификатом, поэтому качаем
# через curl.exe -k (есть в Windows 10 1803+; Invoke-WebRequest в PS 5.1 не умеет
# пропускать проверку сертификата).
function Fetch([string]$Url, [string]$OutFile) {
  & curl.exe -fsSLk $Url -o $OutFile
  if ($LASTEXITCODE -ne 0) { throw "не удалось скачать $Url" }
}

# Мажорная версия node -v (0 — node нет или не запускается).
function NodeMajor([string]$Cmd) {
  try {
    $v = & $Cmd -v 2>$null
    if ("$v" -match 'v(\\d+)') { return [int]$Matches[1] }
  } catch { }
  return 0
}

Write-Host '[1/7] Проверяю Node.js (нужна версия 22+)…'
$NodeExe = 'node'
$LocalNode = Join-Path $AgentDir 'node\\node.exe'
if ((NodeMajor 'node') -lt 22) {
  if ((NodeMajor $LocalNode) -ge 22) {
    $NodeExe = $LocalNode
  } else {
    Write-Host 'Node.js 22+ не найден — скачиваю последнюю портативную (без прав администратора)…'
    $Arch = 'x64'
    if ($env:PROCESSOR_ARCHITECTURE -eq 'ARM64') { $Arch = 'arm64' }
    # nodejs.org — нормальный сертификат, здесь -k не нужен, а JSON удобнее через IRM.
    $Ver = (Invoke-RestMethod 'https://nodejs.org/dist/index.json')[0].version
    $Zip = Join-Path $env:TEMP 'voicechat-node.zip'
    Fetch "https://nodejs.org/dist/$Ver/node-$Ver-win-$Arch.zip" $Zip
    if (Test-Path (Join-Path $AgentDir 'node')) { Remove-Item (Join-Path $AgentDir 'node') -Recurse -Force }
    Expand-Archive -Path $Zip -DestinationPath $AgentDir -Force
    Move-Item (Join-Path $AgentDir "node-$Ver-win-$Arch") (Join-Path $AgentDir 'node')
    Remove-Item $Zip -Force
    $NodeExe = $LocalNode
  }
}
Write-Host "Использую Node.js: $NodeExe"

Write-Host '[2/7] Ставлю нативный терминал…'
$NodeDir = if ($NodeExe -eq 'node') { Split-Path (Get-Command node).Source } else { Split-Path $NodeExe }
$NpmCmd = Join-Path $NodeDir 'npm.cmd'
if (-not (Test-Path $NpmCmd)) {
  $Npm = Get-Command npm.cmd -ErrorAction SilentlyContinue
  if (-not $Npm) { throw 'npm не найден рядом с Node.js — невозможно установить нативный терминал' }
  $NpmCmd = $Npm.Source
}
# @lydell/node-pty публикует готовые ConPTY-бинарники для Windows x64/arm64.
& $NpmCmd install --prefix $AgentDir --omit=dev --no-save --no-audit --no-fund '@lydell/node-pty@1.1.0'
if ($LASTEXITCODE -ne 0) { throw 'не удалось установить нативный терминал' }
& $NodeExe -e "require(process.argv[1])" (Join-Path $AgentDir 'node_modules/@lydell/node-pty')
if ($LASTEXITCODE -ne 0) { throw 'нативный терминал установлен, но не загружается' }

Write-Host '[3/7] Скачиваю агента…'
$NewCjs = Join-Path $AgentDir 'voicechat-agent.new.cjs'
Fetch "$Server/api/agents/script" $NewCjs
if ((Get-Item $NewCjs).Length -lt 1000) { throw 'скачанный скрипт подозрительно мал' }
& $NodeExe --check $NewCjs
if ($LASTEXITCODE -ne 0) { Remove-Item $NewCjs -Force; throw 'скачанный скрипт битый — обновление отменено' }

Write-Host '[4/7] Ищу строку подключения и останавливаю старый агент…'
# Ищем node-процессы, у которых в командной строке наш скрипт (CIM: у Get-Process
# командной строки нет). Повторный запуск установщика = обновление.
$Old = @(Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" |
  Where-Object { $_.CommandLine -and $_.CommandLine -like '*voicechat-agent.cjs*' })

$ConnFile = Join-Path $AgentDir 'connection'
if (-not $Connection -and (Test-Path $ConnFile)) {
  $Connection = (Get-Content $ConnFile -Raw).Trim()
  if ($Connection) { Write-Host '  строка подключения — из сохранённого файла' }
}
if (-not $Connection) {
  # Агент мог стоять в другом каталоге — забираем строку у живого процесса.
  foreach ($p in $Old) {
    if ($p.CommandLine -match '(vcagent:[A-Za-z0-9_\-]+)') {
      $Connection = $Matches[1]
      Write-Host '  строка подключения восстановлена из работающего агента'
      break
    }
  }
}
if (-not $Connection) { throw 'Не нашёл строку подключения. Скопируйте команду установки из настроек — в ней она есть.' }

$Old | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
Start-Sleep -Seconds 1
# Убеждаемся, что не осталось живых: иначе поднимем второй агент с тем же токеном.
$Still = @(Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" |
  Where-Object { $_.CommandLine -and $_.CommandLine -like '*voicechat-agent.cjs*' })
if ($Still.Count -gt 0) { throw 'старый агент не останавливается — погасите его вручную и повторите' }

$Cjs = Join-Path $AgentDir 'voicechat-agent.cjs'
if (Test-Path $Cjs) { Move-Item $Cjs (Join-Path $AgentDir 'voicechat-agent.cjs.prev') -Force }
Move-Item $NewCjs $Cjs -Force

Write-Host '[5/7] Сохраняю строку подключения…'
Set-Content -Path $ConnFile -Value $Connection -NoNewline -Encoding ascii

Write-Host '[6/7] Готовлю запуск и автозапуск (реестр HKCU, окно скрыто)…'
$RunCmd = Join-Path $AgentDir 'run.cmd'
# OEM-кодировка: cmd.exe читает .cmd в кодовой странице консоли, иначе rem-строки в кракозябрах.
@(
  '@echo off',
  'rem Сервер за самоподписанным TLS — агент должен ему доверять.',
  'set "VC_AGENT_INSECURE_TLS=1"',
  'set /p VC_CONN=<"%~dp0connection"',
  'cd /d "%USERPROFILE%"',
  ('"{0}" "%~dp0voicechat-agent.cjs" --connection "%VC_CONN%"' -f $NodeExe)
) | Set-Content -Path $RunCmd -Encoding oem
# VBS-обёртка запускает run.cmd без консольного окна (UTF-16 — wscript так читает юникод).
$Vbs = Join-Path $AgentDir 'run-hidden.vbs'
('CreateObject("WScript.Shell").Run Chr(34) & "{0}" & Chr(34), 0, False' -f $RunCmd) |
  Set-Content -Path $Vbs -Encoding unicode
Set-ItemProperty -Path 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Run' \`
  -Name 'voicechat-agent' -Value ('wscript.exe "{0}"' -f $Vbs)

Write-Host '[7/7] Запускаю агента (в фоне; автозапуск при входе настроен)…'
Start-Process -FilePath 'wscript.exe' -ArgumentList ('"{0}"' -f $Vbs)
Write-Host "Готово. Машина появится в настройках через несколько секунд. Файлы агента: $AgentDir"
`
}
