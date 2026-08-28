// Редактор политики одной машины: разрешённые каталоги, паттерны команд и навыки.
// Раскрывается строкой таблицы «Машины» (MachineStatus), поэтому своей шапки со
// сворачиванием у него нет — раскрытием управляет строка. Быстрые разрешения
// («Сеть», «Запись файлов»), перевыпуск токена и удаление машины живут там же, в
// строке, и здесь не дублируются.
//
// Правки уходят сразу, а не по кнопке «Сохранить»: черновик политики рядом с
// чекбоксами той же строки разъезжался бы с ними — сохранение возвращало бы
// снятое в строке разрешение обратно.

import { useState } from 'react'
import type { AgentInfo, AgentPolicy, AgentSkill } from '@shared/agentProtocol'
import { IconButton } from '@voicechat/ui-kit'
import { Button } from '@voicechat/ui-kit'

export interface AgentCardProps {
  agent: AgentInfo
  /** Сохранить политику машины (сервер сразу применит её онлайн-агенту). */
  onSetPolicy: (id: string, policy: AgentPolicy) => void
}

/**
 * Редактор списка строк (каталоги/паттерны): добавить/удалить. Подпись кнопки
 * добавления одинаковая во всех списках, поэтому её различает `addLabel` —
 * `aria-label` и тултип, иначе три «Добавить» подряд неразличимы ни для
 * скринридера, ни в тесте.
 */
function ListEditor({
  label,
  addLabel,
  items,
  placeholder,
  onChange
}: {
  label: string
  addLabel: string
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
          <IconButton variant="danger" size="sm" aria-label={`Удалить ${it}`} title={`Удалить ${it}`} onClick={() => onChange(items.filter((x) => x !== it))}>
            ✕
          </IconButton>
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
        <Button variant="primary" size="sm" aria-label={addLabel} title={addLabel} disabled={!draft.trim()} onClick={add}>
          Добавить
        </Button>
      </div>
    </div>
  )
}

export function AgentCard({ agent, onSetPolicy }: AgentCardProps): JSX.Element {
  const [skillDraft, setSkillDraft] = useState<AgentSkill>({ name: '', command: '' })
  const policy = agent.policy

  const patch = (p: Partial<AgentPolicy>): void => onSetPolicy(agent.id, { ...policy, ...p })

  const addSkill = (): void => {
    const name = skillDraft.name.trim()
    const command = skillDraft.command.trim()
    if (!name || !command) return
    patch({ skills: [...policy.skills, { name, command }] })
    setSkillDraft({ name: '', command: '' })
  }

  return (
    <div className="ac" data-testid={`agent-card-${agent.id}`}>
      <div className="ac-body">
        {/* Что разрешено выполнять: чекбоксы «Сеть»/«Запись файлов» — в строке машины. */}
        <div className="ac-section">
          <p className="flab">Что разрешено выполнять</p>
          <ListEditor
            label="Разрешённые каталоги (пусто — любой)"
            addLabel="Добавить разрешённый каталог"
            items={policy.allowedDirs}
            placeholder="/Users/me/project"
            onChange={(allowedDirs) => patch({ allowedDirs })}
          />
          <ListEditor
            label="Запрещённые паттерны команд"
            addLabel="Добавить запрещённый паттерн"
            items={policy.denyPatterns}
            placeholder="rm\s+-rf  или  sudo"
            onChange={(denyPatterns) => patch({ denyPatterns })}
          />
          <ListEditor
            label="Разрешённые паттерны (если заданы — только они)"
            addLabel="Добавить разрешённый паттерн"
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
              <IconButton
                variant="danger"
                size="sm"
                aria-label={`Удалить навык ${s.name}`}
                title={`Удалить навык ${s.name}`}
                onClick={() => patch({ skills: policy.skills.filter((_, j) => j !== i) })}
              >
                ✕
              </IconButton>
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
            <Button
              variant="primary"
              size="sm"
              aria-label="Добавить навык"
              title="Добавить навык"
              disabled={!skillDraft.name.trim() || !skillDraft.command.trim()}
              onClick={addSkill}
            >
              Добавить
            </Button>
          </div>
        </div>

        {/* Живой терминал: ограничения поверх доверенного shell (machines-roadmap п.12). */}
        <div className="ac-section">
          <p className="flab">Терминал (PTY)</p>
          <div className="vrow2">
            <label className="ac-num">
              <span>Закрывать без ввода, мин (0 — никогда)</span>
              <input className="sel" type="number" min={0} max={1440} aria-label="Таймаут простоя терминала, минут" value={policy.ptyIdleMinutes ?? 0} onChange={(e) => patch({ ptyIdleMinutes: Math.max(0, Number(e.target.value) || 0) })} />
            </label>
            <label className="ac-num">
              <span>Одновременных сеансов (0 — без лимита)</span>
              <input className="sel" type="number" min={0} max={50} aria-label="Лимит одновременных терминалов" value={policy.ptyMaxSessions ?? 0} onChange={(e) => patch({ ptyMaxSessions: Math.max(0, Number(e.target.value) || 0) })} />
            </label>
          </div>
          <label className="ac-check">
            <input type="checkbox" aria-label="Подтверждать sudo в терминале" checked={policy.ptyConfirmSudo === true} onChange={(e) => patch({ ptyConfirmSudo: e.target.checked })} />
            <span>Спрашивать подтверждение (y/N) перед командами с <code>sudo</code></span>
          </label>
        </div>

        <p className="fsub">
          Изменения применяются сразу: политика уходит на сервер, а если агент в сети — и на машину.
        </p>
      </div>
    </div>
  )
}
