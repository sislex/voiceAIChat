import { describe, it, expect } from 'vitest'
import { bashFileReadRejection, evaluateBashFileRead } from './bashFileRead'

const CWD = '/root/repos/chatai/70/задача'

/** Команды взяты из лент реальных ранов (ci_run_logs): именно их мы обязаны не трогать. */
const REAL_ALLOWED = [
  'pwd; ls -a; ls /root/repos/chatai/ 2>&1 | head',
  'cd /root/repos/chatai/70/задача && pwd && git status --short | head && git log --oneline -3',
  'cd /root/repos/chatai/70/задача && npm run kb:check 2>&1 | tail -30',
  'cd /root/repos/chatai/70/задача && grep -rn "Режим" --include=*.tsx packages/ui/src/components | head -30',
  'cd /root/repos/chatai/70/задача && grep -rn -- "--model" --include="*.ts" apps packages | grep -v test | head -20',
  'claude --help 2>&1 | sed -n \'/Commands:/,$p\' | head -40',
  'cd /root/repos/chatai/70/задача && git diff packages/ui/src/styles/app.css && sed -n \'248,300p\' packages/shared/src/ci.ts',
  'cd /root/repos/chatai/70/задача && ls packages/ui/src/styles/ && head -40 packages/ui/src/styles/*.test.ts 2>/dev/null',
  'cd /root/repos/chatai/70/задача && sed -i "s/model: opus,/model: opus1m,/g" apps/server/src/db/database.test.ts',
  'cd /usr/lib/node_modules/@anthropic-ai/claude-code && cat package.json | head -30',
  'cat /tmp/voicechat-prod-rebuild.log',
  'tail -f apps/server/log.txt',
  'npm test 2>&1 | tail -50',
  'sed -n "/describe/,/})/p" apps/server/src/ci/report.test.ts',
  'head -c 200 apps/server/src/ci/report.ts',
  'ls -la docs/kb && cat docs/kb/llm.md',
  // Подстановки и heredoc: чтение там либо не чтение файла, либо вовсе запись.
  'cat "$FILE"',
  'cat $(ls docs)',
  'cat `ls docs`',
  "cat > /tmp/kbget.js <<'EOF'\nconst x = 1\nEOF"
]

describe('evaluateBashFileRead: команду с работой не трогаем', () => {
  it.each(REAL_ALLOWED)('пропускает: %s', (command) => {
    expect(evaluateBashFileRead(command, CWD)).toBeNull()
  })

  it('без cwd гейт молчит: считать пути не от чего', () => {
    expect(evaluateBashFileRead('cat package.json', undefined)).toBeNull()
  })

  it('мусор на входе не роняет и не запрещает', () => {
    for (const command of ['', '   ', '"', 'cat', 'cd', 'cat -', 'sed -n', 'sed -n 1,5p']) {
      expect(evaluateBashFileRead(command, CWD)).toBeNull()
    }
  })
})

describe('evaluateBashFileRead: чистое чтение файла', () => {
  it('cat файла рабочей копии → read без окна', () => {
    expect(evaluateBashFileRead('cat package.json', CWD)).toEqual({
      calls: [{ path: 'package.json' }], fromEnd: false
    })
  })

  it('cd в рабочую директорию перед чтением — самая частая форма в лентах', () => {
    expect(evaluateBashFileRead(`cd ${CWD} && sed -n '1,120p' apps/server/src/kb/routes.ts`, CWD)).toEqual({
      calls: [{ path: 'apps/server/src/kb/routes.ts', offset: 1, limit: 120 }], fromEnd: false
    })
  })

  it('cd в подкаталог: путь для read считается от cwd', () => {
    expect(evaluateBashFileRead('cd apps/server && cat src/server.ts', CWD)).toEqual({
      calls: [{ path: 'apps/server/src/server.ts' }], fromEnd: false
    })
  })

  it('несколько окон sed и разделители echo — один отказ на всю цепочку', () => {
    expect(evaluateBashFileRead(
      `cd ${CWD} && sed -n '160,175p;340,400p' apps/server/src/db/database.test.ts; echo ===; cat docs/kb/llm.md`,
      CWD
    )).toEqual({
      calls: [
        { path: 'apps/server/src/db/database.test.ts', offset: 160, limit: 16 },
        { path: 'apps/server/src/db/database.test.ts', offset: 340, limit: 61 },
        { path: 'docs/kb/llm.md' }
      ],
      fromEnd: false
    })
  })

  it('head считает окно с начала, tail без -n + помечается как хвост', () => {
    expect(evaluateBashFileRead('head -40 AGENTS.md', CWD)).toEqual({
      calls: [{ path: 'AGENTS.md', offset: 1, limit: 40 }], fromEnd: false
    })
    expect(evaluateBashFileRead('head AGENTS.md', CWD)?.calls).toEqual([{ path: 'AGENTS.md', offset: 1, limit: 10 }])
    expect(evaluateBashFileRead('tail -n 20 AGENTS.md', CWD)).toEqual({
      calls: [{ path: 'AGENTS.md' }], fromEnd: true
    })
    expect(evaluateBashFileRead('tail -n +50 AGENTS.md', CWD)).toEqual({
      calls: [{ path: 'AGENTS.md', offset: 50 }], fromEnd: false
    })
  })

  it('абсолютный путь внутри cwd приводится к относительному', () => {
    expect(evaluateBashFileRead(`cat ${CWD}/apps/server/src/server.ts`, CWD)?.calls)
      .toEqual([{ path: 'apps/server/src/server.ts' }])
  })

  it('файл вне рабочей копии остаётся за bash: read туда не дотянется', () => {
    expect(evaluateBashFileRead('cat ../соседняя/README.md', CWD)).toBeNull()
    expect(evaluateBashFileRead('cd /etc && cat hosts', CWD)).toBeNull()
  })
})

describe('bashFileReadRejection', () => {
  it('ответ — готовый вызов read, а не нотация', () => {
    const verdict = evaluateBashFileRead("sed -n '10,20p' apps/server/src/server.ts", CWD)!
    const text = bashFileReadRejection(verdict)
    expect(text).toContain('Отклонено:')
    expect(text).toContain('read {"path":"apps/server/src/server.ts","offset":10,"limit":11}')
    expect(text).toContain('пайплайн')
  })

  it('хвост файла объясняется отдельной строкой, длинный список обрезается', () => {
    const tail = bashFileReadRejection(evaluateBashFileRead('tail -5 AGENTS.md', CWD)!)
    expect(tail).toContain('из N строк')
    const many = bashFileReadRejection(evaluateBashFileRead('cat a1 a2 a3 a4 a5 a6 a7', CWD)!)
    expect(many).toContain('…и ещё 2')
  })
})
