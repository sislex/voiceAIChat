import type { FastifyInstance } from 'fastify'
import type { ImageStudioCore } from '@voicechat/image-studio'
import {
  createRpcDispatcher, RpcError, IMAGE_STUDIO_CORE_METHODS, INTERNAL_IMAGE_STUDIO_CORE_PATH,
  INTERNAL_IMAGE_STUDIO_GENERATE_PATH, IMAGE_STUDIO_RPC_BODY_LIMIT, isImageStudioGenerateRequest, type RpcRequest
} from '@voicechat/shared'

/** Регистрируется только в scope внутреннего API с проверкой VC_INTERNAL_TOKEN. */
export function registerImageStudioInternal(app: FastifyInstance, core: ImageStudioCore): void {
  const dispatch = createRpcDispatcher(core, IMAGE_STUDIO_CORE_METHODS)
  app.post<{ Body: RpcRequest }>(INTERNAL_IMAGE_STUDIO_CORE_PATH, async (req, reply) => {
    try { return { result: await dispatch(req.body ?? { method: '', args: [] }) } } catch (error) {
      return reply.code(error instanceof RpcError ? error.status : 500).send({ error: error instanceof Error ? error.message : String(error) })
    }
  })
  app.post(INTERNAL_IMAGE_STUDIO_GENERATE_PATH, { bodyLimit: IMAGE_STUDIO_RPC_BODY_LIMIT }, async (req, reply) => {
    const body = req.body
    if (!isImageStudioGenerateRequest(body)) return reply.code(400).send({ error: 'Некорректный запрос генерации' })
    let cancel = () => {}
    const disconnected = () => { if (!reply.raw.writableFinished) cancel() }
    reply.raw.on('close', disconnected)
    try {
      const data = await core.generate(body.userId, {
        prompt: body.prompt,
        ...(body.source ? { source: Buffer.from(body.source.dataBase64, 'base64'), sourceName: body.source.name } : {}),
        ...(body.mask ? { mask: Buffer.from(body.mask.dataBase64, 'base64') } : {}),
        ...(body.targetSize ? { targetSize: body.targetSize } : {}),
        ...(body.references ? { references: body.references.map((ref) => ({ name: ref.name, data: Buffer.from(ref.dataBase64, 'base64') })) } : {}),
        onCancel: (fn) => { cancel = fn; if (reply.raw.destroyed) fn() }
      })
      return reply.type('application/octet-stream').send(data)
    } catch (error) {
      return reply.code(502).send({ error: error instanceof Error ? error.message : String(error) })
    } finally { reply.raw.removeListener('close', disconnected) }
  })
}
