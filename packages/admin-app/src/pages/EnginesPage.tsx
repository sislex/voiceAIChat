// Реестр LLM-исполнителей: отдельная страница `#/users/engines`.
//
// Раньше секция висела на странице пользователей, хотя к конкретному человеку
// отношения не имеет: это настройка установки. Заодно её данные больше не
// грузятся при каждом открытии списка людей.

import { useState } from 'react'
import type { AdminLlmEngine, AdminLlmEngineHealth, AdminLlmEngineInput } from '@shared/admin'
import { Button, ErrorState, EmptyState, RefreshIndicator, Skeleton } from '@voicechat/ui-kit'
import { loadView, type LoadStatus } from '../loadState'

const EMPTY_ENGINE: AdminLlmEngineInput = {
  name: '',
  kind: 'claude',
  baseUrl: '',
  token: '',
  enabled: true,
  allowedRoles: ['admin', 'developer', 'tester', 'observer'],
  isDefault: false
}

export interface EnginesPageProps {
  engines: AdminLlmEngine[]
  enginesStatus?: LoadStatus
  enginesError?: string | null
  engineHealth: Record<string, AdminLlmEngineHealth | undefined>
  onRetryEngines?: () => void
  onCreateEngine: (input: AdminLlmEngineInput) => void
  onUpdateEngine: (id: string, patch: AdminLlmEngineInput) => void
  onDeleteEngine: (id: string) => void
  onCheckEngineHealth: (id: string) => void
}

