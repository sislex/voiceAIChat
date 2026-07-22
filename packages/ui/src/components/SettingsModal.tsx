import { useState, type MouseEvent } from 'react'
import type {
  CatalogVoice,
  ClaudeModel,
  Settings,
  TtsVoiceInfo,
  WhisperModel,
  WhisperModelInfo
} from '@shared/types'
import { CLAUDE_MODELS, normalizeClaudeModel, PERMISSION_MODES } from '@shared/types'
import type { PermissionMode } from '@shared/types'
import type { McpServer } from '@shared/mcp'
import type { AgentCreated, AgentInfo, AgentPolicy } from '@shared/agentProtocol'
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
  /** Подключённые MCP-серверы (read-only показ). */
  mcpServers: McpServer[]
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
  onClose: () => void
}

export function SettingsModal({
  settings,
  mics,
  voices,
  voiceCatalog,
  voicesDownloadable,
  voiceDownloads,
  whisperModels,
  mcpServers,
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
  onClose
}: SettingsModalProps): JSX.Element {
  const stop = (e: MouseEvent): void => e.stopPropagation()
  const [section, setSection] = useState<SettingsSection>('agent')
  // Добавление машины: поле имени и одноразовый показ токена после создания.
  const [agentName, setAgentName] = useState('')
  const [createdAgent, setCreatedAgent] = useState<AgentCreated | null>(null)
  const [tokenCopied, setTokenCopied] = useState(false)
  const [connCopied, setConnCopied] = useState(false)

  const copyConnectionString = async (token: string): Promise<void> => {
    const str = await onGetConnectionString(token)
    if (str) setConnCopied(await copyText(str))
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
          <button className="xbtn" onClick={onClose} aria-label="Закрыть">
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
                    <p className="flab">Модель Claude</p>
                    <p className="fsub">Через Claude Console (CLI)</p>
                  </div>
                  <select
                    className="sel"
                    aria-label="Модель Claude"
                    value={normalizeClaudeModel(settings.model)}
                    onChange={(e) => onChange({ model: e.target.value as ClaudeModel })}
                  >
                    {CLAUDE_MODELS.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.label}
                      </option>
                    ))}
                  </select>
                </div>

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

                <div className="frow">
                  <div>
                    <p className="flab">Где выполнять команды</p>
                    <p className="fsub">Shell-команды агента: на сервере или на вашей машине</p>
                  </div>
                  <select
                    className="sel"
                    aria-label="Где выполнять команды"
                    value={settings.execTarget ?? ''}
                    onChange={(e) => onChange({ execTarget: e.target.value || null })}
                  >
                    <option value="">На сервере</option>
                    {agents.map((a) => (
                      <option key={a.id} value={a.id} disabled={!a.online}>
                        {a.name}
                        {a.online ? '' : ' (офлайн)'}
                      </option>
                    ))}
                  </select>
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
                        строку подключения (годится и для приложения, и для скрипта).
                      </p>
                      <div className="vrow2">
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
                          onClick={() => setCreatedAgent(null)}
                        >
                          Скрыть
                        </button>
                      </div>
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
                  <button className="vdl" aria-label="Скачать десктоп" onClick={() => onDownloadDesktopApp()}>
                    ⬇ Скачать
                  </button>
                </div>

                <div className="frow">
                  <div>
                    <p className="flab">Агент — приложение</p>
                    <p className="fsub">Иконка в трее, выполнение команд на этой машине (Mac, .dmg)</p>
                  </div>
                  <button className="vdl" aria-label="Скачать приложение агента" onClick={() => onDownloadAgentApp()}>
                    ⬇ Скачать
                  </button>
                </div>

                <div className="frow">
                  <div>
                    <p className="flab">Агент — скрипт</p>
                    <p className="fsub">Запуск в терминале: <code>node voicechat-agent.cjs</code> (нужен Node.js)</p>
                  </div>
                  <button className="vdl" aria-label="Скачать скрипт агента" onClick={() => onDownloadAgentScript()}>
                    ⬇ Скачать
                  </button>
                </div>

                <p className="fsub">
                  Чтобы подключить агента: создайте машину в разделе «Агент», скопируйте строку
                  подключения и вставьте её при первом запуске приложения (или передайте скрипту).
                </p>
              </>
            )}

            {section === 'stt' && (
              <>
                <div className="frow">
                  <div>
                    <p className="flab">Распознавание речи</p>
                    <p className="fsub">Локально, без интернета</p>
                  </div>
                  <select
                    className="sel"
                    aria-label="Модель распознавания"
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
                    role="switch"
                    aria-checked={settings.diarization}
                    aria-label="Диаризация спикеров"
                  />
                </div>

                <div className="frow">
                  <div>
                    <p className="flab">Микрофон</p>
                  </div>
                  <select
                    className="sel"
                    aria-label="Микрофон"
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
                <div className="frow">
                  <div>
                    <p className="flab">Голос озвучки</p>
                    <p className="fsub">Локальный TTS</p>
                  </div>
                  <select
                    className="sel"
                    aria-label="Голос озвучки"
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
                    role="switch"
                    aria-checked={settings.autoSpeak}
                    aria-label="Автоозвучка ответов"
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
                    aria-label="Режим hands-free"
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
                    aria-label="Перебивание голосом"
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
                    aria-label="Тёмная тема"
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
                    aria-label="Режим консоли"
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
