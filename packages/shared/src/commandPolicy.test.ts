import { describe, it, expect } from 'vitest'
import { evaluateCommandLayers, isDangerousCommand, parseProjectCommandPolicy, parseRoleCommandPolicies } from './commandPolicy'

describe('commandPolicy', () => {
  it('распознаёт опасные команды и не трогает обычные', () => {
    expect(isDangerousCommand('rm -rf ./dist')).toBe('rm -rf')
    expect(isDangerousCommand('git push --force origin main')).toBe('git push --force')
    expect(isDangerousCommand('git push -f')).toBe('git push --force')
    expect(isDangerousCommand('psql -c "DROP TABLE users"')).toBe('DROP/TRUNCATE')
    expect(isDangerousCommand('sudo reboot')).toBe('выключение/перезагрузка')
    expect(isDangerousCommand('rm file.txt')).toBeNull()
    expect(isDangerousCommand('git push origin feature')).toBeNull()
    expect(isDangerousCommand('npm test')).toBeNull()
  })

  it('слои: deny любого слоя — отказ, allow каждого непустого слоя обязателен', () => {
    const layers = [
      { name: 'project' as const, denyPatterns: ['docker'], allowPatterns: [] },
      { name: 'role' as const, denyPatterns: [], allowPatterns: ['^npm ', '^git '] }
    ]
    expect(evaluateCommandLayers('npm test', layers)).toEqual({ allowed: true })
    // проектный слой проверяется первым, и его deny — подстрока: ловит команду и внутри npm-скрипта
    expect(evaluateCommandLayers('docker ps', layers)).toMatchObject({ allowed: false, layer: 'project' })
    expect(evaluateCommandLayers('npm run docker', layers)).toMatchObject({ allowed: false, layer: 'project' })
    // прошло проект, но не входит в разрешённые ролью
    expect(evaluateCommandLayers('ls', layers)).toMatchObject({ allowed: false, layer: 'role' })
  })

  it('парсеры терпят мусор и чистят пустые паттерны', () => {
    expect(parseProjectCommandPolicy(null)).toEqual({ denyPatterns: [], allowPatterns: [], confirmDangerous: true })
    expect(parseProjectCommandPolicy('{"denyPatterns":["rm", "", 3],"confirmDangerous":false}')).toEqual({ denyPatterns: ['rm'], allowPatterns: [], confirmDangerous: false })
    expect(parseProjectCommandPolicy('not json').confirmDangerous).toBe(true)
    expect(parseRoleCommandPolicies('{"tester":{"denyPatterns":["git push"]},"bogus":{}}')).toEqual({ tester: { denyPatterns: ['git push'], allowPatterns: [] } })
  })
})
