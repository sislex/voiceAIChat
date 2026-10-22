import { buildConversationPromptWithin, type PromptMessage } from '@voicechat/shared'

/** Shared by turn execution and the context inspector, including retry cold starts. */
export function coldStartPrompt(messages: PromptMessage[], attachmentPaths: string[] = [], summary?: string): string {
  return buildConversationPromptWithin(messages, Number(process.env.VC_COLD_START_PROMPT_CHARS), { attachmentPaths, summary })
}
