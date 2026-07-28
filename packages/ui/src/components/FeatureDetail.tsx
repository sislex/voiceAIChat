import { useState } from 'react'
import type { AgentTask, FeatureRun, FeatureStatus } from '@shared/features'
import { ToolFrame } from './ToolFrame'

const NEXT: Partial<Record<FeatureStatus, Array<{ status: FeatureStatus; label: string }>>> = {
  planning: [{ status: 'awaiting_plan_approval', label: 'План готов' }, { status: 'development', label: 'Начать автоматически' }],
  awaiting_plan_approval: [{ status: 'development', label: 'Утвердить план' }, { status: 'planning', label: 'Исправить план' }],
  development: [{ status: 'testing', label: 'Начать тестирование' }, { status: 'awaiting_commit', label: 'Подтвердить коммит' }],
  awaiting_commit: [{ status: 'testing', label: 'Создать коммит и тестировать' }, { status: 'development', label: 'Вернуть в разработку' }],
  testing: [{ status: 'development', label: 'Остановить тесты и доработать' }],
  awaiting_merge: [{ status: 'merging', label: 'Мержить' }, { status: 'development', label: 'Вернуть в разработку' }],
  merging: []
}

export function FeatureDetail({ feature, tasks, onTransition, onAutomation, onAddTask, onDeploy, onClose }: {
  feature: FeatureRun
  tasks: AgentTask[]
  onTransition: (status: FeatureStatus) => void
  onAutomation: (fields: { autoMerge?: boolean; autoDeployProduction?: boolean }) => void
  onAddTask: (input: { title: string }) => void
  onDeploy: () => void
  onClose: () => void
}): JSX.Element {
  const [title, setTitle] = useState('')
  return <ToolFrame title={`Фича #${feature.attempt} · ${feature.title}`} onClose={onClose} testId="feature-detail">
    <div className="feature-detail">
      <p><strong>Состояние:</strong> {feature.status}</p>
      <p><strong>Ветка:</strong> <code>{feature.featureBranch}</code></p>
      {feature.lastError && <p className="feature-error">{feature.lastError}</p>}
      <div className="feature-automation">
        <label><input type="checkbox" checked={feature.autoMerge} onChange={(e) => onAutomation({ autoMerge: e.target.checked })} /> Автомерж</label>
        <label><input type="checkbox" checked={feature.autoDeployProduction} onChange={(e) => onAutomation({ autoDeployProduction: e.target.checked })} /> Автодеплой production</label>
      </div>
      <div className="feature-actions">{(NEXT[feature.status] ?? []).map((a) => <button key={a.status} className="login-submit" onClick={() => onTransition(a.status)}>{a.label}</button>)}{!['completed','cancelled'].includes(feature.status) && <button className="delbtn" onClick={() => onTransition('cancelled')}>Отменить фичу</button>}</div>
      {feature.status === 'completed' && feature.deployStatus !== 'deploying' && <button className="login-submit" onClick={onDeploy}>Задеплоить актуальный main</button>}
      <p><strong>Production:</strong> {feature.deployStatus}</p>
      <h3>Задачи агента</h3>
      <ul className="agent-task-list">{tasks.map((t) => <li key={t.id}><span>{t.status === 'succeeded' ? '✓' : t.status === 'running' ? '●' : '○'}</span> {t.title} <small>{t.kind}</small></li>)}</ul>
      <div className="agent-task-add"><input className="login-input" aria-label="Новая задача агента" value={title} onChange={(e) => setTitle(e.target.value)} /><button className="login-submit" disabled={!title.trim()} onClick={() => { onAddTask({ title: title.trim() }); setTitle('') }}>Добавить</button></div>
    </div>
  </ToolFrame>
}
