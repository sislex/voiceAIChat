import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import type { LlmRequest } from '@voicechat/shared'

export interface PreparedLlmRequest<T extends LlmRequest> {
  request: T
  cleanup(): void
}

function safeRunnerName(attachment: NonNullable<LlmRequest['attachments']>[number], index: number): string {
  const base = basename((attachment.runnerName || '').trim() || attachment.serverPath.trim())
  const name = !base || base === '.' || base === '..' ? `attachment-${index + 1}` : base
  return `${index + 1}-${name}`
}

function replacePromptPaths(prompt: string, pairs: Array<{ serverPath: string; runnerPath: string }>): string {
  return [...pairs]
    .sort((a, b) => b.serverPath.length - a.serverPath.length)
    .reduce((value, pair) => value.split(pair.serverPath).join(pair.runnerPath), prompt)
}

/** Materialize inline attachments for both embedded CLI clients and the HTTP runner. */
export function prepareLlmAttachments<T extends LlmRequest>(request: T): PreparedLlmRequest<T> {
  const attachments = request.attachments?.filter((attachment) => attachment.serverPath && attachment.dataBase64) ?? []
  if (!attachments.length) return { request, cleanup: () => {} }

  const directory = mkdtempSync(join(tmpdir(), 'voicechat-llm-run-'))
  let cleaned = false
  const cleanup = (): void => {
    if (cleaned) return
    cleaned = true
    rmSync(directory, { recursive: true, force: true })
  }
  try {
    const pairs = attachments.map((attachment, index) => {
      const runnerPath = join(directory, safeRunnerName(attachment, index))
      writeFileSync(runnerPath, Buffer.from(attachment.dataBase64, 'base64'))
      return { serverPath: attachment.serverPath, runnerPath, preserveServerPath: attachment.preserveServerPath === true }
    })
    const replaceable = pairs.filter((pair) => !pair.preserveServerPath)
    const preserved = pairs.filter((pair) => pair.preserveServerPath)
    const prompt = replacePromptPaths(request.prompt, replaceable)
    const visualCopies = preserved.length
      ? [
          '',
          '## Визуальные копии вложений',
          'Авторитетные пути ниже существуют на выбранной удалённой машине и должны передаваться remote-инструментам без изменений.',
          'Для непосредственного визуального анализа в этом LLM-ране доступны временные копии:',
          ...preserved.map((pair) => `- ${pair.serverPath} → ${pair.runnerPath}`)
        ].join('\n')
      : ''
    return { request: { ...request, prompt: `${prompt}${visualCopies}` }, cleanup }
  } catch (error) {
    cleanup()
    throw error
  }
}
