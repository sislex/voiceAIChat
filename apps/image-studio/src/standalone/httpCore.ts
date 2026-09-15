import {
  createRpcClient, RpcError, INTERNAL_IMAGE_STUDIO_CORE_PATH, INTERNAL_IMAGE_STUDIO_GENERATE_PATH,
  IMAGE_STUDIO_GENERATION_TIMEOUT_MS, type ImageStudioGenerateRequest
} from '@voicechat/shared'
import type { ImageStudioCore, ImageStudioConversation, ImageStudioGeneration } from '../core.js'

export class HttpImageStudioCore implements ImageStudioCore {
  private readonly rpc: ReturnType<typeof createRpcClient>
  constructor(private readonly opts: { coreUrl: string; token: string; fetchImpl?: typeof fetch }) {
    this.rpc = createRpcClient({ baseUrl: opts.coreUrl, token: opts.token, path: INTERNAL_IMAGE_STUDIO_CORE_PATH, fetchImpl: opts.fetchImpl })
  }
  conversation(userId: string, id: string) { return this.rpc<ImageStudioConversation | null>('conversation', userId, id) }
  async renameConversation(userId: string, id: string, title: string): Promise<void> { await this.rpc('renameConversation', userId, id, title) }
  readGenerated(userId: string, path: string) { return this.rpc<{ dataBase64: string } | null>('readGenerated', userId, path) }

  async generate(userId: string, input: ImageStudioGeneration): Promise<Buffer> {
    const controller = new AbortController()
    input.onCancel?.(() => controller.abort())
    const payload: ImageStudioGenerateRequest = {
      userId, prompt: input.prompt,
      ...(input.source ? { source: { name: input.sourceName ?? 'source.png', dataBase64: input.source.toString('base64') } } : {}),
      ...(input.mask ? { mask: { name: 'mask.png', dataBase64: input.mask.toString('base64') } } : {}),
      ...(input.targetSize ? { targetSize: input.targetSize } : {}),
      ...(input.references ? { references: input.references.map((ref) => ({ name: ref.name, dataBase64: ref.data.toString('base64') })) } : {})
    }
    const res = await (this.opts.fetchImpl ?? fetch)(`${this.opts.coreUrl.replace(/\/+$/, '')}${INTERNAL_IMAGE_STUDIO_GENERATE_PATH}`, {
      method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${this.opts.token}` },
      body: JSON.stringify(payload),
      // Обрыв этого соединения отменяет LLM у ядра, включая перезапуск процесса студии.
      signal: AbortSignal.any([controller.signal, AbortSignal.timeout(IMAGE_STUDIO_GENERATION_TIMEOUT_MS)])
    })
    if (!res.ok) {
      const body = await res.json().catch(() => ({})) as { error?: string }
      throw new RpcError(res.status, body.error ?? `Генерация: HTTP ${res.status}`)
    }
    return Buffer.from(await res.arrayBuffer())
  }
}
