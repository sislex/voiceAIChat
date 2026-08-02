import { describe, expect, it } from 'vitest'
import { calculateKbHit, filesReadFromCiLog } from './kbHit.js'

describe('filesReadFromCiLog', () => {
  it('берёт пути из read/grep/edit и запасных bash-команд', () => {
    const files = filesReadFromCiLog([
      '[tool_use] Read: /repo/apps/server/src/routes/ci.ts\n',
      '[tool_use] mcp__remote__grep: {"path":"apps/server/src/db/schema.ts","pattern":"ci_run"}\n',
      '[tool_use] Edit: file_path=docs/kb/features/ci-runner.md\n',
      '[tool_use] Bash: sed -n \'1,80p\' apps/server/src/kb/usage.ts && cat "packages/shared/src/ci.ts"\n'
    ])
    expect([...files]).toEqual(expect.arrayContaining([
      '/repo/apps/server/src/routes/ci.ts', 'apps/server/src/db/schema.ts',
      'docs/kb/features/ci-runner.md', 'apps/server/src/kb/usage.ts', 'packages/shared/src/ci.ts'
    ]))
  })
})

describe('calculateKbHit', () => {
  it('считает долю разделов, у которых открыт хотя бы один related file', () => {
    expect(calculateKbHit([
      { documentId: 'ci', anchor: 'report', relatedFiles: ['apps/server/src/routes/ci.ts', 'packages/ui/src/components/ci/'] },
      { documentId: 'tts', anchor: '', relatedFiles: ['apps/server/src/tts/'] },
      { documentId: 'db', anchor: 'schema', relatedFiles: ['apps/server/src/db/*.ts'] }
    ], ['/repo/apps/server/src/routes/ci.ts', 'apps/server/src/db/schema.ts'])).toEqual({
      sectionsDelivered: 3, sectionsHit: 2, hitRatio: 2 / 3
    })
  })

  it('без выданных разделов оставляет метрику пустой', () => {
    expect(calculateKbHit([], [])).toBeNull()
  })
})
