// Страница «Команды» (CI-раннер): справочник команд + форма правки, глобальные
// настройки, инбокс предложений модели и отчёт по занятому месту. Утилита-
// страница (variant="page"), стиль близок к Jira/Bitbucket Pipelines на токенах.

import { useEffect, useMemo, useState } from 'react'
import type {
  CiCommand,
  CiCommandInput,
  CiCommandScope,
  CiGlobalSettings,
  CiCommandSuggestion,
  CiWorkspaceReportItem
} from '@shared/ci'
import { DEFAULT_CI_GLOBAL_SETTINGS } from '@shared/ci'
import { ToolFrame } from '../ToolFrame'
import { Button } from '../ui/Button'
import { IconButton } from '../ui/IconButton'
import { useConfirm } from '../ui/useConfirm'
import { useToast } from '../ui/Toast'
import { Skeleton, RefreshIndicator } from '../ui/Skeleton'
import { EmptyState } from '../ui/EmptyState'
import { ErrorState } from '../ui/ErrorState'
import { loadView, type LoadStatus } from '../../lib/loadState'

export interface CiCommandUsage {
  projects: Array<{ id: string; name: string }>
  tasks: Array<{ id: string; title: string }>
}

export interface CiCommandsProps {
  commands: CiCommand[]
  /** Состояние загрузки справочника: скелетон на первой загрузке, ошибка — с «Повторить». */
  status?: LoadStatus
  /** Техническая деталь ошибки загрузки (под «Подробнее»). */
  error?: string | null
  /** Повторить загрузку страницы «Команды». */
  onRetry?: () => void
  settings: CiGlobalSettings | null
  suggestions: CiCommandSuggestion[]
  workspaces: CiWorkspaceReportItem[]
  /** Роль текущего пользователя — правка глобальных настроек только для admin. */
  role: 'admin' | 'user'
  /** Проекты для выбора scope='project'. */
  projects: Array<{ id: string; name: string }>
  onCreate: (input: CiCommandInput) => Promise<CiCommand | null>
  onUpdate: (id: string, input: CiCommandInput) => Promise<void>
  onDelete: (id: string) => Promise<void>
  onUsage: (id: string) => Promise<CiCommandUsage>
  onSaveSettings: (settings: Partial<CiGlobalSettings>) => Promise<void>
  onResolveSuggestion: (id: string, accept: boolean) => Promise<void>
  onClose?: () => void
}

type Draft = Required<Pick<CiCommandInput, 'scope' | 'name' | 'script' | 'description' | 'workdir' | 'allowFailure' | 'isCleanup' | 'availableToModel' | 'isTest'>> & {
  projectId: string | null
  timeoutSec: number | null
  envText: string
}

const EMPTY: Draft = {
  scope: 'global',
  projectId: null,
  name: '',
  script: '',
  description: '',
  workdir: '',
  timeoutSec: null,
  envText: '',
  allowFailure: false,
  isCleanup: false,
  availableToModel: false,
  isTest: false
}

function envToText(env: Record<string, string>): string {
  return Object.entries(env)
    .map(([k, v]) => `${k}=${v}`)
    .join('\n')
}
function textToEnv(text: string): Record<string, string> {
  const env: Record<string, string> = {}
  for (const line of text.split('\n')) {
    const t = line.trim()
    if (!t) continue
    const i = t.indexOf('=')
    if (i <= 0) continue
    env[t.slice(0, i).trim()] = t.slice(i + 1).trim()
  }
  return env
}
function draftOf(cmd: CiCommand): Draft {
  return {
    scope: cmd.scope,
    projectId: cmd.projectId,
    name: cmd.name,
    script: cmd.script,
    description: cmd.description,
    workdir: cmd.workdir,
    timeoutSec: cmd.timeoutSec,
    envText: envToText(cmd.env),
    allowFailure: cmd.allowFailure,
    isCleanup: cmd.isCleanup,
    availableToModel: cmd.availableToModel,
    isTest: cmd.isTest
  }
}
function draftToInput(d: Draft): CiCommandInput {
  return {
    scope: d.scope,
    projectId: d.scope === 'project' ? d.projectId : null,
    name: d.name.trim(),
    script: d.script,
    description: d.description,
    workdir: d.workdir,
    timeoutSec: d.timeoutSec,
    env: textToEnv(d.envText),
    allowFailure: d.allowFailure,
    isCleanup: d.isCleanup,
    availableToModel: d.availableToModel,
    isTest: d.isTest
  }
}

