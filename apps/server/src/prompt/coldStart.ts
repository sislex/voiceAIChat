import { buildConversationPromptWithin, type PromptMessage } from '@voicechat/shared'

/** Shared by turn execution and the context inspector, including retry cold starts. */
export function coldStartPrompt(messages: PromptMessage[], attachmentPaths: string[] = [], summary?: string): string {
  // An answer stopped before its first text is stored empty for its note; it is not a reply.
  return buildConversationPromptWithin(messages.filter(message => message.text.trim() !== ''), Number(process.env.VC_COLD_START_PROMPT_CHARS), { attachmentPaths, summary })
}
