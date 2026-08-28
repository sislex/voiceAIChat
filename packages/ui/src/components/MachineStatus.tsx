// Отдельное меню «Машины»: таблица агентских машин со статусом (запущен ли агент),
// ОС, загрузкой CPU/памяти, диском и (для Android) батареей, быстрыми чекбоксами
// разрешений (сеть / запись файлов), обслуживанием агента и удалением машины.
// Остальная политика (каталоги, паттерны команд, навыки) правится в раскрывающемся
// редакторе строки — `AgentCard`; другого места для неё в UI нет.
// Данные приходят живым пушем (state.agents).

import { Fragment, useState } from 'react'
import type { AgentCreated, AgentInfo, AgentPolicy, AgentTelemetry, DiskUsage } from '@shared/agentProtocol'
import { AGENT_VERSION, compareVersions } from '@shared/version'
import { agentOsFromPlatform, installCommand, UPDATE_HINT } from '@shared/agentInstall'
import { recommendedMachineStoragePath, type MachineStorage } from '@shared/projects'
import { copyText } from '../lib/clipboard'
import { AgentCard } from './AgentCard'
import { AgentCommands } from './AgentCommands'
import { MachineCommandLog } from './MachineCommandLog'
import type { MachineCommandRecord, MachineCommandSource } from '@shared/agentProtocol'
import { Button } from '@voicechat/ui-kit'
import { IconButton } from '@voicechat/ui-kit'
import { ToolFrame } from './ToolFrame'
import { Skeleton, RefreshIndicator } from '@voicechat/ui-kit'
import { EmptyState } from '@voicechat/ui-kit'
import { ErrorState } from '@voicechat/ui-kit'
import { loadView, type LoadStatus } from '../lib/loadState'

export interface MachineStatusProps {
  /** Размещение: модалка из меню (по умолчанию) или страница контентной колонки. */
  variant?: 'modal' | 'page'
  agents: AgentInfo[]
  /** Состояние загрузки реестра машин: скелетон на первой загрузке, ошибка — с «Повторить». */
  status?: LoadStatus
  /** Техническая деталь ошибки загрузки (под «Подробнее»). */
  error?: string | null
  /** Повторить загрузку списка машин. */
  onRetry?: () => void
  /** Быстрое изменение разрешений (сервер сразу применит онлайн-агенту). */
  onSetPolicy: (id: string, policy: AgentPolicy) => void
  /** Фактически проверенные постоянные хранилища по машине. */
  storages?: Record<string, MachineStorage[]>
  onRefreshStorages?: (id: string) => void
  onRegisterStorage?: (id: string, rootPath: string) => Promise<string | null>
  /** Добавить машину; вернёт токен один раз. Нет — блок добавления скрыт. */
  onCreateAgent?: (name: string) => Promise<AgentCreated | null>
  /** Перевыпустить токен машины (старый перестаёт работать). */
  onRegenerateToken?: (id: string) => Promise<string | null>
  /** Строка подключения по токену — из неё собираются команды установки. */
  onGetConnectionString?: (token: string) => Promise<string | null>
  /** Обновить агента на машине (сервер выполнит на ней команду установки). */
  onUpdateAgent?: (id: string) => Promise<string | null>
  /** Журнал команд машины (п.4); нет — кнопка «Журнал» скрыта. */
  onLoadCommands?: (id: string, filter: { q?: string; source?: MachineCommandSource; limit?: number }) => Promise<MachineCommandRecord[]>
  /** Открыть чат из записи журнала. */
  onOpenConversation?: (conversationId: string) => void
  /** Мастер подключения: пробная команда на только что созданной машине. */
  onExecTest?: (id: string) => Promise<{ exitCode: number | null; output: string }>
  /**
   * Удалить машину: токен отзывается, цель выполнения и машина по умолчанию
   * сбрасываются. Нет — удаления в таблице нет (режим только-просмотр).
   */
  onDeleteAgent?: (id: string) => void
  /** Машина по умолчанию для новых разговоров (radio). */
  defaultAgentId?: string | null
  /** Выбрать/снять машину по умолчанию (повторный клик по выбранной — сброс). */
  onSetDefault?: (id: string | null) => void
  onClose: () => void
}

/** Устарел ли агент относительно версии, которую отдаёт сервер. */
function isOutdated(a: AgentInfo): boolean {
  return Boolean(a.online && a.version && compareVersions(a.version, AGENT_VERSION) < 0)
}

const GB = 1024 ** 3
const MB = 1024 ** 2

