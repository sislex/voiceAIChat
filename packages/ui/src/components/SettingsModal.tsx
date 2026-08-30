import { useState } from 'react'
import { ProjectTypesSettings } from './ProjectTypesSettings'
import type { ProjectTypeNode } from '@shared/projectTypes'
import type { LoadStatus } from '../lib/loadState'
import { Dialog } from '@voicechat/ui-kit'
import { Button } from '@voicechat/ui-kit'
import { IconButton } from '@voicechat/ui-kit'
import { useConfirm } from '@voicechat/ui-kit'
import type {
  CatalogVoice,
  Settings,
  TtsVoiceInfo,
  WhisperModel,
  WhisperModelInfo
} from '@shared/types'
import type { SystemCapabilities } from '@shared/protocol'
import { CODEX_MODELS, normalizeClaudeModel, PERMISSION_MODES } from '@shared/types'
import type { PermissionMode, LlmProvider, UserRole } from '@shared/types'
import type { McpServer } from '@shared/mcp'
import type { LoginStatusMap } from '@shared/auth'
import type { LlmEngineOption } from '@shared/admin'
import type { UserLlmAccess } from '@shared/llmAccess'
import { allowedModels, isProviderAllowed } from '@shared/llmAccess'
import { ChatInstructionsSettings } from './ChatInstructionsSettings'
import { LlmSettingsEditor } from './LlmSettingsEditor'

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
type SettingsSection = 'llm' | 'aiAssist' | 'download' | 'stt' | 'tts' | 'dialog' | 'instructions' | 'storage' | 'security' | 'ui' | 'projectTypes'
const SECTIONS: { id: SettingsSection; label: string }[] = [
  { id: 'llm', label: 'LLM' },
  { id: 'aiAssist', label: 'AI-помощник' },
  { id: 'download', label: 'Скачать' },
  { id: 'stt', label: 'Распознавание' },
  { id: 'tts', label: 'Озвучка' },
  { id: 'dialog', label: 'Голосовой диалог' },
  { id: 'instructions', label: 'Инструкции' },
  { id: 'storage', label: 'Хранилище' },
  { id: 'security', label: 'Безопасность' },
  { id: 'ui', label: 'Интерфейс' },
  // Типы переживают проекты и не принадлежат ни одному из них — место каталогу
  // в пользовательских настройках, а не внутри конкретного проекта.
  { id: 'projectTypes', label: 'Типы проектов' }
]

export interface SettingsModalProps {
  settings: Settings
  /** Каталог типов проекта для раздела «Типы проектов». */
  projectTypes?: ProjectTypeNode[]
  projectTypesStatus?: LoadStatus
  projectTypesError?: string | null
  onRetryProjectTypes?: () => void
  currentUsername?: string
  onCreateProjectType?: (input: { name: string; parentId: string | null }) => void | Promise<void | string | null>
  onDeleteProjectType?: (id: string) => void | Promise<void>
  onPublishProjectType?: (id: string) => void | Promise<void>
  onUnpublishProjectType?: (id: string) => void | Promise<void>
  engines?: LlmEngineOption[]
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
  /** Скачать десктоп-приложение (Mac, .dmg). */
  onDownloadDesktopApp: () => void
  /** Скачать трей-приложение агента (Mac, .dmg). */
  onDownloadAgentApp: () => void
  /** Скачать скрипт агента (Node, .cjs). */
  onDownloadAgentScript: () => void
  onChange: (patch: Partial<Settings>) => void
  onDownloadVoice: (id: string) => void
  /** Удалить установленный голос Piper. */
  onDeleteVoice: (id: string) => void
  /** Удалить файл модели Whisper. */
  onDeleteModel: (model: WhisperModel) => void
  /** Роль текущего пользователя — ограничивает список моделей Claude. */
  role: UserRole
  llmAccess?: UserLlmAccess[]
  onClose: () => void
  /** Глобальная доступность голосового ввода. */
  voiceInputEnabled?: boolean
}

