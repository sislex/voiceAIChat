import { describe, it, expect } from 'vitest'
import {
  parseCxLine,
  parseCxTranscript,
  cxMetaFromHead,
  cxSessionTitle,
  cxResumeMessages,
  cxResumeTitle
} from './codexSessions'

// Фикстуры по форме реальных строк rollout (~/.codex/sessions/**/rollout-*.jsonl).
const META = JSON.stringify({
  timestamp: '2026-07-22T16:57:52.505Z',
  type: 'session_meta',
  payload: {
    session_id: '019f8ac3-23fe-7c11-914e-43447a041b30',
    id: '019f8ac3-23fe-7c11-914e-43447a041b30',
    timestamp: '2026-07-22T16:57:52.406Z',
    cwd: '/Users/x/proj/apps/server'
  }
})
const line = (payload: unknown): string =>
  JSON.stringify({ timestamp: '2026-07-22T17:00:00.000Z', type: 'event_msg', payload })

describe('parseCxLine — события event_msg', () => {
  it('user_message → user', () => {
    const items = parseCxLine(line({ type: 'user_message', message: 'привет' }))
    expect(items).toEqual([{ kind: 'user', text: 'привет', ts: expect.any(Number) }])
  })

  it('agent_message final_answer → assistant; commentary → other', () => {
    expect(parseCxLine(line({ type: 'agent_message', message: 'ответ', phase: 'final_answer' }))[0])
      .toMatchObject({ kind: 'assistant', text: 'ответ' })
    expect(parseCxLine(line({ type: 'agent_message', message: 'сейчас гляну', phase: 'commentary' }))[0])
      .toMatchObject({ kind: 'other', text: 'сейчас гляну' })
  })

  it('agent_reasoning → thinking', () => {
    expect(parseCxLine(line({ type: 'agent_reasoning', text: 'рассуждаю' }))[0]).toMatchObject({
      kind: 'thinking',
      text: 'рассуждаю'
    })
  })

  it('exec_command_end → tool_use ($ команда) + tool_result (вывод, isError по коду)', () => {
    const ok = parseCxLine(
      line({ type: 'exec_command_end', command: ['/bin/zsh', '-lc', 'ls'], aggregated_output: 'a\nb', exit_code: 0 })
    )
    expect(ok).toEqual([
      { kind: 'tool_use', text: '$ ls', ts: expect.any(Number) },
      { kind: 'tool_result', text: 'a\nb', ts: expect.any(Number), isError: false }
    ])
    const fail = parseCxLine(
      line({ type: 'exec_command_end', command: ['/bin/zsh', '-lc', 'false'], aggregated_output: 'boom', exit_code: 1 })
    )
    expect(fail[1]).toMatchObject({ kind: 'tool_result', isError: true })
  })

  it('mcp_tool_call_end → tool_use (server.tool: args) + tool_result', () => {
    const items = parseCxLine(
      line({
        type: 'mcp_tool_call_end',
        invocation: { server: 'remote', tool: 'bash', arguments: { command: 'hostname' } },
        result: { Ok: { content: [{ type: 'text', text: 'host\n' }], isError: false } }
      })
    )
    expect(items[0]).toMatchObject({ kind: 'tool_use', text: 'remote.bash: hostname' })
    expect(items[1]).toMatchObject({ kind: 'tool_result', text: 'host', isError: false })
  })

  it('mcp ошибка (Err) → tool_result isError', () => {
    const items = parseCxLine(
      line({
        type: 'mcp_tool_call_end',
        invocation: { server: 'remote', tool: 'bash', arguments: { command: 'x' } },
        result: { Err: { content: [{ type: 'text', text: 'сбой' }] } }
      })
    )
    expect(items[1]).toMatchObject({ kind: 'tool_result', isError: true })
  })

  it('response_item message пропускается (не дублирует agent_message)', () => {
    const l = JSON.stringify({
      type: 'response_item',
      payload: { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'дубль' }] }
    })
    expect(parseCxLine(l)).toEqual([])
  })

  it('служебные события и мусор → []', () => {
    expect(parseCxLine(line({ type: 'token_count', info: {} }))).toEqual([])
    expect(parseCxLine(line({ type: 'task_started' }))).toEqual([])
    expect(parseCxLine('не json')).toEqual([])
    expect(parseCxLine('')).toEqual([])
  })
})

describe('cxMetaFromHead / cxSessionTitle', () => {
  it('извлекает cwd и id из session_meta', () => {
    expect(cxMetaFromHead(META)).toMatchObject({
      cwd: '/Users/x/proj/apps/server',
      id: '019f8ac3-23fe-7c11-914e-43447a041b30'
    })
  })

  it('заголовок — первая реплика пользователя', () => {
    const head = [META, line({ type: 'user_message', message: 'Посмотри проект' })].join('\n')
    expect(cxSessionTitle(head)).toBe('Посмотри проект')
  })

  it('нет реплики → «Без названия»', () => {
    expect(cxSessionTitle(META)).toBe('Без названия')
  })
})

describe('parseCxTranscript / resume-хелперы', () => {
  const transcript = [
    META,
    line({ type: 'user_message', message: 'вопрос' }),
    line({ type: 'agent_reasoning', text: 'думаю' }),
    line({ type: 'agent_message', message: 'комментарий', phase: 'commentary' }),
    line({ type: 'agent_message', message: 'финальный ответ', phase: 'final_answer' })
  ].join('\n')

  it('parseCxTranscript собирает записи по порядку', () => {
    const kinds = parseCxTranscript(transcript).map((i) => i.kind)
    expect(kinds).toEqual(['user', 'thinking', 'other', 'assistant'])
  })

  it('cxResumeMessages берёт только user + assistant (final)', () => {
    const msgs = cxResumeMessages(parseCxTranscript(transcript))
    expect(msgs).toEqual([
      { role: 'u1', text: 'вопрос', ts: expect.any(Number) },
      { role: 'ai', text: 'финальный ответ', ts: expect.any(Number) }
    ])
  })

  it('cxResumeTitle — первая реплика пользователя', () => {
    expect(cxResumeTitle(parseCxTranscript(transcript))).toBe('вопрос')
  })
})
