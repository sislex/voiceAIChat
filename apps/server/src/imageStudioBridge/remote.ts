import type { ImageStudioService } from '@sislexa/image-studio/image-studio/index'
import { createRpcClient } from '@voicechat/shared'
import { INTERNAL_IMAGE_STUDIO_SERVICE_PATH, IMAGE_STUDIO_GENERATION_TIMEOUT_MS } from '@voicechat/image-studio-contracts/imageStudioInternal'

export function createRemoteImageStudio(opts: { studioUrl: string; token: string; fetchImpl?: typeof fetch }): ImageStudioService {
  const rpc = createRpcClient({ baseUrl: opts.studioUrl, token: opts.token, path: INTERNAL_IMAGE_STUDIO_SERVICE_PATH,
    fetchImpl: opts.fetchImpl, timeoutMs: IMAGE_STUDIO_GENERATION_TIMEOUT_MS })
  return {
    promptContext: (conversationId) => rpc<string>('promptContext', conversationId),
    captureImages: async (userId, conversationId, finalText) => { await rpc('captureImages', userId, conversationId, finalText) }
  }
}
