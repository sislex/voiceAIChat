import { useState, type MouseEvent } from 'react'
import type {
  CatalogVoice,
  ClaudeModel,
  Settings,
  TtsVoiceInfo,
  WhisperModel,
  WhisperModelInfo
} from '@shared/types'
import type { SystemCapabilities } from '@shared/protocol'
import { REST } from '@shared/protocol'
import { CODEX_MODELS, modelsForRole, normalizeClaudeModel, PERMISSION_MODES } from '@shared/types'
import type { PermissionMode, LlmProvider, UserRole } from '@shared/types'
import type { McpServer } from '@shared/mcp'
import type { LoginStatusMap } from '@shared/auth'
import type { AgentCreated, AgentInfo, AgentPolicy } from '@shared/agentProtocol'
import { decodeAgentConnection } from '@shared/agentProtocol'
import { toDataURL as qrToDataUrl } from 'qrcode'
import { copyText } from '../lib/clipboard'
import { AgentCard } from './AgentCard'

export interface MicOption {
  deviceId: string
  label: string
}

/** Размер файла в человекочитаемом виде (МБ/ГБ). */
function formatBytes(bytes: number): string {
  if (bytes >= 1_000_000_000) return `${(bytes / 1_000_000_000).toFixed(1)} ГБ`
  if (bytes >= 1_000_000) return `${Math.round(bytes / 1_000_000)} МБ`
  return `${Math.max(1, Math.round(bytes / 1000))} КБ`
}

/** Разделы меню настроек. */
type SettingsSection = 'agent' | 'download' | 'stt' | 'tts' | 'dialog' | 'ui'
const SECTIONS: { id: SettingsSection; label: string }[] = [
  { id: 'agent', label: 'Агент' },
  { id: 'download', label: 'Скачать' },
  { id: 'stt', label: 'Распознавание' },
  { id: 'tts', label: 'Озвучка' },
  { id: 'dialog', label: 'Голосовой диалог' },
  { id: 'ui', label: 'Интерфейс' }
]

export interface SettingsModalProps {
  settings: Settings
  mics: MicOption[]
  /** Реальные голоса TTS активного движка. */
  voices: TtsVoiceInfo[]
  /** Каталог скачиваемых голосов Piper. */
  voiceCatalog: CatalogVoice[]
  /** Доступно ли скачивание голосов. */
  voicesDownloadable: boolean
  /** Прогресс скачивания по id (0–100); наличие ключа = идёт загрузка. */
  voiceDownloads: Record<string, number>
  /** Модели Whisper на диске (наличие/размер) — для управления местом. */
  whisperModels: WhisperModelInfo[]
  /** Возможности системы (ресурсы контейнера); null — ещё не загружено. При нехватке памяти STT/TTS блокируются. */
  capabilities: SystemCapabilities | null
  /** Подключённые MCP-серверы (read-only показ). */
  mcpServers: McpServer[]
  /** Статус входа claude/codex (read-only показ); null — ещё не загружен. */
  loginStatus?: LoginStatusMap | null
  /** Машины-агенты для удалённого выполнения команд. */
  agents: AgentInfo[]
  /** Создать машину; возвращает данные с одноразовым токеном (null при ошибке). */
  onCreateAgent: (name: string) => Promise<AgentCreated | null>
  /** Удалить машину (отзыв токена). */
  onDeleteAgent: (id: string) => void
  /** Сохранить политику возможностей машины. */
  onSetAgentPolicy: (id: string, policy: AgentPolicy) => void
  /** Перевыпустить токен машины → новая строка подключения. */
  onRegenerateAgentToken: (id: string) => Promise<string | null>
  /** Скачать десктоп-приложение (Mac, .dmg). */
  onDownloadDesktopApp: () => void
  /** Скачать трей-приложение агента (Mac, .dmg). */
  onDownloadAgentApp: () => void
  /** Скачать скрипт агента (Node, .cjs). */
  onDownloadAgentScript: () => void
  /** Получить строку подключения для настройки агента (для копирования). */
  onGetConnectionString: (token: string) => Promise<string | null>
  onChange: (patch: Partial<Settings>) => void
  onDownloadVoice: (id: string) => void
  /** Удалить установленный голос Piper. */
  onDeleteVoice: (id: string) => void
  /** Удалить файл модели Whisper. */
  onDeleteModel: (model: WhisperModel) => void
  /** Роль текущего пользователя — ограничивает список моделей Claude. */
  role: UserRole
  onClose: () => void
}