export function CiCommands(props: CiCommandsProps): JSX.Element {
  const { commands } = props
  // Список загружается один раз при открытии страницы; повторная загрузка
  // (кнопка «Повторить») уже показанный справочник не подменяет.
  const view = loadView(props.status ?? 'ready', commands.length > 0)
  const confirm = useConfirm()
  const toast = useToast()
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [draft, setDraft] = useState<Draft>(EMPTY)
  const [saving, setSaving] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)

  const selected = useMemo(() => commands.find((c) => c.id === selectedId) ?? null, [commands, selectedId])

  useEffect(() => {
    if (creating) setDraft(EMPTY)
    else if (selected) setDraft(draftOf(selected))
  }, [creating, selected])

  const startCreate = (): void => {
    setCreating(true)
    setSelectedId(null)
    setDraft(EMPTY)
  }
  const pick = (id: string): void => {
    setCreating(false)
    setSelectedId(id)
  }

  const save = async (): Promise<void> => {
    if (!draft.name.trim()) return
    setSaving(true)
    try {
      if (creating) {
        const cmd = await props.onCreate(draftToInput(draft))
        if (cmd) {
          setCreating(false)
          setSelectedId(cmd.id)
          toast.success('Команда создана')
        }
      } else if (selected) {
        await props.onUpdate(selected.id, draftToInput(draft))
        toast.success('Команда сохранена')
      }
    } finally {
      setSaving(false)
    }
  }
  const cancel = (): void => {
    setCreating(false)
    if (selected) setDraft(draftOf(selected))
    else setDraft(EMPTY)
  }
  const remove = async (cmd: CiCommand): Promise<void> => {
    let extra = ''
    try {
      const usage = await props.onUsage(cmd.id)
      const n = usage.projects.length + usage.tasks.length
      if (n > 0) extra = `Используется: проектов ${usage.projects.length}, задач ${usage.tasks.length}.`
    } catch {
      /* usage опционально */
    }
    const ok = await confirm({
      title: `Удалить команду «${cmd.name}»?`,
      ...(extra ? { message: extra } : {}),
      variant: 'danger',
      confirmLabel: 'Удалить'
    })
    if (!ok) return
    await props.onDelete(cmd.id)
    if (selectedId === cmd.id) setSelectedId(null)
    toast.success('Команда удалена')
  }

  const editForm = (
    <div className="ci-form" data-testid="ci-command-form">
      {(creating || selected) && <h3 className="ci-form-title">{creating ? 'Новая команда' : 'Правка команды'}</h3>}
      {!creating && !selected && (
        <EmptyState
          compact
          icon="⌨"
          title="Команда не выбрана"
          description="Выберите команду в списке слева, чтобы поправить скрипт, или создайте новую."
        />
      )}
      {(creating || selected) && (
        <>
          <label className="ci-field">
            <span>Название</span>
            <input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} placeholder="build" />
          </label>
          <label className="ci-field">
            <span>Область</span>
            <select value={draft.scope} onChange={(e) => setDraft({ ...draft, scope: e.target.value as CiCommandScope })}>
              <option value="global">Глобальная</option>
              <option value="project">Проект</option>
            </select>
          </label>
          {draft.scope === 'project' && (
            <label className="ci-field">
              <span>Проект</span>
              <select value={draft.projectId ?? ''} onChange={(e) => setDraft({ ...draft, projectId: e.target.value || null })}>
                <option value="">—</option>
                {props.projects.map((p) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
            </label>
          )}
          <label className="ci-field">
            <span>Описание</span>
            <input value={draft.description} onChange={(e) => setDraft({ ...draft, description: e.target.value })} />
          </label>
          <label className="ci-field">
            <span>Скрипт</span>
            <textarea className="ci-script" rows={5} value={draft.script} onChange={(e) => setDraft({ ...draft, script: e.target.value })} placeholder="npm ci && npm run build" />
          </label>
          <label className="ci-field">
            <span>Рабочая директория</span>
            <input value={draft.workdir} onChange={(e) => setDraft({ ...draft, workdir: e.target.value })} placeholder="(корень рана)" />
          </label>
          <label className="ci-field">
            <span>Таймаут, сек</span>
            <input type="number" value={draft.timeoutSec ?? ''} onChange={(e) => setDraft({ ...draft, timeoutSec: e.target.value ? Number(e.target.value) : null })} placeholder="из настроек" />
          </label>
          <label className="ci-field">
            <span>Переменные (KEY=VALUE)</span>
            <textarea className="ci-script" rows={2} value={draft.envText} onChange={(e) => setDraft({ ...draft, envText: e.target.value })} />
          </label>
          <div className="ci-flags">
            <label><input type="checkbox" checked={draft.allowFailure} onChange={(e) => setDraft({ ...draft, allowFailure: e.target.checked })} /> Продолжать при ошибке</label>
            <label><input type="checkbox" checked={draft.isCleanup} onChange={(e) => setDraft({ ...draft, isCleanup: e.target.checked })} /> Освобождает директорию (cleanup)</label>
            <label><input type="checkbox" checked={draft.availableToModel} onChange={(e) => setDraft({ ...draft, availableToModel: e.target.checked })} /> Доступна модели</label>
            {/* Гейт гоняет только воркфлоу: такую команду модель не получит инструментом, даже если отмечена «доступна модели». */}
            <label><input type="checkbox" checked={draft.isTest} onChange={(e) => setDraft({ ...draft, isTest: e.target.checked })} /> Проверка (тесты) — только для воркфлоу</label>
          </div>
          <div className="ci-form-actions">
            <Button variant="primary" disabled={saving || !draft.name.trim()} onClick={() => void save()}>Сохранить</Button>
            <Button onClick={cancel}>Отмена</Button>
          </div>
        </>
      )}
    </div>
  )

  return (
    <ToolFrame title="Команды" variant="page" testId="ci-commands" onClose={props.onClose}>
      <div className="ci-page">
        <div className="ci-columns">
          <div className="ci-list-pane">
            <div className="ci-list-head">
              <span>{commands.length} команд</span>
              {view.refreshing && <RefreshIndicator label="Обновляем список…" />}
              <Button variant="primary" onClick={startCreate}>+ Команда</Button>
            </div>
            {view.staleError && (
              <ErrorState
                compact
                message="Список мог устареть: обновить не удалось"
                detail={props.error}
                {...(props.onRetry ? { onRetry: props.onRetry } : {})}
              />
            )}
            <table className="ci-table" data-testid="ci-command-table">
              <thead>
                <tr><th>Название</th><th>Область</th><th>Обновлена</th><th>Автор</th><th /></tr>
              </thead>
              <tbody>
                {commands.map((c) => (
                  <tr key={c.id} className={c.id === selectedId ? 'ci-row--active' : ''} onClick={() => pick(c.id)}>
                    <td>
                      <div className="ci-row-name">{c.name}</div>
                      {c.description && <div className="ci-row-desc">{c.description}</div>}
                    </td>
                    <td><span className="ci-lozenge ci-lozenge--neutral">{c.scope === 'global' ? 'глоб.' : 'проект'}</span></td>
                    <td>{new Date(c.updatedAt).toLocaleDateString()}</td>
                    <td>{c.createdBy}</td>
                    <td><IconButton size="sm" aria-label={`Удалить команду «${c.name}»`} title="Удалить" onClick={(e) => { e.stopPropagation(); void remove(c) }}>🗑</IconButton></td>
                  </tr>
                ))}
                {view.state === 'skeleton' &&
                  [0, 1, 2, 3].map((i) => (
                    /* Косточка занимает высоту ряда таблицы: название + описание. */
                    <tr key={i}>
                      <td colSpan={5}><Skeleton variant="line" height={20} width="70%" testId="ci-command-skeleton" /></td>
                    </tr>
                  ))}
                {view.state === 'error' && (
                  <tr>
                    <td colSpan={5}>
                      <ErrorState
                        message="Не удалось загрузить команды"
                        detail={props.error}
                        {...(props.onRetry ? { onRetry: props.onRetry } : {})}
                      />
                    </td>
                  </tr>
                )}
                {view.state === 'empty' && (
                  <tr>
                    <td colSpan={5}>
                      <EmptyState
                        icon="⌨"
                        title="Команд пока нет — создайте первую"
                        description="Команда — это шаг воркфлоу: сборка, тесты, деплой. Её можно дать проекту и модели."
                        actionLabel="Создать команду"
                        onAction={startCreate}
                      />
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <div className="ci-edit-pane">{editForm}</div>
        </div>

        <CiSettingsSection open={settingsOpen} onToggle={() => setSettingsOpen((v) => !v)} settings={props.settings} editable={props.role === 'admin'} onSave={async (next) => {
          await props.onSaveSettings(next)
          toast.success('Настройки сохранены')
        }} />

        {props.suggestions.length > 0 && (
          <section className="ci-section" data-testid="ci-suggestions">
            <h3 className="ci-section-title">Предложения модели <span className="ci-count-badge">{props.suggestions.length}</span></h3>
            <ul className="ci-suggestions">
              {props.suggestions.map((sug) => {
                const cmd = commands.find((c) => c.id === sug.commandId)
                return (
                  <li key={sug.id} className="ci-suggestion">
                    <div className="ci-suggestion-head">
                      <strong>{cmd?.name ?? sug.commandId}</strong>
                      {sug.occurrences > 1 && <span className="ci-count-badge" title="Повторов рекомендации">×{sug.occurrences}</span>}
                    </div>
                    <div className="ci-suggestion-reason">{sug.reason}</div>
                    <pre className="ci-suggestion-script">{sug.proposedScript}</pre>
                    <div className="ci-form-actions">
                      <Button variant="primary" onClick={() => void props.onResolveSuggestion(sug.id, true)}>Принять</Button>
                      <Button onClick={() => void props.onResolveSuggestion(sug.id, false)}>Отклонить</Button>
                    </div>
                  </li>
                )
              })}
            </ul>
          </section>
        )}

        <section className="ci-section" data-testid="ci-workspaces">
          <h3 className="ci-section-title">Занятое место</h3>
          {props.workspaces.length === 0 ? (
            <EmptyState
              compact
              icon="📦"
              title="Активных рабочих директорий нет"
              description="Появятся, когда ран займёт рабочую копию репозитория на машине."
            />
          ) : (
            <table className="ci-table">
              <thead><tr><th>Задача</th><th>Путь</th><th>Размер</th><th>Состояние</th></tr></thead>
              <tbody>
                {props.workspaces.map((w) => (
                  <tr key={w.id} className={w.orphaned ? 'ci-row--orphan' : ''}>
                    <td>{w.taskTitle ?? w.taskId}</td>
                    <td className="ci-mono">{w.path}</td>
                    <td>{w.sizeBytes != null ? `${(w.sizeBytes / 1024 / 1024).toFixed(1)} МБ` : '—'}</td>
                    <td>{w.orphaned ? <span className="ci-lozenge ci-lozenge--removed">осиротевшая</span> : <span className="ci-lozenge ci-lozenge--neutral">{w.state === 'active' ? 'активна' : 'освобождена'}</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      </div>
    </ToolFrame>
  )
}

interface CiSettingsSectionProps {
  open: boolean
  onToggle: () => void
  settings: CiGlobalSettings | null
  editable: boolean
  onSave: (settings: Partial<CiGlobalSettings>) => Promise<void>
}

function CiSettingsSection({ open, onToggle, settings, editable, onSave }: CiSettingsSectionProps): JSX.Element {
  const current = settings ?? DEFAULT_CI_GLOBAL_SETTINGS
  const [form, setForm] = useState<CiGlobalSettings>(current)
  useEffect(() => setForm(settings ?? DEFAULT_CI_GLOBAL_SETTINGS), [settings])
  const numField = (label: string, key: keyof CiGlobalSettings): JSX.Element => (
    <label className="ci-field">
      <span>{label}</span>
      <input type="number" disabled={!editable} value={form[key]} onChange={(e) => setForm({ ...form, [key]: Number(e.target.value) })} />
    </label>
  )
  return (
    <section className="ci-section" data-testid="ci-settings">
      <button className="ci-collapse-head" aria-expanded={open} onClick={onToggle}>
        <span>{open ? '▾' : '▸'}</span> Глобальные настройки CI {!editable && <span className="ci-lozenge ci-lozenge--neutral">только чтение</span>}
      </button>
      {open && (
        <div className="ci-settings-grid">
          {numField('Макс. попыток исправления', 'maxFixAttempts')}
          {numField('Лимит времени fix-loop, мс', 'fixTimeLimitMs')}
          {numField('Лимит токенов fix-loop', 'fixTokenLimit')}
          {numField('Таймаут шага по умолч., сек', 'defaultStepTimeoutSec')}
          {numField('Окно метрик (ранов)', 'metricsWindow')}
          {numField('Макс. одновременных ранов', 'maxConcurrentRuns')}
          {numField('Макс. вызовов команд моделью', 'maxModelCommandCalls')}
          {editable && (
            <div className="ci-form-actions">
              <Button variant="primary" onClick={() => void onSave(form)}>Сохранить настройки</Button>
            </div>
          )}
        </div>
      )}
    </section>
  )
}