/** Человекочитаемый размер (ГБ/МБ). */
function fmtBytes(n: number): string {
  if (!Number.isFinite(n)) return '—'
  if (n >= GB) return `${(n / GB).toFixed(1)} ГБ`
  return `${Math.round(n / MB)} МБ`
}

function fmtDisk(d?: DiskUsage): string {
  if (!d) return '—'
  return `${fmtBytes(d.freeBytes)} своб. / ${fmtBytes(d.totalBytes)}`
}

/** Короткое имя ОС. */
function osLabel(os: AgentTelemetry['os']): string {
  if (os.isAndroid) return `Android · ${os.arch}`
  const name =
    os.platform === 'darwin'
      ? 'macOS'
      : os.platform === 'win32'
        ? 'Windows'
        : os.platform === 'linux'
          ? 'Linux'
          : os.platform
  return `${name} · ${os.arch}`
}

/** Имя файла shell без пути (для компактного показа в таблице). */
function shellBaseName(shellPath: string): string {
  const norm = shellPath.replace(/\\/g, '/')
  const parts = norm.split('/')
  return parts[parts.length - 1] || shellPath
}

function ratioPct(used: number, total: number): number {
  return total > 0 ? Math.round((used / total) * 100) : 0
}

/** Полоска-индикатор с подписью (CPU/RAM). */
function Meter({ value, label }: { value: number; label: string }): JSX.Element {
  const v = Math.max(0, Math.min(100, value))
  return (
    <div className="mst-meter" title={`${label} (${v}%)`}>
      <div className={v >= 90 ? 'mst-meter-fill hot' : 'mst-meter-fill'} style={{ width: `${v}%` }} />
      <span className="mst-meter-label">{label}</span>
    </div>
  )
}

/** Ячейка телеметрии одной машины (или прочерк, если данных нет). */
function TelemetryCells({ t }: { t?: AgentTelemetry }): JSX.Element {
  if (!t) {
    return (
      <>
        <td className="mst-dim">—</td>
        <td className="mst-dim">—</td>
        <td className="mst-dim">—</td>
        <td className="mst-dim">—</td>
        <td className="mst-dim">—</td>
      </>
    )
  }
  const ramPct = ratioPct(t.mem.usedBytes, t.mem.totalBytes)
  return (
    <>
      <td>
        {osLabel(t.os)}
        {t.os.shell && (
          <div className="mst-shell" title={`Shell для команд и терминала: ${t.os.shell}`}>
            <span className="mst-dim ac-mono">{shellBaseName(t.os.shell)}</span>
            {t.os.shellDegraded && (
              <span
                className="mst-badge"
                title="bash.exe не найден — команды и терминал идут через cmd.exe, функциональность ограничена. Поставьте Git for Windows."
              >
                ⚠ нет bash
              </span>
            )}
          </div>
        )}
      </td>
      <td>
        <Meter value={t.cpu.loadPct} label={`${t.cpu.loadPct}% · ${t.cpu.count} ядр.`} />
      </td>
      <td>
        <Meter value={ramPct} label={`${fmtBytes(t.mem.usedBytes)} / ${fmtBytes(t.mem.totalBytes)}`} />
      </td>
      <td className="mst-disk">
        <div>
          <span className="mst-dim">/</span> {fmtDisk(t.disk.root)}
        </div>
        <div>
          <span className="mst-dim">раб.</span> {fmtDisk(t.disk.work)}
        </div>
      </td>
      <td>
        {t.battery ? (
          <span className={t.battery.percent <= 15 && !t.battery.charging ? 'mst-batt low' : 'mst-batt'}>
            {t.battery.charging ? '⚡ ' : '🔋 '}
            {t.battery.percent}%{t.battery.charging ? ' заряжается' : ''}
          </span>
        ) : (
          <span className="mst-dim">—</span>
        )}
      </td>
    </>
  )
}

/** Быстрый чекбокс одного булева разрешения. */
function PermToggle({
  checked,
  label,
  disabled,
  onToggle
}: {
  checked: boolean
  label: string
  disabled: boolean
  onToggle: () => void
}): JSX.Element {
  return (
    <label className={disabled ? 'mst-perm off' : 'mst-perm'} title={disabled ? 'Машина офлайн' : label}>
      <input type="checkbox" checked={checked} disabled={disabled} onChange={onToggle} aria-label={label} />
      <span>{label}</span>
    </label>
  )
}

