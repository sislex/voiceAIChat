// LLM-клиент через Codex CLI: spawn('codex', ['exec', '--json', ...]); разбор JSONL —
// в общем приёмнике (llm/sinks.ts). Аналог ClaudeCli; spawn инжектируется для тестов. Паритет по
// пробросу команд на агентов достигается MCP-конфигом (streamable HTTP). В режиме
// плана MCP не подключается, а локальный процесс жёстко ограничен read-only sandbox.

import { spawn as nodeSpawn, type ChildProcess } from 'node:child_process'
import { createInterface } from 'node:readline'
import type { LlmClient, LlmHandle, LlmRequest, LlmStreamHandlers } from '../claude/types.js'
import { cliProfileEnv } from '../users/cliProfiles.js'
import { killCliChild } from '../claude/childKill.js'
import { kbToolHint } from '../kb/kbMcp.js'
import { createCodexSink } from '../llm/sinks.js'

export type SpawnFn = (
  command: string,
  args: string[],
  options?: { cwd?: string; env?: NodeJS.ProcessEnv }
) => ChildProcess

export interface CodexCliOptions {
  spawn?: SpawnFn
  /** Имя/путь бинаря. По умолчанию 'codex' (ищется в PATH). */
  binPath?: string
  /** Возвращает изолированный HOME владельца запроса. */
  profileHome?: (userId: string) => string
}

function describeSpawnError(err: unknown): string {
  const code = (err as { code?: string })?.code
  if (code === 'ENOENT') {
    return 'Codex CLI не найден. Установите Codex и выполните `codex login`.'
  }
  return `Не удалось запустить Codex CLI: ${err instanceof Error ? err.message : String(err)}`
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

    if (req.executionDisabled) {
      prompt =
        `Для этого сообщения машина не выбрана. Не выполняй shell-команды и не запускай команды никаким способом.\n\n${prompt}`
    }

    // База знаний подключается ДО ветвления plan/remote: она read-only, глушить
    // её в режиме «План» незачем — наоборот, там она главный источник контекста.
    if (req.kbMcpUrl) {
      args.push('-c', `mcp_servers.kb.url="${req.kbMcpUrl}"`)
      prompt = `${kbToolHint(req.kbMode ?? 'auto')}\n\n${prompt}`
    }

    if (req.remote && req.permissionMode !== 'plan') {
      // В режиме разработки пробрасываем команды на агента через MCP. Для remote
      // нужен bypass: иначе codex exec отменяет вызовы инструментов как user cancelled.
      args.push(
        '-c',
        `mcp_servers.remote.url="${req.remote.mcpUrl}"`,
        '--dangerously-bypass-approvals-and-sandbox'
      )
      prompt =
        `Локальный shell недоступен. Все команды выполняй ТОЛЬКО инструментом MCP-сервера ` +
        `«remote» (bash) — они выполняются на машине пользователя «${req.remote.agentName}». ` +
        `У инструмента есть аргумент timeout_ms (по умолчанию 120000, максимум 300000) — для ` +
        `долгих команд (тесты, сборка, установка зависимостей) передавай его явно.` +
        (req.readOnlyRemote
          ? `\nРежим «План»: только исследование — читай файлы и историю (ls, cat, grep, ` +
            `git log/diff/status). Ничего не меняй: мост отклонит изменяющие команды.`
          : '') +
        (req.remote.policySummary ? `\n${req.remote.policySummary}` : '') +
        `\n\n${prompt}`
    } else {
      // План — жёстко read-only. Особенно важно не подключать remote MCP: его bash
      // выполняется вне локального sandbox и раньше позволял Codex менять файлы.
      args.push(...sandboxArgs(req.permissionMode))
      if (req.remote && req.permissionMode === 'plan') {
        prompt =
          `Режим «План»: только исследуй и составляй план. Не изменяй файлы и не выполняй ` +
          `команды на машине пользователя. Удалённые инструменты намеренно недоступны.\n\n${prompt}`
      }
    }

    // Prompt всегда читается из stdin (`-`), а не передаётся argv: полный контекст
    // Claude Code со схемами tools легко превышает системный ARG_MAX (spawn E2BIG).
    if (req.sessionId) args.push('resume', req.sessionId)
    args.push('-')

    // Разбор JSONL, usage и тексты ошибок — общий приёмник (llm/sinks.ts): он же
    // обслуживает RemoteLlmClient, поэтому события хода не зависят от транспорта.
    const sink = createCodexSink(handlers)

    let child: ChildProcess
    try {
      const home = req.userId ? this.opts.profileHome?.(req.userId) : undefined
      const spawnOptions =
        req.cwd || home
          ? { ...(req.cwd ? { cwd: req.cwd } : {}), ...(home ? { env: cliProfileEnv(home) } : {}) }
          : undefined
      child = spawnFn(this.opts.binPath ?? 'codex', args, spawnOptions)
    } catch (err) {
      sink.fail(describeSpawnError(err))
      return { cancel: () => {} }
    }

    // Передаём потенциально многомегабайтный prompt через pipe без лимита argv.
    try {
      child.stdin?.end(prompt)
    } catch {
      /* stdin недоступен */
    }

    child.on('error', (err) => sink.fail(describeSpawnError(err)))
    child.stderr?.on('data', (d: Buffer) => {
      sink.stderrChunk(d.toString())
    })

    if (child.stdout) {
      const rl = createInterface({ input: child.stdout })
      rl.on('line', (line) => sink.line(line))
    }

    child.on('close', (code) => sink.exit(code))

    return {
      cancel: () => {
        sink.detach()
        // SIGTERM, через 5с — SIGKILL: зависший CLI не должен переживать отмену.
        killCliChild(child)
      }
    }
  }
}
