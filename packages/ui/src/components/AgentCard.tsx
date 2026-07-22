import { useState } from 'react'
import type { AgentInfo, AgentPolicy, AgentSkill } from '@shared/agentProtocol'
import { copyText } from '../lib/clipboard'

export interface AgentCardProps {
  agent: AgentInfo
  onSetPolicy: (id: string, policy: AgentPolicy) => void
  onDelete: (id: string) => void
  /** Перевыпуск токена → новая строка подключения (или null при ошибке). */
  onRegenerateToken: (id: string) => Promise<string | null>
}

/** Редактор списка строк (каталоги/паттерны): добавить/удалить. */
function ListEditor({
  label,
  items,
  placeholder,
  onChange
}: {
  label: string
  items: string[]
  placeholder: string
  onChange: (items: string[]) => void
}): JSX.Element {
  const [draft, setDraft] = useState('')
  const add = (): void => {
    const v = draft.trim()
    if (v && !items.includes(v)) onChange([...items, v])
    setDraft('')
  }
  return (
    <div className="ac-list">
      <p className="fsub">{label}</p>
      {items.map((it) => (
        <div className="vrow2" key={it}>
          <span className="vname ac-mono">{it}</span>
          <button className="vdl vdel" aria-label={`Удалить ${it}`} onClick={() => onChange(items.filter((x) => x !== it))}>
            ✕
          </button>
        </div>
      ))}
      <div className="vrow2">
        <input
          className="sel"
          type="text"
          placeholder={placeholder}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && add()}
        />
        <button className="vdl" disabled={!draft.trim()} onClick={add}>
          Добавить
        </button>
      </div>
    </div>
  )
}

export function AgentCard({ agent, onSetPolicy, onDelete, onRegenerateToken }: AgentCardProps): JSX.Element {
  const [open, setOpen] = useState(false)
  const [policy, setPolicy] = useState<AgentPolicy>(agent.policy)
  const [newToken, setNewToken] = useState<string | null>(null)
  const [tokenCopied, setTokenCopied] = useState(false)
  const [skillDraft, setSkillDraft] = useState<AgentSkill>({ name: '', command: '' })

  const patch = (p: Partial<AgentPolicy>): void => setPolicy((cur) => ({ ...cur, ...p }))
  const dirty = JSON.stringify(policy) !== JSON.stringify(agent.policy)

  const regenerate = async (): Promise<void> => {
    const conn = await onRegenerateToken(agent.id)
    if (conn) {
      setNewToken(conn)
      setTokenCopied(false)
    }
  }

  const addSkill = (): void => {
    const name = skillDraft.name.trim()
    const command = skillDraft.command.trim()
    if (!name || !command) return
    patch({ skills: [...policy.skills, { name, command }] })
    setSkillDraft({ name: '', command: '' })
  }

  return (
    <div className="ac" data-testid={`agent-card-${agent.id}`}>
      <div className="vrow2 ac-head" onClick={() => setOpen((v) => !v)}>
        <span className="vname">
          {open ? '▾' : '▸'} {agent.name}
        </span>
        <span className="vrowr">
          <span className={agent.online ? 'mcp-ok' : 'mcp-bad'}>
            {agent.online ? '✓ в сети' : '✗ офлайн'}
          </span>
        </span>
      </div>

      {open && (
        <div className="ac-body">
          {/* Токен */}
          <div className="ac-section">
            <p className="flab">Токен</p>
            <div className="vrow2">
              <button className="vdl" onClick={() => void regenerate()}>
                Перевыпустить токен
              </button>
              <button className="vdl vdel" onClick={() => onDelete(agent.id)}>
                Удалить машину
              </button>
            </div>
            {newToken && (
              <div className="voicedl">
                <p className="fsub">Новая строка подключения (старая больше не работает):</p>
                <code className="fsub ac-mono" style={{ userSelect: 'all', wordBreak: 'break-all' }}>
                  {newToken}
                </code>
                <button
                  className="vdl"
                  onClick={() => void copyText(newToken).then((ok) => setTokenCopied(ok))}
                >
                  {tokenCopied ? '✓ скопирована' : 'Скопировать строку подключения'}
                </button>
              </div>
            )}
          </div>

          {/* Разрешения */}
          <div className="ac-section">
            <p className="flab">Разрешения</p>
            <div className="frow">
              <p className="fsub">Доступ в сеть / API</p>
              <button
                className={policy.allowNetwork ? 'sw on' : 'sw'}
                role="switch"
                aria-checked={policy.allowNetwork}
                aria-label="Доступ в сеть"
                onClick={() => patch({ allowNetwork: !policy.allowNetwork })}
              />
            </div>
            <div className="frow">
              <p className="fsub">Изменение файлов (создание/правка/удаление)</p>
              <button
                className={policy.allowWrite ? 'sw on' : 'sw'}
                role="switch"
                aria-checked={policy.allowWrite}
                aria-label="Изменение файлов"
                onClick={() => patch({ allowWrite: !policy.allowWrite })}
              />
            </div>
            <ListEditor
              label="Разрешённые каталоги (пусто — любой)"
              items={policy.allowedDirs}
              placeholder="/Users/me/project"
              onChange={(allowedDirs) => patch({ allowedDirs })}
            />
            <ListEditor
              label="Запрещённые паттерны команд"
              items={policy.denyPatterns}
              placeholder="rm\s+-rf  или  sudo"
              onChange={(denyPatterns) => patch({ denyPatterns })}
            />
            <ListEditor
              label="Разрешённые паттерны (если заданы — только они)"
              items={policy.allowPatterns}
              placeholder="^git |^npm "
              onChange={(allowPatterns) => patch({ allowPatterns })}
            />
          </div>

          {/* Навыки */}
          <div className="ac-section">
            <p className="flab">Навыки (именованные скрипты)</p>
            {policy.skills.map((s, i) => (
              <div className="vrow2" key={`${s.name}-${i}`}>
                <span className="vname ac-mono">
                  {s.name}: {s.command}
                </span>
                <button
                  className="vdl vdel"
                  aria-label={`Удалить навык ${s.name}`}
                  onClick={() => patch({ skills: policy.skills.filter((_, j) => j !== i) })}
                >
                  ✕
                </button>
              </div>
            ))}
            <div className="vrow2">
              <input
                className="sel"
                type="text"
                placeholder="Имя (напр. сборка)"
                value={skillDraft.name}
                onChange={(e) => setSkillDraft((d) => ({ ...d, name: e.target.value }))}
              />
              <input
                className="sel"
                type="text"
                placeholder="Команда (npm run build)"
                value={skillDraft.command}
                onChange={(e) => setSkillDraft((d) => ({ ...d, command: e.target.value }))}
              />
              <button className="vdl" disabled={!skillDraft.name.trim() || !skillDraft.command.trim()} onClick={addSkill}>
                Добавить
              </button>
            </div>
          </div>

          <div className="vrow2">
            <button
              className="vdl"
              disabled={!dirty}
              aria-label="Сохранить разрешения"
              onClick={() => onSetPolicy(agent.id, policy)}
            >
              {dirty ? 'Сохранить разрешения' : '✓ сохранено'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