/** Кнопки обслуживания агента в строке машины. */
function AgentActions({
  agent,
  onUpdate,
  onCopyCommand,
  onRegenerate,
  onAskDelete,
  busy,
  copied
}: {
  agent: AgentInfo
  onUpdate?: () => void
  onCopyCommand?: () => void
  onRegenerate?: () => void
  /** Первый шаг удаления: подтверждение раскрывается строкой под машиной. */
  onAskDelete?: () => void
  busy: boolean
  copied: boolean
}): JSX.Element {
  const outdated = isOutdated(agent)
  return (
    <td className="mst-agent">
      <span className={outdated ? 'mst-ver outdated' : 'mst-ver'}>
        {agent.version ? `v${agent.version}` : '—'}
        {outdated && <span className="mst-badge">устарел, есть v{AGENT_VERSION}</span>}
      </span>
      <span className="mst-agent-btns">
        {outdated && onCopyCommand && (
          <Button
            size="sm"
            title={`Скопировать команду обновления. ${UPDATE_HINT}`}
            aria-label={`Скопировать команду обновления для ${agent.name}`}
            onClick={onCopyCommand}
          >
            {copied ? '✓ скопировано' : '⧉ команда'}
          </Button>
        )}
        {outdated && onUpdate && (
          <Button
            variant="primary"
            size="sm"
            title="Обновить агента на машине: сервер выполнит на ней ту же команду"
            aria-label={`Обновить агента на ${agent.name}`}
            disabled={busy}
            onClick={onUpdate}
          >
            {busy ? 'обновляю…' : '⬆ обновить'}
          </Button>
        )}
        {onRegenerate && (
          <Button
            size="sm"
            title="Перевыпустить токен: старый перестанет работать, агента нужно переустановить новой командой"
            aria-label={`Перевыпустить токен для ${agent.name}`}
            onClick={onRegenerate}
          >
            ↻ токен
          </Button>
        )}
        {onAskDelete && (
          <IconButton
            variant="danger"
            size="sm"
            title="Удалить машину: токен будет отозван, агент на ней больше не подключится"
            aria-label={`Удалить машину «${agent.name}»`}
            onClick={onAskDelete}
          >
            🗑
          </IconButton>
        )}
      </span>
    </td>
  )
}

