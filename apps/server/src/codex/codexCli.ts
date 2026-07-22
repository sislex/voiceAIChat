// LLM-клиент через Codex CLI: spawn('codex', ['exec', '--json', ...]) + построчный
// разбор JSONL. Аналог ClaudeCli; spawn инжектируется для тестов. Паритет по
// пробросу команд на агентов достигается MCP-конфигом (streamable HTTP) + read-only
// sandbox (блокирует локальный shell) + инструкцией в промпте.

import { spawn as nodeSpawn, type ChildProcess } from 'node:child_process'
import { createInterface } from 'node:readline'
import { parseCodexLine, parseCodexActivity } from '@voicechat/shared'
import type { LlmClient, LlmHandle, LlmRequest, LlmStreamHandlers } from '../claude/types.js'

export type SpawnFn = (
  command: string,
  args: string[],
  options?: { cwd?: string }
) => ChildProcess

export interface CodexCliOptions {
  spawn?: SpawnFn
  /** Имя/путь бинаря. По умолчанию 'codex' (ищется в PATH). */
  binPath?: string
}

function describeSpawnError(err: unknown): string {
  const code = (err as { code?: string })?.code
  if (code === 'ENOENT') {
    return 'Codex CLI не найден. Установите Codex и выполните `codex login`.'
  }
  return `Не удалось запустить Codex CLI: ${err instanceof Error ? err.message : String(err)}`
}

function describeExit(code: number | null, stderr: string): string {
  const s = stderr.trim()
  if (/log ?in|not logged|authenticat|unauthor|credential/i.test(s)) {
    return 'Похоже, вход в Codex не выполнен. Выполните `codex login` в терминале.'
  }
  return `Codex CLI завершился с кодом ${code}${s ? `: ${s}` : ''}`
}

/** permissionMode → sandbox-флаги codex (для НЕ-remote выполнения). */
function sandboxArgs(permissionMode?: string): string[] {
  switch (permissionMode) {
    case 'plan':
      return ['--sandbox', 'read-only']
    case 'acceptEdits':
      return ['--sandbox', 'workspace-write']
    case 'bypassPermissions':
    default:
      return ['--dangerously-bypass-approvals-and-sandbox']
  }
}

export class CodexCli implements LlmClient {
  constructor(private readonly opts: CodexCliOptions = {}) {}

  send(req: LlmRequest, handlers: LlmStreamHandlers): LlmHandle {
    const spawnFn = this.opts.spawn ?? (nodeSpawn as unknown as SpawnFn)

    // Проброс команд на агента: MCP-инструмент вместо локального shell.
    let prompt = req.prompt
    const args = ['exec', '--json', '--skip-git-repo-check']
    if (req.model) args.push('-m', req.model)
    if (req.cwd) args.push('-C', req.cwd)

    if (req.remote) {
      // Проброс на агента через MCP-инструмент. bypass — иначе codex в exec-режиме
      // отменяет вызовы инструментов («user cancelled»); использовать именно remote
      // (а не локальный shell) codex обязывает инструкция в промпте ниже.
      args.push(
        '-c',
        `mcp_servers.remote.url="${req.remote.mcpUrl}"`,
        '--dangerously-bypass-approvals-and-sandbox'
      )
      prompt =
        `Локальный shell недоступен. Все команды выполняй ТОЛЬКО инструментом MCP-сервера ` +
        `«remote» (bash) — они выполняются на машине пользователя «${req.remote.agentName}».` +
        (req.remote.policySummary ? `\n${req.remote.policySummary}` : '') +
        `\n\n${prompt}`
    } else {
      args.push(...sandboxArgs(req.permissionMode))
    }

    // resume существующей сессии (thread_id). Prompt — последним позиционным аргументом.
    if (req.sessionId) args.push('resume', req.sessionId)
    args.push(prompt)

    let finished = false
    let stderr = ''
    let acc = '' // накопленный текст ответа (agent_message)
    let lastMeta: import('@voicechat/shared').TurnMeta | undefined

    const fail = (message: string): void => {
      if (finished) return
      finished = true
      handlers.onError(message)
    }
    const done = (text: string): void => {
      if (finished) return
      finished = true
      handlers.onDone(text, lastMeta)
    }

    let child: ChildProcess
    try {
      child = spawnFn(this.opts.binPath ?? 'codex', args, req.cwd ? { cwd: req.cwd } : undefined)
    } catch (err) {
      fail(describeSpawnError(err))
      return { cancel: () => {} }
    }

    // Закрываем stdin: промпт передан аргументом, иначе codex ждёт ввод из stdin
    // («Reading additional input from stdin…») и никогда не отвечает.
    try {
      child.stdin?.end()
    } catch {
      /* stdin недоступен */
    }

    child.on('error', (err) => fail(describeSpawnError(err)))
    child.stderr?.on('data', (d: Buffer) => {
      stderr += d.toString()
    })

    if (child.stdout) {
      const rl = createInterface({ input: child.stdout })
      rl.on('line', (line) => {
        if (handlers.onActivity) {
          const entry = parseCodexActivity(line)
          if (entry) handlers.onActivity(entry)
        }
        const ev = parseCodexLine(line)
        if (!ev) return
        switch (ev.kind) {
          case 'session':
            handlers.onSession(ev.sessionId)
            break
          case 'delta':
            acc += ev.text
            if (!finished) handlers.onDelta(ev.text)
            break
          case 'message':
            // Полное сообщение агента: показываем как дельту и копим для финала.
            acc += ev.text
            if (!finished) handlers.onDelta(ev.text)
            break
          case 'result':
            lastMeta = ev.meta
            if (ev.isError) fail('Codex вернул ошибку')
            else done(acc)
            break
          case 'error':
            fail(ev.message)
            break
          default:
            break
        }
      })
    }

    child.on('close', (code) => {
      if (finished) return
      if (code === 0) done(acc)
      else fail(describeExit(code, stderr))
    })

    return {
      cancel: () => {
        finished = true
        try {
          child.kill('SIGTERM')
        } catch {
          /* уже завершён */
        }
      }
    }
  }
}
