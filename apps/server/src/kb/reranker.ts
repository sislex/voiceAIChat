import type { LlmClient } from '../claude/types.js'
import type { KbRerankCandidate, KbSemanticReranker } from './types.js'

export class LlmKbReranker implements KbSemanticReranker {
  constructor(private readonly client: LlmClient, private readonly model = '') {}
  rerank(query: string, candidates: KbRerankCandidate[], limit: number): Promise<string[]> {
    const allowed = new Set(candidates.map((item) => item.chunkId))
    const prompt = [
      'Ты ранжируешь разделы базы знаний voiceAIChat. Не отвечай на вопрос и не вызывай инструменты.',
      `Запрос: ${query}`,
      `Выбери до ${limit} наиболее релевантных ID из кандидатов. Верни только JSON: {"selected":["id"]}.`,
      JSON.stringify(candidates)
    ].join('\n\n')
    return new Promise((resolve, reject) => {
      let text = ''
      const timer = setTimeout(() => { handle.cancel(); reject(new Error('KB reranking timeout')) }, 20_000)
      const handle = this.client.send({ prompt, sessionId: null, model: this.model, permissionMode: 'plan', executionDisabled: true }, {
        onSession: () => {}, onDelta: (delta) => { text += delta },
        onDone: (final) => { clearTimeout(timer); try { const raw = (final || text).trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, ''); const parsed = JSON.parse(raw) as { selected?: unknown }; const selected = Array.isArray(parsed.selected) ? parsed.selected.filter((id): id is string => typeof id === 'string' && allowed.has(id)).slice(0, limit) : []; resolve(selected) } catch (error) { reject(error) } },
        onError: (message) => { clearTimeout(timer); reject(new Error(message)) }
      })
    })
  }
}
