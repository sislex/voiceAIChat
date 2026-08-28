// Гейт команд поверх политики машины (machines-roadmap п.10): проект → роль → (машина проверяется в registry.exec).
// Опасные команды из чата требуют явного подтверждения пользователя (`confirm: true` в инструменте bash).
import { evaluateCommandLayers, isDangerousCommand, type CommandGateVerdict, type CommandPolicyLayer, type ProjectCommandPolicy, type RoleCommandPolicies } from '@voicechat/shared'
import type { UserRole } from '@voicechat/shared'

export interface CommandGateDeps {
  projectPolicy(projectId: string): ProjectCommandPolicy | null
  rolePolicies(): RoleCommandPolicies
  userRole(userId: string): UserRole | null
}

export interface CommandGateInput {
  command: string
  userId?: string | null
  projectId?: string | null
  /** Источник: в чате опасные команды ждут подтверждения, в консоли пользователь и так у клавиатуры. */
  source: 'console' | 'chat'
  confirm?: boolean
}

export type CommandGate = (input: CommandGateInput) => CommandGateVerdict

export function createCommandGate(deps: CommandGateDeps): CommandGate {
  return ({ command, userId, projectId, source, confirm }) => {
    const layers: Array<CommandPolicyLayer & { name: 'project' | 'role' }> = []
    const project = projectId ? deps.projectPolicy(projectId) : null
    if (project) layers.push({ name: 'project', denyPatterns: project.denyPatterns, allowPatterns: project.allowPatterns })
    const role = userId ? deps.userRole(userId) : null
    const roleLayer = role ? deps.rolePolicies()[role] : undefined
    if (roleLayer) layers.push({ name: 'role', ...roleLayer })
    const verdict = evaluateCommandLayers(command, layers)
    if (!verdict.allowed) return verdict
    // Подтверждение опасной команды — только для чата и только если проект (или его отсутствие — дефолт) этого требует.
    const confirmDangerous = project ? project.confirmDangerous : true
    if (source === 'chat' && confirmDangerous && !confirm) {
      const danger = isDangerousCommand(command)
      if (danger) return { allowed: false, layer: 'confirm', needsConfirmation: true, reason: `опасная команда (${danger})` }
    }
    return { allowed: true }
  }
}

/** Текст отказа для модели: что делать дальше, а не просто «нельзя». */
export function commandGateMessage(verdict: CommandGateVerdict): string {
  if (verdict.needsConfirmation) {
    return `Отклонено: ${verdict.reason}. Не выполняй её молча: объясни пользователю, что именно сделает команда, ` +
      `дождись его явного согласия в чате и только тогда повтори вызов с confirm: true.`
  }
  return `Отклонено: ${verdict.reason ?? 'политика команд'}. Подбери другой способ или попроси владельца проекта/админа изменить политику.`
}