export function MachineStatus({
  agents,
  status = 'ready',
  error = null,
  onRetry,
  onSetPolicy,
  storages = {},
  onRefreshStorages,
  onRegisterStorage,
  onCreateAgent,
  onRegenerateToken,
  onGetConnectionString,
  onUpdateAgent,
  onLoadCommands,
  onOpenConversation,
  onExecTest,
  onDeleteAgent,
  defaultAgentId,
  onSetDefault,
  onClose,
  variant = 'modal'
}: MachineStatusProps): JSX.Element {
  const [name, setName] = useState('')
  const [created, setCreated] = useState<AgentCreated | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [copiedId, setCopiedId] = useState<string | null>(null)
  const [note, setNote] = useState<string | null>(null)
  /** Машина, для которой раскрыт второй шаг удаления (одна на таблицу). */
  const [confirmDelId, setConfirmDelId] = useState<string | null>(null)
  /** Машина с раскрытым редактором политики (одна на таблицу). */
  const [policyId, setPolicyId] = useState<string | null>(null)
  const [logId, setLogId] = useState<string | null>(null)
  const [storageId, setStorageId] = useState<string | null>(null)
  const [storageDraft, setStorageDraft] = useState<Record<string, string>>({})
  const [storageBusy, setStorageBusy] = useState<string | null>(null)
  const [storageError, setStorageError] = useState<Record<string, string>>({})
  const view = loadView(status, agents.length > 0)
  // Ширина раскрывающихся строк (подтверждение удаления, редактор политики) —
  // столько же столбцов, сколько в шапке, иначе таблица разъезжается.
  const cols = onSetDefault ? 11 : 10

  const add = async (): Promise<void> => {
    const n = name.trim()
    if (!n || !onCreateAgent) return
    const agent = await onCreateAgent(n)
    if (!agent) {
      setNote('Не удалось добавить машину')
      return
    }
    setCreated(agent)
    setName('')
    setNote(null)
  }

  const regenerate = async (a: AgentInfo): Promise<void> => {
    if (!onRegenerateToken) return
    const token = await onRegenerateToken(a.id)
    if (!token) {
      setNote('Не удалось перевыпустить токен')
      return
    }
    // Показываем тот же блок команд: с новым токеном агента надо переустановить.
    setCreated({ id: a.id, name: a.name, token })
    setNote(null)
  }

  // Удаление подтверждено вторым кликом. Раскрытые панели этой машины закрываем
  // сами: её строки сейчас не станет, а confirmDelId/policyId остались бы указывать
  // на удалённый id и «переехали» бы на новую машину с тем же местом в таблице.
  const remove = (a: AgentInfo): void => {
    if (!onDeleteAgent) return
    setConfirmDelId(null)
    setPolicyId((cur) => (cur === a.id ? null : cur))
    setNote(null)
    onDeleteAgent(a.id)
  }

  const update = async (a: AgentInfo): Promise<void> => {
    if (!onUpdateAgent) return
    setBusyId(a.id)
    setNote(null)
    const err = await onUpdateAgent(a.id)
    setBusyId(null)
    // Установщик запускается отвязанно, поэтому его провал сюда не доходит:
    // единственный честный признак успеха — сменившаяся версия в этой же строке.
    setNote(
      err ??
        `Обновление на «${a.name}» запущено. Через полминуты версия в строке должна стать v${AGENT_VERSION}; ` +
          'если нет — скопируйте команду обновления и запустите её на машине, ошибка будет видна в терминале.'
    )
  }

  // Команда обновления собирается без токена: установщик на машине достанет
  // строку подключения сам (из своего файла или у живого агента).
  const copyUpdateCommand = async (a: AgentInfo): Promise<void> => {
    const os = a.telemetry ? agentOsFromPlatform(a.telemetry.os.platform, a.telemetry.os.isAndroid) : null
    if (!os) {
      setNote('Не удалось определить ОС машины — обновите вручную из настроек')
      return
    }
    const base = typeof window !== 'undefined' ? window.location.origin : ''
    if (await copyText(installCommand(os, base))) {
      setCopiedId(a.id)
      setTimeout(() => setCopiedId((c) => (c === a.id ? null : c)), 2000)
    }
  }

  const configureStorage = async (agent: AgentInfo): Promise<void> => {
    if (!onRegisterStorage) return
    const rootPath = (storageDraft[agent.id] ?? '').trim()
    if (!rootPath) return
    setStorageBusy(agent.id)
    setStorageError((current) => ({ ...current, [agent.id]: '' }))
    const error = await onRegisterStorage(agent.id, rootPath)
    setStorageBusy(null)
    if (error) setStorageError((current) => ({ ...current, [agent.id]: error }))
    else setStorageId(null)
  }

  return (
    <ToolFrame title="Машины" variant={variant} onClose={onClose} testId="machines-overlay">
      <div className="mst-body">
        {view.state === 'skeleton' && (
          /* Высота косточки — высота строки таблицы машин с полосками CPU/памяти. */
          <Skeleton variant="list" item="block" count={3} height={46} gap={6} testId="machine-skeleton" />
        )}
        {view.state === 'error' && (
          <ErrorState
            message="Не удалось загрузить список машин"
            detail={error}
            {...(onRetry ? { onRetry } : {})}
          />
        )}
        {view.staleError && (
          <ErrorState
            compact
            message="Список мог устареть: обновить не удалось"
            detail={error}
            {...(onRetry ? { onRetry } : {})}
          />
        )}
        {view.refreshing && <RefreshIndicator label="Обновляем список…" />}
        {view.state === 'empty' ? (
          <EmptyState
            icon="💻"
            title="Нет добавленных машин — добавьте первую ниже"
            description="Машина даёт модели терминал, файлы и запуск CI: имя, кнопка «Добавить» и команда установки агента."
          />
        ) : view.state !== 'data' ? null : (
          <table className="mst" data-testid="machines-table">
            <thead>
              <tr>
                <th>Машина</th>
                <th>Статус</th>
                <th>ОС</th>
                <th>CPU</th>
                <th>Память</th>
                <th>Диск</th>
                <th>Батарея</th>
                <th>Разрешения</th>
                <th>Хранилище файлов</th>
                {onSetDefault && <th>По умолчанию</th>}
                <th>Агент</th>
              </tr>
            </thead>
            <tbody>
              {agents.map((a) => (
                <Fragment key={a.id}>
                  <tr data-testid={`machine-row-${a.id}`}>
                    <td className="mst-name">
                      <span className="mst-nameline">
                        <IconButton
                          size="sm"
                          aria-expanded={policyId === a.id}
                          title="Каталоги, паттерны команд и навыки машины"
                          aria-label={`Политика машины «${a.name}»`}
                          onClick={() => setPolicyId((cur) => (cur === a.id ? null : a.id))}
                        >
                          {policyId === a.id ? '▾' : '▸'}
                        </IconButton>
                        {a.name}
                        {onLoadCommands && (
                          <Button size="sm" aria-expanded={logId === a.id} aria-label={`Журнал команд ${a.name}`} title="Журнал команд машины: кто, когда и что выполнял" onClick={() => setLogId((cur) => (cur === a.id ? null : a.id))}>
                            {logId === a.id ? 'Журнал ▾' : 'Журнал'}
                          </Button>
                        )}
                      </span>
                    </td>
                    <td>
                      <span className={a.online ? 'mst-status on' : 'mst-status off'}>
                        <span className="mst-dot" aria-hidden />
                        {a.online ? 'агент запущен' : a.lastSeen ? `не запущен · с ${new Date(a.lastSeen).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}` : 'не запущен'}
                      </span>
                    </td>
                    <TelemetryCells t={a.online ? a.telemetry : undefined} />
                    <td className="mst-perms">
                      <PermToggle
                        checked={a.policy.allowNetwork}
                        label="Сеть"
                        disabled={!a.online}
                        onToggle={() => onSetPolicy(a.id, { ...a.policy, allowNetwork: !a.policy.allowNetwork })}
                      />
                      <PermToggle
                        checked={a.policy.allowWrite}
                        label="Запись файлов"
                        disabled={!a.online}
                        onToggle={() => onSetPolicy(a.id, { ...a.policy, allowWrite: !a.policy.allowWrite })}
                      />
                    </td>
                    <td className="mst-storage">
                      {storages[a.id]?.length ? (
                        <>
                          <span className={`mst-status ${storages[a.id][0].status === 'ready' ? 'on' : 'off'}`}>
                            {storages[a.id][0].status === 'ready' ? 'готово' : storages[a.id][0].status === 'offline' ? 'офлайн' : 'недоступно'}
                          </span>
                          <span className="mst-dim ac-mono">{storages[a.id][0].rootPath}</span>
                        </>
                      ) : <span className="mst-dim">не настроено</span>}
                      {onRegisterStorage && (
                        <Button size="sm" onClick={() => {
                          setStorageId((current) => current === a.id ? null : a.id)
                          if (!storageDraft[a.id] && a.telemetry?.os.homePath) {
                            setStorageDraft((current) => ({ ...current, [a.id]: recommendedMachineStoragePath(a.telemetry!.os.platform, a.telemetry!.os.homePath!) }))
                          }
                        }}>
                          {storages[a.id]?.length ? 'Настроить' : 'Настроить'}
                        </Button>
                      )}
                    </td>
                    {onSetDefault && (
                      <td className="mst-default">
                        <input
                          type="radio"
                          name="default-machine"
                          checked={a.id === defaultAgentId}
                          aria-label={`Сделать «${a.name}» машиной по умолчанию`}
                          title="Использовать по умолчанию в новых разговорах"
                          onChange={() => onSetDefault(a.id)}
                          onClick={() => { if (a.id === defaultAgentId) onSetDefault(null) }}
                        />
                      </td>
                    )}
                    <AgentActions
                      agent={a}
                      busy={busyId === a.id}
                      copied={copiedId === a.id}
                      onUpdate={onUpdateAgent ? () => void update(a) : undefined}
                      onCopyCommand={() => void copyUpdateCommand(a)}
                      onRegenerate={onRegenerateToken ? () => void regenerate(a) : undefined}
                      onAskDelete={
                        onDeleteAgent && confirmDelId !== a.id ? () => setConfirmDelId(a.id) : undefined
                      }
                    />
                  </tr>
                  {storageId === a.id && (
                    <tr className="mst-policyrow" data-testid={`machine-storage-${a.id}`}>
                      <td colSpan={cols}>
                        <div className="ac-section">
                          <p className="flab">Постоянное файловое хранилище ChatAI</p>
                          <p className="fsub">
                            Здесь будут храниться вложения, файлы чатов и окружения. Рабочая директория проектов
                            настраивается отдельно и не меняется. Можно отложить: терминал и команды продолжат
                            работать, но постоянное хранение файлов не будет настроено.
                          </p>
                          {(storages[a.id] ?? []).map((storage) => (
                            <div className="vrow2" key={storage.id}>
                              <span className="ac-mono">{storage.primary ? 'Основное: ' : ''}{storage.rootPath}</span>
                              <span>формат v{storage.formatVersion} · {storage.status === 'ready' ? 'готово' : storage.status === 'offline' ? 'машина офлайн' : storage.error ?? 'каталог недоступен'}</span>
                            </div>
                          ))}
                          <div className="vrow2">
                            <input
                              className="sel"
                              aria-label={`Путь хранилища для ${a.name}`}
                              placeholder={a.telemetry?.os.platform === 'win32' ? 'C:\\Users\\me\\ChatAI' : '/Users/me/ChatAI'}
                              value={storageDraft[a.id] ?? ''}
                              onChange={(event) => setStorageDraft((current) => ({ ...current, [a.id]: event.target.value }))}
                            />
                            {a.telemetry?.os.homePath && (
                              <Button size="sm" onClick={() => setStorageDraft((current) => ({
                                ...current,
                                [a.id]: recommendedMachineStoragePath(a.telemetry!.os.platform, a.telemetry!.os.homePath!)
                              }))}>Рекомендуемый путь</Button>
                            )}
                            <Button variant="primary" size="sm" loading={storageBusy === a.id} disabled={!a.online || !(storageDraft[a.id] ?? '').trim()} onClick={() => void configureStorage(a)}>
                              Проверить и подключить
                            </Button>
                            {onRefreshStorages && <Button size="sm" disabled={!a.online} onClick={() => onRefreshStorages(a.id)}>Повторить проверку</Button>}
                            <Button size="sm" onClick={() => setStorageId(null)}>Отложить</Button>
                          </div>
                          {storageError[a.id] && <ErrorState compact message={storageError[a.id]} />}
                        </div>
                      </td>
                    </tr>
                  )}
                  {onDeleteAgent && confirmDelId === a.id && (
                    <tr className="mst-confirmrow" data-testid={`machine-delete-confirm-${a.id}`}>
                      <td colSpan={cols}>
                        <div className="mst-confirm">
                          <p className="mst-confirmtext">
                            Удалить машину «{a.name}»? Токен будет отозван: агент на машине
                            останется запущенным, но подключиться больше не сможет — понадобится
                            переустановка с новым токеном. Машина перестанет быть целью выполнения
                            в разговорах и машиной по умолчанию.
                          </p>
                          <span className="mst-confirmbtns">
                            <Button
                              variant="danger"
                              size="sm"
                              aria-label={`Подтвердить удаление машины «${a.name}»`}
                              onClick={() => remove(a)}
                            >
                              Удалить
                            </Button>
                            <Button size="sm" onClick={() => setConfirmDelId(null)}>
                              Отмена
                            </Button>
                          </span>
                        </div>
                      </td>
                    </tr>
                  )}
                  {policyId === a.id && (
                    <tr className="mst-policyrow" data-testid={`machine-policy-${a.id}`}>
                      <td colSpan={cols}>
                        <AgentCard agent={a} onSetPolicy={onSetPolicy} />
                      </td>
                    </tr>
                  )}
                  {logId === a.id && onLoadCommands && (
                    <tr className="mst-policyrow" data-testid={`machine-log-${a.id}`}>
                      <td colSpan={cols}>
                        <MachineCommandLog machineId={a.id} machineName={a.name} load={(filter) => onLoadCommands(a.id, filter)} onOpenConversation={onOpenConversation} />
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
        )}
        {note && (
          <p className="mst-note" role="status">
            {note}
          </p>
        )}

        {created && onGetConnectionString && (
          <AgentCommands
            name={created.name}
            token={created.token}
            onGetConnectionString={onGetConnectionString}
            onHide={() => setCreated(null)}
            online={agents.find((a) => a.id === created.id)?.online ?? false}
            onTestCommand={onExecTest ? () => onExecTest(created.id) : undefined}
          />
        )}

        {onCreateAgent && (
          <div className="mst-add">
            <input
              className="sel"
              type="text"
              aria-label="Имя новой машины"
              placeholder="Имя машины (напр. MacBook)"
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && void add()}
            />
            <Button
              variant="primary"
              size="sm"
              title="Добавить машину и получить команду установки"
              aria-label="Добавить машину"
              disabled={!name.trim()}
              onClick={() => void add()}
            >
              ＋ Добавить машину
            </Button>
          </div>
        )}

        <p className="mst-hint">
          Телеметрия обновляется каждые 30 секунд, пока агент в сети (нужна версия агента 0.4+).
          Каталоги, паттерны команд и навыки машины — под стрелкой «▸» в её строке.
        </p>
      </div>
    </ToolFrame>
  )
}
