import { describe, it, expect } from 'vitest'
import { execFileSync } from 'node:child_process'
import { ClaudeCli } from './claudeCli'

// Интеграционный тест против реального `claude`. Делает сетевой запрос, поэтому
// запускается только при доступном в PATH бинаре (иначе skip — CI без CLI зелёный).

function claudeAvailable(): boolean {
  try {
    execFileSync('which', ['claude'], { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
}

interface Outcome {
  text: string
  sessionId: string | null
  error: string | null
}

describe.skipIf(!claudeAvailable())('ClaudeCli — реальный claude (integration)', () => {
  it(
    'короткий запрос → непустой ответ и session_id',
    async () => {
      const cli = new ClaudeCli()
      const outcome = await new Promise<Outcome>((resolve) => {
        let text = ''
        let sessionId: string | null = null
        cli.send(
          {
            prompt: 'Ответь ровно одним словом: привет',
            sessionId: null,
            model: 'sonnet'
          },
          {
            onDelta: (d) => {
              text += d
            },
            onSession: (s) => {
              sessionId = s
            },
            onDone: (t) => resolve({ text: t || text, sessionId, error: null }),
            onError: (message) => resolve({ text: '', sessionId, error: message })
          }
        )
      })

      expect(outcome.error).toBeNull()
      expect(outcome.text.trim().length).toBeGreaterThan(0)
      expect(outcome.sessionId).toBeTruthy()
    },
    90_000
  )
})