export function EnginesPage({
  engines,
  enginesStatus = 'ready',
  enginesError = null,
  engineHealth,
  onRetryEngines,
  onCreateEngine,
  onUpdateEngine,
  onDeleteEngine,
  onCheckEngineHealth
}: EnginesPageProps): JSX.Element {
  const [engineDraft, setEngineDraft] = useState<AdminLlmEngineInput>(EMPTY_ENGINE)
  const [editingEngineId, setEditingEngineId] = useState<string | null>(null)
  const [confirmEngineDelete, setConfirmEngineDelete] = useState<string | null>(null)
  const enginesView = loadView(enginesStatus, engines.length > 0)

  const resetEngineForm = (): void => {
    setEditingEngineId(null)
    setEngineDraft(EMPTY_ENGINE)
  }

  const submitEngine = (): void => {
    const payload: AdminLlmEngineInput = {
      ...engineDraft,
      name: engineDraft.name.trim(),
      baseUrl: engineDraft.baseUrl.trim(),
      token: engineDraft.token.trim()
    }
    if (!payload.name || !payload.baseUrl) return
    if (editingEngineId) onUpdateEngine(editingEngineId, payload)
    else onCreateEngine(payload)
    resetEngineForm()
  }

  return (
    <section className="uadmin-sec" data-testid="llm-engines-section">
            {enginesView.state === 'skeleton' && <Skeleton variant="list" count={2} height={66} lines={3} />}
      {enginesView.state === 'error' && <ErrorState compact message="Не удалось загрузить исполнителей" detail={enginesError} {...(onRetryEngines ? { onRetry: onRetryEngines } : {})} />}
      {enginesView.staleError && <ErrorState compact message="Реестр исполнителей мог устареть" detail={enginesError} {...(onRetryEngines ? { onRetry: onRetryEngines } : {})} />}
      {enginesView.refreshing && <RefreshIndicator label="Обновляем исполнителей…" />}
      {engines.length === 0 && enginesView.state !== 'skeleton' && <EmptyState compact icon="🤖" title="Исполнителей пока нет" description="Добавьте URL и токен runner'а: каждая запись обслуживает один kind." />}
      {engines.map((engine) => {
        const health = engineHealth[engine.id]
        return (
          <div key={engine.id} className="cc-item" data-testid="llm-engine-item">
            <div className="cc-name">{engine.name}</div>
            <div className="cc-sub">{engine.kind} · роли: {engine.allowedRoles.join(', ')} · {engine.isDefault ? 'default' : 'не default'} · {engine.enabled ? 'enabled' : 'disabled'}</div>
            <div className="cc-sub">{engine.baseUrl}</div>
            <div className="cc-sub">health: {health ? (health.available ? 'жив' : 'недоступен') : 'не проверен'}{health ? ` · ${health.detail}` : ''}</div>
            <div className="uadmin-actions" style={{ marginTop: 8 }}>
              <Button size="sm" onClick={() => onCheckEngineHealth(engine.id)}>Проверить</Button>
              <Button size="sm" onClick={() => {
                setEditingEngineId(engine.id)
                setEngineDraft({
                  name: engine.name,
                  kind: engine.kind,
                  baseUrl: engine.baseUrl,
                  token: engine.token,
                  enabled: engine.enabled,
                  allowedRoles: [...engine.allowedRoles],
                  isDefault: engine.isDefault
                })
              }}>Править</Button>
              {confirmEngineDelete === engine.id ? (
                <>
                  <Button variant="danger" size="sm" onClick={() => onDeleteEngine(engine.id)}>Удалить</Button>
                  <Button size="sm" onClick={() => setConfirmEngineDelete(null)}>Отмена</Button>
                </>
              ) : (
                <Button variant="danger" size="sm" onClick={() => setConfirmEngineDelete(engine.id)}>Удалить</Button>
              )}
            </div>
          </div>
        )
      })}
      <div className="ucreate">
        <p className="ucreate-h">{editingEngineId ? 'Править исполнителя' : 'Добавить исполнителя'}</p>
        <input className="login-input" placeholder="Название" aria-label="Название исполнителя" value={engineDraft.name} onChange={(e) => setEngineDraft({ ...engineDraft, name: e.target.value })} />
        <select className="sel" aria-label="Kind исполнителя" value={engineDraft.kind} onChange={(e) => setEngineDraft({ ...engineDraft, kind: e.target.value as 'claude' | 'codex' })}>
          <option value="claude">claude</option>
          <option value="codex">codex</option>
        </select>
        <input className="login-input" placeholder="http://runner:8080" aria-label="URL исполнителя" value={engineDraft.baseUrl} onChange={(e) => setEngineDraft({ ...engineDraft, baseUrl: e.target.value })} />
        <input className="login-input" placeholder="Bearer token" aria-label="Токен исполнителя" value={engineDraft.token} onChange={(e) => setEngineDraft({ ...engineDraft, token: e.target.value })} />
        <label className="cc-sub"><input type="checkbox" checked={engineDraft.enabled} onChange={(e) => setEngineDraft({ ...engineDraft, enabled: e.target.checked })} /> enabled</label>
        <label className="cc-sub"><input type="checkbox" checked={engineDraft.isDefault} onChange={(e) => setEngineDraft({ ...engineDraft, isDefault: e.target.checked })} /> default для kind</label>
        <label className="cc-sub"><input type="checkbox" checked={engineDraft.allowedRoles.includes('admin')} onChange={(e) => setEngineDraft({ ...engineDraft, allowedRoles: e.target.checked ? Array.from(new Set([...engineDraft.allowedRoles, 'admin'])) : engineDraft.allowedRoles.filter((role) => role !== 'admin') })} /> admin</label>
        {(['developer', 'tester', 'observer'] as const).map((role) => <label key={role} className="cc-sub"><input type="checkbox" checked={engineDraft.allowedRoles.includes(role)} onChange={(e) => setEngineDraft({ ...engineDraft, allowedRoles: e.target.checked ? Array.from(new Set([...engineDraft.allowedRoles, role])) : engineDraft.allowedRoles.filter((item) => item !== role) })} /> {role}</label>) }
        <div className="uadmin-actions">
          <Button variant="primary" disabled={!engineDraft.name.trim() || !engineDraft.baseUrl.trim() || engineDraft.allowedRoles.length === 0} onClick={submitEngine}>{editingEngineId ? 'Сохранить' : 'Добавить'}</Button>
          {editingEngineId && <Button onClick={resetEngineForm}>Отмена</Button>}
        </div>
      </div>
    </section>
  )
}
