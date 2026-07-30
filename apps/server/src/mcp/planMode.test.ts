import { describe, it, expect } from 'vitest'
import { evaluatePlanModeCommand } from './planMode.js'

describe('evaluatePlanModeCommand', () => {
  it('пропускает исследование рабочей копии', () => {
    for (const cmd of [
      'ls -la apps/server/src',
      'cat package.json',
      'grep -rn "TaskModal" packages/ui/src | head -20',
      'git log --oneline -10',
      'git status --short',
      'git diff HEAD~1',
      'git branch --show-current',
      'find . -name "*.tsx" 2>/dev/null | head',
      'node -e "console.log(1)" 2>&1'
    ]) {
      expect(evaluatePlanModeCommand(cmd), cmd).toEqual({ allowed: true })
    }
  })

  it('отклоняет изменение файлов, установку и мутирующий git', () => {
    for (const cmd of [
      'rm -rf node_modules',
      'mkdir -p /tmp/x',
      'echo hi > file.txt',
      'cat a >> b',
      "sed -i 's/a/b/' file.ts",
      'npm ci',
      'git commit -am wip',
      'git checkout -b feature',
      'docker compose up -d'
    ]) {
      expect(evaluatePlanModeCommand(cmd).allowed, cmd).toBe(false)
    }
  })

  it('редиректы в /dev/null и 2>&1 не считаются записью', () => {
    expect(evaluatePlanModeCommand('ls /nope 2>/dev/null').allowed).toBe(true)
    expect(evaluatePlanModeCommand('grep -r x . >/dev/null 2>&1').allowed).toBe(true)
  })

  it('слово внутри кавычек не считается командой', () => {
    expect(evaluatePlanModeCommand('grep -rn "npm test" docs').allowed).toBe(true)
  })
})
