// Политика команд поверх политики машины (machines-roadmap п.10): слои проекта и роли пользователя
// и список «опасных» команд, которым в чате нужно явное подтверждение пользователя.
import { matchesPattern, type AgentPolicy } from './agentProtocol'
import type { UserRole } from './types'

export interface CommandPolicyLayer {
  /** Запрещённые паттерны (regex или подстрока, как в политике машины). */
  denyPatterns: string[]
  /** Если непусто — разрешены только совпадающие команды. */
  allowPatterns: string[]
}

export interface ProjectCommandPolicy extends CommandPolicyLayer {
  /** Опасные команды (rm -rf, force-push, DROP TABLE, …) из чата выполняются только после подтверждения пользователя. */
  confirmDangerous: boolean
}

export const DEFAULT_PROJECT_COMMAND_POLICY: ProjectCommandPolicy = { denyPatterns: [], allowPatterns: [], confirmDangerous: true }

/** Ролевые правила (админка): для каких ролей какие команды запрещены/разрешены на любой машине. */
export type RoleCommandPolicies = Partial<Record<UserRole, CommandPolicyLayer>>

/** Что считаем опасным: необратимое удаление, перезапись истории, разрушение данных/системы. */
export const DANGEROUS_COMMAND_PATTERNS: Array<{ pattern: string; label: string }> = [
  { pattern: '\\brm\\s+(-[a-zA-Z]*r[a-zA-Z]*f|-[a-zA-Z]*f[a-zA-Z]*r)\\b', label: 'rm -rf' },
  { pattern: '\\bgit\\s+push\\b[^|;&]*(--force|-f\\b|\\+[a-zA-Z])', label: 'git push --force' },
  { pattern: '\\bgit\\s+(reset\\s+--hard|clean\\s+-[a-zA-Z]*f|branch\\s+-D)\\b', label: 'git reset --hard / clean -f / branch -D' },
  { pattern: '\\b(drop|truncate)\\s+(table|database|schema)\\b', label: 'DROP/TRUNCATE' },
  { pattern: '\\b(mkfs|fdisk|parted)\\b|\\bdd\\s+if=', label: 'разметка диска / dd' },
  { pattern: '\\b(shutdown|reboot|halt|poweroff)\\b', label: 'выключение/перезагрузка' },
  { pattern: '\\bchmod\\s+(-R\\s+)?[0-7]*777\\b', label: 'chmod 777' },
  { pattern: ':\\(\\)\\s*\\{\\s*:\\|:&\\s*\\};:', label: 'fork bomb' },
  { pattern: '\\bkubectl\\s+delete\\b|\\bdocker\\s+(system\\s+prune|rm\\s+-f|volume\\s+rm)\\b', label: 'удаление контейнеров/ресурсов' }
]

/** Совпавшая опасная конструкция или null. */
export function isDangerousCommand(command: string): string | null {
  const cmd = command.trim()
  for (const { pattern, label } of DANGEROUS_COMMAND_PATTERNS) {
    if (new RegExp(pattern, 'i').test(cmd)) return label
  }
  return null
}

export interface CommandGateVerdict {
  allowed: boolean
  /** Кто отказал: 'project' | 'role' | 'machine' | 'confirm'. */
  layer?: 'project' | 'role' | 'machine' | 'confirm'
  reason?: string
  /** Команда опасна и ждёт явного подтверждения пользователя. */
  needsConfirmation?: boolean
}

/** Слои проверяются по очереди; каждый непустой allow-список должен пропустить команду, любой deny — отказ. */
export function evaluateCommandLayers(command: string, layers: Array<CommandPolicyLayer & { name: 'project' | 'role' }>): CommandGateVerdict {
  const cmd = command.trim()
  for (const layer of layers) {
    if (layer.allowPatterns.length > 0 && !layer.allowPatterns.some((p) => matchesPattern(p, cmd))) {
      return { allowed: false, layer: layer.name, reason: `команда не входит в разрешённые ${layer.name === 'project' ? 'проектом' : 'ролью'}` }
    }
    const denied = layer.denyPatterns.find((p) => matchesPattern(p, cmd))
    if (denied) return { allowed: false, layer: layer.name, reason: `запрещено ${layer.name === 'project' ? 'политикой проекта' : 'политикой роли'}: ${denied}` }
  }
  return { allowed: true }
}

export function parseProjectCommandPolicy(raw: string | null | undefined): ProjectCommandPolicy {
  if (!raw) return { ...DEFAULT_PROJECT_COMMAND_POLICY }
  try {
    const v = JSON.parse(raw) as Partial<ProjectCommandPolicy>
    return {
      denyPatterns: Array.isArray(v.denyPatterns) ? v.denyPatterns.filter((p): p is string => typeof p === 'string' && p.trim().length > 0) : [],
      allowPatterns: Array.isArray(v.allowPatterns) ? v.allowPatterns.filter((p): p is string => typeof p === 'string' && p.trim().length > 0) : [],
      confirmDangerous: v.confirmDangerous !== false
    }
  } catch { return { ...DEFAULT_PROJECT_COMMAND_POLICY } }
}

export function parseRoleCommandPolicies(raw: string | null | undefined): RoleCommandPolicies {
  if (!raw) return {}
  try {
    const v = JSON.parse(raw) as Record<string, Partial<CommandPolicyLayer>>
    const out: RoleCommandPolicies = {}
    for (const role of ['admin', 'developer', 'tester', 'observer'] as UserRole[]) {
      const layer = v[role]
      if (!layer) continue
      out[role] = { denyPatterns: Array.isArray(layer.denyPatterns) ? layer.denyPatterns.filter((p): p is string => typeof p === 'string' && p.trim().length > 0) : [], allowPatterns: Array.isArray(layer.allowPatterns) ? layer.allowPatterns.filter((p): p is string => typeof p === 'string' && p.trim().length > 0) : [] }
    }
    return out
  } catch { return {} }
}

/** Политика машины — последний слой, тот же, что применит агент; здесь — чтобы отказ пришёл с понятным «кто». */
export function evaluateWithMachine(command: string, machine: AgentPolicy | undefined, layers: Array<CommandPolicyLayer & { name: 'project' | 'role' }>): CommandGateVerdict {
  const layered = evaluateCommandLayers(command, layers)
  if (!layered.allowed || !machine) return layered
  const denied = machine.denyPatterns.find((p) => matchesPattern(p, command.trim()))
  if (denied) return { allowed: false, layer: 'machine', reason: `запрещено политикой машины: ${denied}` }
  return { allowed: true }
}