export function SettingsModal({
  projectTypes = [],
  projectTypesStatus = 'ready',
  projectTypesError = null,
  onRetryProjectTypes,
  currentUsername,
  onCreateProjectType,
  onDeleteProjectType,
  onPublishProjectType,
  onUnpublishProjectType,
  settings,
  engines = [],
  mics,
  voices,
  voiceCatalog,
  voicesDownloadable,
  voiceDownloads,
  whisperModels,
  capabilities,
  mcpServers,
  loginStatus,
  onDownloadDesktopApp,
  onDownloadAgentApp,
  onDownloadAgentScript,
  onChange,
  onDownloadVoice,
  onDeleteVoice,
  onDeleteModel,
  role: _role,
  llmAccess = [],
  onClose,
  voiceInputEnabled = true
}: SettingsModalProps): JSX.Element {
  const confirm = useConfirm()
  // Блокировка функций при нехватке ресурсов контейнера (null — ещё не загружено, не блокируем).
  const sttBlocked = !voiceInputEnabled || (capabilities != null && !capabilities.stt.available)
  const ttsBlocked = capabilities != null && !capabilities.tts.available
  const [section, setSection] = useState<SettingsSection>('llm')
  const [ttlDraft, setTtlDraft] = useState(String(settings.generatedFilesTtlDays))
  const ttlNumber = Number(ttlDraft)
  const ttlValid = /^\d+$/.test(ttlDraft) && Number.isInteger(ttlNumber) && ttlNumber >= 1 && ttlNumber <= 3650
  const saveTtl = (): void => {
    if (ttlValid && ttlNumber !== settings.generatedFilesTtlDays) onChange({ generatedFilesTtlDays: ttlNumber })
  }
  const claudeModels = allowedModels(llmAccess, 'claude')
  const codexModels = allowedModels(llmAccess, 'codex')
  const providers = (['claude', 'codex'] as const).filter((provider) => isProviderAllowed(llmAccess, provider) && (provider === 'claude' ? claudeModels.length : codexModels.length))

  return (
    <Dialog title="Настройки" size="md" testId="overlay" onClose={onClose}>
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
            {section === 'llm' && (
              <>
                <LlmSettingsEditor
                  value={{ engineId: settings.llmEngineId, provider: settings.llmProvider, model: settings.llmProvider === 'codex' ? settings.codexModel : settings.model }}
                  engines={engines}
                  llmAccess={llmAccess}
                  onChange={(next) => {
                    const currentModel = settings.llmProvider === 'codex' ? settings.codexModel : settings.model
                    const patch: Partial<Settings> = {}
                    if ((next.engineId ?? null) !== (settings.llmEngineId ?? null)) patch.llmEngineId = next.engineId ?? null
                    if (next.provider !== settings.llmProvider) patch.llmProvider = next.provider
                    if (next.model !== currentModel) {
                      if (next.provider === 'codex') patch.codexModel = next.model
                      else patch.model = normalizeClaudeModel(next.model)
                    }
                    onChange(patch)
                  }}
                />

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

            {section === 'aiAssist' && (
              <>
                <div className="frow">
                  <div><p className="flab">Движок помощника</p><p className="fsub">Отдельный CLI для генерации вариантов формулировки</p></div>
                  <select className="sel" aria-label="Движок AI-помощника" value={settings.aiAssistProvider} onChange={(e) => onChange({ aiAssistProvider: e.target.value as LlmProvider, aiAssistModel: e.target.value === 'claude' ? 'haiku' : '' })}>
                    {providers.includes('claude') && <option value="claude">Claude Code</option>}{providers.includes('codex') && <option value="codex">Codex</option>}{providers.length === 0 && <option value="">Нет доступных движков</option>}
                  </select>
                </div>
                <div className="frow">
                  <div><p className="flab">Модель помощника</p><p className="fsub">Быструю модель можно выбрать независимо от основного чата</p></div>
                  {settings.aiAssistProvider === 'claude' ? <select className="sel" aria-label="Модель AI-помощника" value={settings.aiAssistModel || 'haiku'} onChange={(e) => onChange({ aiAssistModel: e.target.value })}>
                    {claudeModels.map((m) => <option key={m.id} value={m.id} title={m.hint}>{m.label}</option>)}
                  </select> : <select className="sel" aria-label="Модель AI-помощника" value={settings.aiAssistModel} onChange={(e) => onChange({ aiAssistModel: e.target.value })}>
                    {!CODEX_MODELS.some((m) => m.id === settings.aiAssistModel) && <option value={settings.aiAssistModel}>{settings.aiAssistModel || 'По умолчанию (из codex)'}</option>}
                    {codexModels.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
                  </select>}
                </div>
                <div className="voicedl ai-default-prompts">
                  <p className="flab">Промпты по умолчанию</p><p className="fsub">Порядок активных инструкций учитывается при генерации.</p>
                  {settings.aiAssistPrompts.map((item, index) => <div className="ai-default-row" key={item.id}>
                    <input type="checkbox" aria-label={`Активен: ${item.title}`} checked={item.enabled} onChange={(e) => onChange({ aiAssistPrompts: settings.aiAssistPrompts.map((p) => p.id === item.id ? { ...p, enabled: e.target.checked } : p) })}/>
                    <input className="sel" aria-label={`Название: ${item.title}`} value={item.title} readOnly={item.readonly} onChange={(e) => onChange({ aiAssistPrompts: settings.aiAssistPrompts.map((p) => p.id === item.id ? { ...p, title: e.target.value } : p) })}/>
                    <textarea className="sel" aria-label={`Текст: ${item.title}`} value={item.text} readOnly={item.readonly} onChange={(e) => onChange({ aiAssistPrompts: settings.aiAssistPrompts.map((p) => p.id === item.id ? { ...p, text: e.target.value } : p) })}/>
                    <IconButton size="sm" aria-label={`Вверх: ${item.title}`} title="Вверх" disabled={index === 0} onClick={() => { const next = [...settings.aiAssistPrompts]; const [moved] = next.splice(index, 1); next.splice(index - 1, 0, moved); onChange({ aiAssistPrompts: next }) }}>↑</IconButton>
                    <IconButton size="sm" aria-label={`Вниз: ${item.title}`} title="Вниз" disabled={index === settings.aiAssistPrompts.length - 1} onClick={() => { const next = [...settings.aiAssistPrompts]; const [moved] = next.splice(index, 1); next.splice(index + 1, 0, moved); onChange({ aiAssistPrompts: next }) }}>↓</IconButton>
                    {!item.readonly && <IconButton size="sm" aria-label={`Удалить: ${item.title}`} title="Удалить" onClick={() => { void confirm({ title: 'Удалить этот промпт?', variant: 'danger', confirmLabel: 'Удалить' }).then((ok) => { if (ok) onChange({ aiAssistPrompts: settings.aiAssistPrompts.filter((p) => p.id !== item.id) }) }) }}>✕</IconButton>}
                  </div>)}
                  <Button variant="primary" size="sm" onClick={() => onChange({ aiAssistPrompts: [...settings.aiAssistPrompts, { id: globalThis.crypto?.randomUUID?.() ?? String(Date.now()), title: 'Новая подсказка', text: 'Опишите дополнительную инструкцию', enabled: true }] })}>Добавить промпт</Button>
                </div>
              </>
            )}

            {section === 'download' && (
              <>
                <div className="frow">
                  <div>
                    <p className="flab">Десктоп-приложение</p>
                    <p className="fsub">Основной клиент Голос·Чат для Mac (.dmg)</p>
                  </div>
                  <Button variant="primary" size="sm" aria-label="Скачать десктоп" title="Скачать десктоп" onClick={() => onDownloadDesktopApp()}>
                    ⬇ Скачать
                  </Button>
                </div>

                <div className="frow">
                  <div>
                    <p className="flab">Агент — приложение</p>
                    <p className="fsub">Иконка в трее, выполнение команд на этой машине (Mac, .dmg)</p>
                  </div>
                  <Button variant="primary" size="sm" aria-label="Скачать приложение агента" title="Скачать приложение агента" onClick={() => onDownloadAgentApp()}>
                    ⬇ Скачать
                  </Button>
                </div>

                <div className="frow">
                  <div>
                    <p className="flab">Агент — скрипт</p>
                    <p className="fsub">Запуск в терминале: <code>node voicechat-agent.cjs</code> (нужен Node.js)</p>
                  </div>
                  <Button variant="primary" size="sm" aria-label="Скачать скрипт агента" title="Скачать скрипт агента" onClick={() => onDownloadAgentScript()}>
                    ⬇ Скачать
                  </Button>
                </div>

                <div className="frow">
                  <div>
                    <p className="flab">Агент — Android (Termux)</p>
                    <p className="fsub">
                      Установите <a href="https://f-droid.org/packages/com.termux/" target="_blank" rel="noreferrer">Termux</a> (лучше с F-Droid),
                      создайте машину в меню «Машины» и вставьте её команду
                      <code> «📱 Команда для Termux»</code> в Termux — она поставит Node.js,
                      скачает агента и настроит автозапуск.
                    </p>
                  </div>
                </div>

                <div className="frow">
                  <div>
                    <p className="flab">Агент — Windows (PowerShell)</p>
                    <p className="fsub">
                      Создайте машину в меню «Машины» и вставьте её команду
                      <code> «🪟 Команда для Windows»</code> в PowerShell — она поставит
                      Node.js 22+ (портативно, без прав администратора), скачает агента
                      и настроит автозапуск при входе.
                    </p>
                  </div>
                </div>

                <p className="fsub">
                  Чтобы подключить агента: создайте машину в меню «Машины», скопируйте строку
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
                      <p className="fsub">
                        {voiceInputEnabled
                          ? capabilities?.stt.reason
                          : 'Голосовой ввод временно недоступен для всех пользователей'}
                      </p>
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
                          <Button
                            variant="danger"
                            size="sm"
                            aria-label={`Удалить модель ${m.model}`}
                            disabled={sttBlocked}
                            onClick={() => onDeleteModel(m.model)}
                          >
                            Удалить
                          </Button>
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
                    {/* Голос выбран, но движок его сейчас не отдаёт (не докачан, поднимается после деплоя):
                        показываем сохранённый выбор, иначе селект «сбросился» бы на первый доступный. */}
                    {voices.length > 0 && !voices.some((v) => v.id === settings.voice) && (
                      <option value={settings.voice}>{settings.voice} — сейчас недоступен</option>
                    )}
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
                              <Button
                                variant="danger"
                                size="sm"
                                aria-label={`Удалить голос ${v.label}`}
                                onClick={() => onDeleteVoice(v.id)}
                              >
                                Удалить
                              </Button>
                            </span>
                          ) : downloading ? (
                            <span className="vprog">{percent}%</span>
                          ) : (
                            <Button
                              variant="primary"
                              size="sm"
                              aria-label={`Скачать голос ${v.label}`}
                              onClick={() => onDownloadVoice(v.id)}
                            >
                              Скачать
                            </Button>
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
                    disabled={!voiceInputEnabled}
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
                    disabled={!voiceInputEnabled}
                    role="switch"
                    aria-checked={settings.bargeIn}
                    aria-label="Перебивание голосом" title="Перебивание голосом"
                  />
                </div>
              </>
            )}

            {section === 'instructions' && (
              <ChatInstructionsSettings items={settings.chatInstructions} onChange={(chatInstructions) => onChange({ chatInstructions })} />
            )}

            {section === 'storage' && (
              <div className="frow">
                <div>
                  <p className="flab">TTL временных генераций</p>
                  <p className="fsub">Файлы в managed .generated удаляются после этого срока. Безопасное значение по умолчанию — 30 дней.</p>
                  {!ttlValid && <p className="fsub" role="alert">Введите целое число от 1 до 3650 дней.</p>}
                </div>
                <input
                  className="sel"
                  type="number"
                  min={1}
                  max={3650}
                  step={1}
                  aria-label="TTL временных генераций в днях"
                  aria-invalid={!ttlValid}
                  value={ttlDraft}
                  onChange={(event) => setTtlDraft(event.target.value)}
                  onBlur={saveTtl}
                  onKeyDown={(event) => { if (event.key === 'Enter') saveTtl() }}
                />
              </div>
            )}

            {section === 'security' && (
              <div className="frow">
                <div>
                  <p className="flab">Письма о новых входах</p>
                  <p className="fsub">Отправлять на подтверждённый email при входе с нового сочетания IP и устройства.</p>
                </div>
                <button
                  className={settings.loginNewDeviceEmails ? 'sw on' : 'sw'}
                  onClick={() => onChange({ loginNewDeviceEmails: !settings.loginNewDeviceEmails })}
                  role="switch"
                  aria-checked={settings.loginNewDeviceEmails}
                  aria-label="Письма о новых входах" title="Письма о новых входах"
                />
              </div>
            )}

            {section === 'projectTypes' && (
              <ProjectTypesSettings
                types={projectTypes}
                status={projectTypesStatus}
                error={projectTypesError}
                {...(onRetryProjectTypes ? { onRetry: onRetryProjectTypes } : {})}
                {...(currentUsername ? { currentUsername } : {})}
                {...(onCreateProjectType ? { onCreate: onCreateProjectType } : {})}
                {...(onDeleteProjectType ? { onDelete: onDeleteProjectType } : {})}
                {...(onPublishProjectType ? { onPublish: onPublishProjectType } : {})}
                {...(onUnpublishProjectType ? { onUnpublish: onUnpublishProjectType } : {})}
              />
            )}

            {section === 'ui' && (
              <>
                <div className="frow">
                  <div>
                    <p className="flab">Тема интерфейса</p>
                    <p className="fsub">Применяется сразу и сохраняется для следующего входа</p>
                  </div>
                  <select
                    className="sel"
                    aria-label="Тема интерфейса"
                    value={settings.theme}
                    onChange={(e) => onChange({ theme: e.target.value as Settings['theme'] })}
                  >
                    <option value="light">Светлая</option>
                    <option value="dark">Тёмная</option>
                    <option value="green">Зелёная</option>
                  </select>
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
    </Dialog>
  )
}
