// Общая шапка утилиты машины: одна для консоли, терминала и проводника.
//
// Раньше каждый из трёх виджетов рисовал свой `.fsbar` со своим селектором машины,
// и селектор показывался только когда машин больше одной — при единственной машине
// пользователь не видел, где он вообще работает. Ограничения политики выражались
// лишь отсутствием кнопок: на машине без `allowWrite` «＋ Папка» и «Загрузить»
// просто исчезали без объяснения. Перехода между утилитами не было вовсе (только
// из проводника в терминал, в одну сторону).
//
// Поэтому здесь собрано всё, что относится к МАШИНЕ, а не к самому виджету: имя и
// статус (всегда, даже при одной машине), бейджи запретов с подсказками,
// двусторонний переключатель «консоль/терминал ↔ проводник» и ссылка в раздел
// «Машины», где политика правится.

import type { AgentInfo, AgentPolicy } from '@shared/agentProtocol'
import { Button } from './ui/Button'
import type { UtilityKind } from './machine'

/** Запрет политики: короткая подпись бейджа и подсказка, что именно нельзя. */
export interface PolicyBadge {
  /** Ключ запрета — он же часть `data-testid` бейджа. */
  key: 'write' | 'network' | 'dirs'
  label: string
  hint: string
}

/**
 * Почему на машине без записи нет кнопок изменения файлов. Текст один и тот же в
 * подсказке бейджа и в пометке проводника на месте исчезнувших кнопок: иначе
 * объяснение разъедется с тем, что реально скрыто.
 */
export const READ_ONLY_HINT =
  'Изменения файлов на этой машине запрещены её политикой: нельзя создать папку, ' +
  'загрузить файл, переименовать или удалить — поэтому этих кнопок нет. ' +
  'Разрешение «Запись файлов» включается в разделе «Машины».'

/** Чем ограничена машина. Пусто — политика ничего не запрещает. */
export function policyBadges(policy: AgentPolicy): PolicyBadge[] {
  const badges: PolicyBadge[] = []
  if (!policy.allowWrite) badges.push({ key: 'write', label: 'только чтение', hint: READ_ONLY_HINT })
  if (!policy.allowNetwork) {
    badges.push({
      key: 'network',
      label: 'сеть запрещена',
      hint: 'Команды с обращением в сеть (curl, wget, ssh, scp…) политика машины отклоняет.'
    })
  }
  if (policy.allowedDirs.length > 0) {
    badges.push({
      key: 'dirs',
      label: 'каталоги ограничены',
      hint: `Разрешены только каталоги: ${policy.allowedDirs.join(', ')}. Путь вне них политика отклоняет.`
    })
  }
  return badges
}

export interface MachineUtilityHeaderProps {
  agents: AgentInfo[]
  /** Машина, на которой сейчас работает виджет (null — машин нет вовсе). */
  agentId: string | null
  /** Выбрана другая машина в селекторе (он есть, только когда машин больше одной). */
  onAgentChange: (agentId: string) => void
  /** Что открыто сейчас — этой кнопки переключателя нажатой и не будет. */
  kind: UtilityKind
  /** Подпись консольной кнопки: живой «Терминал» или однострочная «Консоль». */
  consoleLabel?: string
  /** Папка, которая переедет в другую утилиту (cwd проводника или терминала). */
  dir?: string
  /** Переключить утилиту, сохранив машину и папку. Нет — переключателя нет. */
  onSwitch?: (kind: UtilityKind) => void
  /** Открыть раздел «Машины» (политика, разрешения, обновление агента). */
  onOpenMachines?: () => void
}

/** Шапка утилиты: машина со статусом, запреты политики и переключатель утилит. */
export function MachineUtilityHeader({
  agents,
  agentId,
  onAgentChange,
  kind,
  consoleLabel = 'Терминал',
  dir,
  onSwitch,
  onOpenMachines
}: MachineUtilityHeaderProps): JSX.Element {
  const agent = agents.find((a) => a.id === agentId)
  const online = agent?.online ?? false
  const badges = agent ? policyBadges(agent.policy) : []
  // Подсказка переключателя честно называет, что переедет: машина всегда, папка —
  // только если она известна (у однострочной консоли своей папки нет).
  const carry = dir ? `на этой машине в папке ${dir}` : 'на этой машине'

  return (
    <div className="uhead" data-testid="utility-head">
      <span className="uhead-machine" data-testid="utility-machine">
        {agents.length > 1 ? (
          <select
            className="sel"
            aria-label="Машина"
            value={agentId ?? ''}
            onChange={(e) => onAgentChange(e.target.value)}
          >
            {agents.map((a) => (
              <option key={a.id} value={a.id} disabled={!a.online}>
                💻 {a.name}
                {a.online ? '' : ' (офлайн)'}
              </option>
            ))}
          </select>
        ) : (
          // Единственная машина всё равно названа: иначе непонятно, где работаешь.
          <span className="uhead-name">💻 {agent?.name ?? agentId ?? 'Нет машин'}</span>
        )}
        {agentId && (
          <span
            className={online ? 'uhead-status on' : 'uhead-status off'}
            title={
              online
                ? 'Агент машины подключён к серверу'
                : 'Агент на машине не подключён: команды и файловые операции недоступны, пока он не переподключится'
            }
          >
            <span className="uhead-dot" aria-hidden />
            {online ? 'в сети' : 'не в сети'}
            {agent?.version && <span className="uhead-ver">· агент {agent.version}</span>}
          </span>
        )}
      </span>

      {badges.length > 0 && (
        <span className="uhead-badges" data-testid="utility-policy">
          {badges.map((b) => (
            <span key={b.key} className="uhead-badge" data-testid={`utility-policy-${b.key}`} title={b.hint}>
              {b.label}
            </span>
          ))}
        </span>
      )}

      {onSwitch && agentId && (
        <span className="uhead-switch" role="group" aria-label="Что открыто на машине">
          <Button
            size="sm"
            aria-pressed={kind === 'console'}
            title={kind === 'console' ? `Открыто сейчас: ${consoleLabel.toLowerCase()}` : `Открыть ${consoleLabel.toLowerCase()} ${carry}`}
            onClick={() => kind !== 'console' && onSwitch('console')}
          >
            &gt;_ {consoleLabel}
          </Button>
          <Button
            size="sm"
            aria-pressed={kind === 'explorer'}
            title={kind === 'explorer' ? 'Открыто сейчас: проводник' : `Открыть проводник ${carry}`}
            onClick={() => kind !== 'explorer' && onSwitch('explorer')}
          >
            📁 Проводник
          </Button>
        </span>
      )}

      {onOpenMachines && (
        <Button
          size="sm"
          variant="ghost"
          className="uhead-link"
          title="Раздел «Машины»: разрешения, каталоги, паттерны команд и обновление агента"
          onClick={onOpenMachines}
        >
          Машины ↗
        </Button>
      )}
    </div>
  )
}
