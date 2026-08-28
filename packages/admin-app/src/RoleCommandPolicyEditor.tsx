// Ролевые правила команд (machines-roadmap п.10): что запрещено/разрешено роли на любой машине — поверх политики машины и проекта.
import { useState } from 'react'
import type { UserRole } from '@shared/types'
import type { RoleCommandPolicies } from '@shared/commandPolicy'
import { Button } from '@voicechat/ui-kit'

const ROLES: Array<{ role: UserRole; label: string }> = [
  { role: 'developer', label: 'developer' }, { role: 'tester', label: 'tester' }, { role: 'observer', label: 'observer' }
]
const lines = (v?: string[]): string => (v ?? []).join('\n')
const parse = (v: string): string[] => v.split('\n').map((s) => s.trim()).filter(Boolean)

export function RoleCommandPolicyEditor({ roles, onSave }: { roles: RoleCommandPolicies; onSave: (roles: RoleCommandPolicies) => Promise<void> }): JSX.Element {
  const [draft, setDraft] = useState<Record<string, { deny: string; allow: string }>>(() => Object.fromEntries(ROLES.map(({ role }) => [role, { deny: lines(roles[role]?.denyPatterns), allow: lines(roles[role]?.allowPatterns) }])))
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const save = async (): Promise<void> => {
    setSaving(true)
    const next: RoleCommandPolicies = {}
    for (const { role } of ROLES) {
      const d = draft[role]!
      const deny = parse(d.deny); const allow = parse(d.allow)
      if (deny.length || allow.length) next[role] = { denyPatterns: deny, allowPatterns: allow }
    }
    try { await onSave(next); setSaved(true); setTimeout(() => setSaved(false), 2000) } finally { setSaving(false) }
  }
  return (
    <section className="uadmin-sec" data-testid="role-command-policy">
      <div className="uusage-heading"><div><h3 className="uadmin-h">Команды по ролям</h3><p className="uusage-note">Паттерны (regex или подстрока), по одному в строке; действуют на любой машине поверх политики машины и проекта. Админ не ограничивается.</p></div>
        <Button size="sm" variant="primary" disabled={saving} onClick={() => void save()}>{saving ? 'Сохраняем…' : saved ? '✓ Сохранено' : 'Сохранить'}</Button></div>
      <table className="utable"><thead><tr><th>Роль</th><th>Запрещено</th><th>Разрешено (если задано — только это)</th></tr></thead><tbody>
        {ROLES.map(({ role, label }) => (
          <tr key={role}>
            <td>{label}</td>
            <td><textarea rows={2} aria-label={`Запрещённые команды для ${label}`} value={draft[role]!.deny} onChange={(e) => setDraft((d) => ({ ...d, [role]: { ...d[role]!, deny: e.target.value } }))} /></td>
            <td><textarea rows={2} aria-label={`Разрешённые команды для ${label}`} value={draft[role]!.allow} onChange={(e) => setDraft((d) => ({ ...d, [role]: { ...d[role]!, allow: e.target.value } }))} /></td>
          </tr>
        ))}
      </tbody></table>
    </section>
  )
}
