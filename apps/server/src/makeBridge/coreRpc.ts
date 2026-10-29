import { z } from 'zod'
import { createCoreRpcDispatcher, createTransferTaskSchema, projectPathSchema, standPreviewResultSchema, transferTaskResultSchema,
  makeStandResultSchema, makeStandOptionsSchema, validateMakeStandResult,
  RpcError, type MakeCore, type RpcRequest } from '@voicechat/make-contracts'
import { DEV_COMPONENT_IDS } from '@voicechat/shared'
import { extendedStandOperationSchema, type PreviewOperation } from './projectAdapters.js'

// Compatibility with make-contracts 1.4: preserve new result fields and accept live operations.
// Keep all other methods on the owner's schema-validated dispatcher.
const liveArgs = z.tuple([z.string().min(1), z.string().min(1), z.object({
  op: z.enum(['live_on', 'live_off']), subprojectPath: projectPathSchema,
  standId: z.string().min(1), component: z.enum(DEV_COMPONENT_IDS as [typeof DEV_COMPONENT_IDS[number], ...typeof DEV_COMPONENT_IDS])
}).strict()])
const transferArgs = z.tuple([z.string().min(1), createTransferTaskSchema])
const transferResult = transferTaskResultSchema.extend({
  branch: z.string().min(1).optional(), taskUrl: z.string().min(1).optional(),
  branchUrl: z.string().min(1).optional(), designUrl: z.string().min(1).optional()
})

const standResult = makeStandResultSchema.extend({
  components: z.array(z.object({ component: z.enum(['core', 'core-ui', 'make']), branch: z.string().nullable(), workingCopyPath: z.string().min(1), phase: makeStandResultSchema.shape.phase })).optional(),
  options: makeStandOptionsSchema.extend({
    stands: z.array(makeStandOptionsSchema.shape.stands.element.extend({
      conversationWorktree: z.object({ branch: z.string().min(1) }).optional()
    }))
  }).optional()
})

export function createMakeCoreDispatcher(core: MakeCore) {
  const dispatch = createCoreRpcDispatcher(core)
  return async (request: RpcRequest): Promise<unknown> => {
    try {
      if (request.method === 'standPreview' && Array.isArray(request.args)
        && ['live_on', 'live_off'].includes((request.args[2] as { op?: string })?.op ?? '')) {
        const parsed = liveArgs.safeParse(request.args)
        if (!parsed.success) throw new RpcError(400, 'Invalid project mode arguments')
        const preview = core.standPreview as (user: string, project: string, op: PreviewOperation) => Promise<unknown>
        return standPreviewResultSchema.parse(await preview.apply(core, parsed.data))
      }
      if (request.method === 'makeStand') {
        const parsed = z.tuple([z.string().min(1), z.string().min(1), extendedStandOperationSchema]).safeParse(request.args)
        if (!parsed.success) throw new RpcError(400, 'Invalid project mode arguments')
        const operation = parsed.data[2] as Parameters<MakeCore['makeStand']>[2]
        const result = standResult.parse(await core.makeStand(parsed.data[0], parsed.data[1], operation))
        try { validateMakeStandResult(operation, result) }
        catch { throw new RpcError(502, 'Mismatched Make stand result') }
        return result
      }
      if (request.method === 'createTransferTask') {
        const parsed = transferArgs.safeParse(request.args)
        if (!parsed.success) throw new RpcError(400, 'Invalid project mode arguments')
        return transferResult.parse(await core.createTransferTask(...parsed.data))
      }
      return await dispatch(request)
    } catch (error) {
      const status = (error as { statusCode?: number })?.statusCode
      if (typeof status === 'number' && status >= 400 && status <= 599)
        throw new RpcError(status, error instanceof Error ? error.message : 'project_mode_failed')
      throw error
    }
  }
}
