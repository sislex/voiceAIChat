import type { Conversation } from '@voicechat/shared'

export type ImageStudioConversation = Pick<Conversation, 'id' | 'title' | 'assistantKind'>

export interface ImageStudioGeneration {
  prompt: string
  source?: Buffer
  sourceName?: string
  references?: Array<{ name: string; data: Buffer }>
  onCancel?: (cancel: () => void) => void
}
export type ImageStudioGenerator = (input: ImageStudioGeneration) => Promise<Buffer>

/** Данные и исполнение принадлежат ядру; галереи и их метаданные — студии. */
export interface ImageStudioCore {
  conversation(userId: string, id: string): Promise<ImageStudioConversation | null>
  renameConversation(userId: string, id: string, title: string): Promise<void>
  readGenerated(userId: string, path: string): Promise<{ dataBase64: string } | null>
  generate(userId: string, input: ImageStudioGeneration): Promise<Buffer>
}