/** База сервера (http/https) из строки подключения vcagent: для команд установки. */
function serverBaseFromConnection(conn: string): string | null {
  const parsed = decodeAgentConnection(conn)
  if (!parsed?.server) return null
  const http = parsed.server.replace(/^ws:/, 'http:').replace(/^wss:/, 'https:')
  try {
    const u = new URL(http)
    return `${u.protocol}//${u.host}`
  } catch {
    return null
  }
}

export function SettingsModal({
  settings,
  mics,
  voices,
  voiceCatalog,
  voicesDownloadable,
  voiceDownloads,
  whisperModels,
  capabilities,
  mcpServers,
  loginStatus,
  agents,
  onCreateAgent,
  onDeleteAgent,
  onSetAgentPolicy,
  onRegenerateAgentToken,
  onDownloadDesktopApp,
  onDownloadAgentApp,
  onDownloadAgentScript,
  onGetConnectionString,
  onChange,
  onDownloadVoice,
  onDeleteVoice,
  onDeleteModel,
  role,
  onClose
}: SettingsModalProps): JSX.Element {
  const stop = (e: MouseEvent): void => e.stopPropagation()
  // Блокировка функций при нехватке ресурсов контейнера (null — ещё не загружено, не блокируем).
  const sttBlocked = capabilities != null && !capabilities.stt.available
  const ttsBlocked = capabilities != null && !capabilities.tts.available
  const [section, setSection] = useState<SettingsSection>('agent')
  // Добавление машины: поле имени и одноразовый показ токена после создания.
  const [agentName, setAgentName] = useState('')
  const [createdAgent, setCreatedAgent] = useState<AgentCreated | null>(null)
  const [tokenCopied, setTokenCopied] = useState(false)
  const [connCopied, setConnCopied] = useState(false)
  const [cmdCopied, setCmdCopied] = useState(false)
  const [winCmdCopied, setWinCmdCopied] = useState(false)
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null)

  const copyConnectionString = async (token: string): Promise<void> => {
    const str = await onGetConnectionString(token)
    if (str) setConnCopied(await copyText(str))
  }

  // Готовая команда установки для Termux (Android): адрес сервера берём из строки подключения.
  const copyTermuxCommand = async (token: string): Promise<void> => {
    const conn = await onGetConnectionString(token)
    if (!conn) return
    const base = serverBaseFromConnection(conn)
    if (!base) return
    const cmd = `curl -fsSLk ${base}${REST.agentInstallAndroid} | bash -s -- '${conn}'`
    setCmdCopied(await copyText(cmd))
  }

  // Готовая команда установки для Windows: вставляется в PowerShell, ExecutionPolicy
  // обходим дочерним powershell -File; внешние кавычки одинарные, чтобы $env:TEMP
  // не разворачивала оболочка, в которую вставили команду.
  const copyWindowsCommand = async (token: string): Promise<void> => {
    const conn = await onGetConnectionString(token)
    if (!conn) return
    const base = serverBaseFromConnection(conn)
    if (!base) return
    const cmd = `powershell -NoProfile -ExecutionPolicy Bypass -Command 'Set-Location $env:TEMP; curl.exe -fsSLk ${base}${REST.agentInstallWindows} -o vc-agent-install.ps1; & .\\vc-agent-install.ps1 "${conn}"'`
    setWinCmdCopied(await copyText(cmd))
  }

  // QR строки подключения: отсканировать телефоном и вставить в Termux (--connection).
  const toggleQr = async (token: string): Promise<void> => {
    if (qrDataUrl) {
      setQrDataUrl(null)
      return
    }
    const conn = await onGetConnectionString(token)
    if (!conn) return
    try {
      setQrDataUrl(await qrToDataUrl(conn, { width: 220, margin: 1 }))
    } catch {
      setQrDataUrl(null)
    }
  }

  const addAgent = async (): Promise<void> => {
    const name = agentName.trim()
    if (!name) return
    const created = await onCreateAgent(name)
    if (created) {
      setCreatedAgent(created)
      setAgentName('')
      setTokenCopied(false)
      setConnCopied(false)
    }
  }

  return (
    <div className="ovl" onClick={onClose} data-testid="overlay">
      <div className="modal settings" onClick={stop} role="dialog" aria-label="Настройки">
        <div className="mdhead">
          <h2 className="mdh">Настройки</h2>
          <button className="xbtn" onClick={onClose} aria-label="Закрыть" title="Закрыть">
            ✕
          </button>
        </div>
        <div className="settbody">
          <nav className="settnav" aria-label="Разделы настроек">
            {SECTIONS.map((s) => (
              <button
                key={s.id}
                className={section === s.id ? 'settnav-item on' : 'settnav-item'}
                aria-pressed={section === s.id}
                onClick={() => setSection(s.id)}
              >
                {s.label}
              </button>
            ))}
          </nav>

          <div className="settpane" data-testid="settings-pane">
            {section === 'agent' && (
              <>
                <div className="frow">
                  <div>
                    <p className="flab">Движок</p>
                    <p className="fsub">Через какой CLI генерировать ответы</p>
                  </div>
                  <select
                    className="sel"
                    aria-label="Движок"
                    value={settings.llmProvider}
                    onChange={(e) => onChange({ llmProvider: e.target.value as LlmProvider })}
                  >
                    <option value="claude">Claude Code</option>
                    <option value="codex">Codex</option>
                  </select>
                </div>

                {loginStatus && (
                  <div className="voicedl" data-testid="login-status">
                    <p className="flab">Вход в CLI</p>
                    <p className="fsub">
                      Авторизация claude/codex — выполните <code>claude login</code> /{' '}
                      <code>codex login</code> в терминале
                    </p>
                    {(['claude', 'codex'] as const).map((provider) => {
                      const s = loginStatus[provider]
                      const name = provider === 'claude' ? 'Claude Code' : 'Codex'
                      return (
                        <div className="vrow2" key={provider}>
                          <span className="vname">
                            {name}
                            {s.detail ? ` · ${s.detail}` : ''}
                          </span>
                          <span className={s.loggedIn ? 'mcp-ok' : 'mcp-bad'}>
                            {s.loggedIn ? '✓ вход выполнен' : '✗ не выполнен'}
                          </span>
                        </div>
                      )
                    })}
                  </div>
                )}

                {settings.llmProvider === 'claude' ? (
                  <div className="frow">
                    <div>
                      <p className="flab">Модель Claude</p>
                      <p className="fsub">Через Claude Console (CLI)</p>
                    </div>
                    <select
                      className="sel"
                      aria-label="Модель Claude"
                      value={normalizeClaudeModel(settings.model)}
                      onChange={(e) => onChange({ model: e.target.value as ClaudeModel })}
                    >
                      {modelsForRole(role).map((m) => (
                        <option key={m.id} value={m.id}>
                          {m.label}
                        </option>
                      ))}
                    </select>
                  </div>
                ) : (
                  <div className="frow">
                    <div>
                      <p className="flab">Модель Codex</p>
                      <p className="fsub">Через Codex CLI</p>
                    </div>
                    <select
                      className="sel"
                      aria-label="Модель Codex"
                      value={settings.codexModel}
                      onChange={(e) => onChange({ codexModel: e.target.value })}
                    >
                      {/* Сохранённая модель не из пресетов — показываем отдельным пунктом. */}
                      {settings.codexModel &&
                        !CODEX_MODELS.some((m) => m.id === settings.codexModel) && (
                          <option value={settings.codexModel}>{settings.codexModel}</option>
                        )}
                      {CODEX_MODELS.map((m) => (
                        <option key={m.id} value={m.id}>
                          {m.label}
                        </option>
                      ))}
                    </select>
                  </div>
                )}

                <div className="frow">
                  <div>
                    <p className="flab">Права агента</p>
                    <p className="fsub">Что агенту разрешено делать с файлами/командами</p>
                  </div>
                  <select
                    className="sel"
                    aria-label="Права агента"
                    value={settings.permissionMode}
                    onChange={(e) => onChange({ permissionMode: e.target.value as PermissionMode })}
                  >
                    {PERMISSION_MODES.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.label}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="frow">
                  <div>
                    <p className="flab">Рабочий каталог</p>
                    <p className="fsub">Где агент работает с файлами (напр. путь к репозиторию)</p>
                  </div>
                  <input
                    className="sel"
                    type="text"
                    aria-label="Рабочий каталог"
                    placeholder="По умолчанию"
                    value={settings.workdir ?? ''}
                    onChange={(e) => onChange({ workdir: e.target.value.trim() || null })}
                  />
                </div>

                <div className="voicedl" data-testid="agent-list">
                  <p className="flab">Машины</p>
                  {agents.map((a) => (
                    <AgentCard
                      key={a.id}
                      agent={a}
                      onSetPolicy={onSetAgentPolicy}
                      onDelete={onDeleteAgent}
                      onRegenerateToken={onRegenerateAgentToken}
                    />
                  ))}
                  <div className="vrow2">
                    <input
                      className="sel"
                      type="text"
                      aria-label="Имя новой машины"
                      placeholder="Имя машины (напр. MacBook)"
                      value={agentName}
                      onChange={(e) => setAgentName(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && void addAgent()}
                    />
                    <button
                      className="vdl"
                      aria-label="Добавить машину"
                      disabled={!agentName.trim()}
                      onClick={() => void addAgent()}
                    >
                      Добавить
                    </button>
                  </div>
                  {createdAgent && (
                    <div className="voicedl" data-testid="agent-token">
                      <p className="fsub">
                        Машина «{createdAgent.name}» создана — строка подключения показывается
                        один раз. Скачайте агента в разделе «Скачать», при первом запуске вставьте
                        строку подключения (годится и для приложения, и для скрипта). Для Android
                        (Termux) и Windows (PowerShell) скопируйте готовую команду ниже —
                        она сама установит и запустит агента.
                      </p>
                      <div className="vrow2">
                        <button
                          className="vdl"
                          aria-label="Скопировать команду установки для Termux (Android)"
                          onClick={() => void copyTermuxCommand(createdAgent.token)}
                        >
                          {cmdCopied ? '✓ команда скопирована' : '📱 Команда для Termux (Android)'}
                        </button>
                        <button
                          className="vdl"
                          aria-label="Скопировать команду установки для Windows (PowerShell)"
                          onClick={() => void copyWindowsCommand(createdAgent.token)}
                        >
                          {winCmdCopied ? '✓ команда скопирована' : '🪟 Команда для Windows (PowerShell)'}
                        </button>
                        <button
                          className="vdl"
                          aria-label="Показать QR-код строки подключения"
                          onClick={() => void toggleQr(createdAgent.token)}
                        >
                          {qrDataUrl ? 'Скрыть QR' : '▦ QR строки подключения'}
                        </button>
                        <button
                          className="vdl"
                          aria-label="Скопировать строку подключения"
                          onClick={() => void copyConnectionString(createdAgent.token)}
                        >
                          {connCopied ? '✓ строка скопирована' : 'Скопировать строку подключения'}
                        </button>
                        <button
                          className="vdl"
                          aria-label="Скопировать токен"
                          onClick={() => {
                            void copyText(createdAgent.token).then((ok) => setTokenCopied(ok))
                          }}
                        >
                          {tokenCopied ? '✓ токен скопирован' : 'Скопировать токен'}
                        </button>
                        <button
                          className="vdl"
                          aria-label="Скрыть"
                          onClick={() => {
                            setCreatedAgent(null)
                            setCmdCopied(false)
                            setWinCmdCopied(false)
                            setConnCopied(false)
                            setTokenCopied(false)
                            setQrDataUrl(null)
                          }}
                        >
                          Скрыть
                        </button>
                      </div>
                      {qrDataUrl && (
                        <div className="qr-conn" data-testid="agent-qr">
                          <img src={qrDataUrl} alt="QR-код строки подключения" width={220} height={220} />
                          <p className="fsub">
                            Отсканируйте телефоном (любой сканер QR), скопируется строка
                            подключения — вставьте её в Termux после <code>--connection</code>.
                          </p>
                        </div>
                      )}
                    </div>
                  )}
                </div>

                {mcpServers.length > 0 && (
                  <div className="voicedl" data-testid="mcp-list">
                    <p className="flab">MCP-серверы</p>
                    {mcpServers.map((s) => (
                      <div className="vrow2" key={s.name}>
                        <span className="vname">
                          {s.name}
                          {s.detail ? ` · ${s.detail}` : ''}
                        </span>
                        <span className={s.connected ? 'mcp-ok' : 'mcp-bad'}>
                          {s.connected ? '✓ подключён' : '✗ офлайн'}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </>
            )}

            {section === 'download' && (
              <>
                <div className="frow">
                  <div>
                    <p className="flab">Десктоп-приложение</p>
                    <p className="fsub">Основной клиент Голос·Чат для Mac (.dmg)</p>
                  </div>
                  <button className="vdl" aria-label="Скачать десктоп" title="Скачать десктоп" onClick={() => onDownloadDesktopApp()}>
                    ⬇ Скачать
                  </button>
                </div>

                <div className="frow">
                  <div>
                    <p className="flab">Агент — приложение</p>
                    <p className="fsub">Иконка в трее, выполнение команд на этой машине (Mac, .dmg)</p>
                  </div>
                  <button className="vdl" aria-label="Скачать приложение агента" title="Скачать приложение агента" onClick={() => onDownloadAgentApp()}>
                    ⬇ Скачать
                  </button>
                </div>

                <div className="frow">
                  <div>
                    <p className="flab">Агент — скрипт</p>
                    <p className="fsub">Запуск в терминале: <code>node voicechat-agent.cjs</code> (нужен Node.js)</p>
                  </div>
                  <button className="vdl" aria-label="Скачать скрипт агента" title="Скачать скрипт агента" onClick={() => onDownloadAgentScript()}>
                    ⬇ Скачать
                  </button>
                </div>

                <div className="frow">
                  <div>
                    <p className="flab">Агент — Android (Termux)</p>
                    <p className="fsub">
                      Установите <a href="https://f-droid.org/packages/com.termux/" target="_blank" rel="noreferrer">Termux</a> (лучше с F-Droid),
                      создайте машину в разделе «Агент» и вставьте её команду
                      <code> «📱 Команда для Termux»</code> в Termux — она поставит Node.js,
                      скачает агента и настроит автозапуск.
                    </p>
                  </div>
                </div>

                <div className="frow">
                  <div>
                    <p className="flab">Агент — Windows (PowerShell)</p>
                    <p className="fsub">
                      Создайте машину в разделе «Агент» и вставьте её команду
                      <code> «🪟 Команда для Windows»</code> в PowerShell — она поставит
                      Node.js 22+ (портативно, без прав администратора), скачает агента
                      и настроит автозапуск при входе.
                    </p>
                  </div>
                </div>

                <p className="fsub">
                  Чтобы подключить агента: создайте машину в разделе «Агент», скопируйте строку
                  подключения и вставьте её при первом запуске приложения (или передайте скрипту).
                </p>
              </>
            )}

            {section === 'stt' && (
              <>
                {sttBlocked && (
                  <div className="frow" data-testid="stt-blocked">
                    <div>
                      <p className="flab">Распознавание отключено</p>
                      <p className="fsub">{capabilities?.stt.reason}</p>
                    </div>
                  </div>
                )}
                <div className="frow">
                  <div>
                    <p className="flab">Распознавание речи</p>
                    <p className="fsub">Локально, без интернета</p>
                  </div>
                  <select
                    className="sel"
                    aria-label="Модель распознавания"
                    disabled={sttBlocked}
                    value={settings.whisperModel}
                    onChange={(e) => onChange({ whisperModel: e.target.value as WhisperModel })}
                  >
                    <option value="large-v3-turbo">Whisper large-v3-turbo</option>
                    <option value="medium">Whisper medium</option>
                    <option value="small">Whisper small</option>
                  </select>
                </div>

                {whisperModels.some((m) => m.present) && (
                  <div className="voicedl" data-testid="model-manager">
                    <p className="flab">Установленные модели</p>
                    {whisperModels
                      .filter((m) => m.present)
                      .map((m) => (
                        <div className="vrow2" key={m.model}>
                          <span className="vname">
                            Whisper {m.model} · {formatBytes(m.sizeBytes)}
                          </span>
                          <button
                            className="vdl vdel"
                            aria-label={`Удалить модель ${m.model}`}
                            onClick={() => onDeleteModel(m.model)}
                          >
                            Удалить
                          </button>
                        </div>
                      ))}
                  </div>
                )}

                <div className="frow">
                  <div>
                    <p className="flab">Диаризация спикеров</p>
                    <p className="fsub">Разделение голосов на говорящих</p>
                  </div>
                  <button
                    className={settings.diarization ? 'sw on' : 'sw'}
                    onClick={() => onChange({ diarization: !settings.diarization })}
                    disabled={sttBlocked}
                    role="switch"
                    aria-checked={settings.diarization}
                    aria-label="Диаризация спикеров" title="Диаризация спикеров"
                  />
                </div>

                <div className="frow">
                  <div>
                    <p className="flab">Микрофон</p>
                  </div>
                  <select
                    className="sel"
                    aria-label="Микрофон"
                    disabled={sttBlocked}
                    value={settings.micDeviceId ?? ''}
                    onChange={(e) => onChange({ micDeviceId: e.target.value || null })}
                  >
                    <option value="">По умолчанию</option>
                    {mics.map((m) => (
                      <option key={m.deviceId} value={m.deviceId}>
                        {m.label}
                      </option>
                    ))}
                  </select>
                </div>
              </>
            )}

            {section === 'tts' && (
              <>
                {ttsBlocked && (
                  <div className="frow" data-testid="tts-blocked">
                    <div>
                      <p className="flab">Озвучка отключена</p>
                      <p className="fsub">{capabilities?.tts.reason}</p>
                    </div>
                  </div>
                )}
                <div className="frow">
                  <div>
                    <p className="flab">Голос озвучки</p>
                    <p className="fsub">Локальный TTS</p>
                  </div>
                  <select
                    className="sel"
                    aria-label="Голос озвучки"
                    disabled={ttsBlocked}
                    value={settings.voice}
                    onChange={(e) => onChange({ voice: e.target.value })}
                  >
                    {voices.length === 0 && <option value={settings.voice}>По умолчанию</option>}
                    {voices.map((v) => (
                      <option key={v.id} value={v.id}>
                        {v.label}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="frow">
                  <div>
                    <p className="flab">Автоозвучка ответов</p>
                    <p className="fsub">Проговаривать ответы по мере генерации</p>
                  </div>
                  <button
                    className={settings.autoSpeak ? 'sw on' : 'sw'}
                    onClick={() => onChange({ autoSpeak: !settings.autoSpeak })}
                    disabled={ttsBlocked}
                    role="switch"
                    aria-checked={settings.autoSpeak}
                    aria-label="Автоозвучка ответов" title="Автоозвучка ответов"
                  />
                </div>

                {voicesDownloadable && voiceCatalog.length > 0 && (
                  <div className="voicedl" data-testid="voice-catalog">
                    <p className="flab">Скачать голоса</p>
                    {voiceCatalog.map((v) => {
                      const percent = voiceDownloads[v.id]
                      const downloading = percent !== undefined
                      return (
                        <div className="vrow2" key={v.id}>
                          <span className="vname">{v.label}</span>
                          {v.installed ? (
                            <span className="vrowr">
                              <span className="vinstalled">✓ установлен</span>
                              <button
                                className="vdl vdel"
                                aria-label={`Удалить голос ${v.label}`}
                                onClick={() => onDeleteVoice(v.id)}
                              >
                                Удалить
                              </button>
                            </span>
                          ) : downloading ? (
                            <span className="vprog">{percent}%</span>
                          ) : (
                            <button
                              className="vdl"
                              aria-label={`Скачать голос ${v.label}`}
                              onClick={() => onDownloadVoice(v.id)}
                            >
                              Скачать
                            </button>
                          )}
                        </div>
                      )
                    })}
                  </div>
                )}
              </>
            )}

            {section === 'dialog' && (
              <>
                <div className="frow">
                  <div>
                    <p className="flab">Режим hands-free</p>
                    <p className="fsub">Непрерывный диалог: авто-пауза по тишине и авто-запись</p>
                  </div>
                  <button
                    className={settings.handsFree ? 'sw on' : 'sw'}
                    onClick={() => onChange({ handsFree: !settings.handsFree })}
                    role="switch"
                    aria-checked={settings.handsFree}
                    aria-label="Режим hands-free" title="Режим hands-free"
                  />
                </div>

                <div className="frow">
                  <div>
                    <p className="flab">Перебивание голосом</p>
                    <p className="fsub">Заговорить во время озвучки — прервать и начать запись</p>
                  </div>
                  <button
                    className={settings.bargeIn ? 'sw on' : 'sw'}
                    onClick={() => onChange({ bargeIn: !settings.bargeIn })}
                    role="switch"
                    aria-checked={settings.bargeIn}
                    aria-label="Перебивание голосом" title="Перебивание голосом"
                  />
                </div>
              </>
            )}

            {section === 'ui' && (
              <>
                <div className="frow">
                  <div>
                    <p className="flab">Тёмная тема</p>
                    <p className="fsub">Переключить оформление интерфейса</p>
                  </div>
                  <button
                    className={settings.theme === 'dark' ? 'sw on' : 'sw'}
                    onClick={() => onChange({ theme: settings.theme === 'dark' ? 'light' : 'dark' })}
                    role="switch"
                    aria-checked={settings.theme === 'dark'}
                    aria-label="Тёмная тема" title="Тёмная тема"
                  />
                </div>

                <div className="frow">
                  <div>
                    <p className="flab">Режим консоли</p>
                    <p className="fsub">Показывать действия агента (команды, thinking, mode)</p>
                  </div>
                  <button
                    className={settings.showConsole ? 'sw on' : 'sw'}
                    onClick={() => onChange({ showConsole: !settings.showConsole })}
                    role="switch"
                    aria-checked={settings.showConsole}
                    aria-label="Режим консоли" title="Режим консоли"
                  />
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
