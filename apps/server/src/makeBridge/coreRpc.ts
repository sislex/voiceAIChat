import { z } from 'zod'
import { createCoreRpcDispatcher, createTransferTaskSchema, projectPathSchema, standPreviewResultSchema, transferTaskResultSchema,
  makeStandResultSchema, makeStandOptionsSchema, validateMakeStandResult,
  RpcError, makeStandWindowSchema, type MakeCore, type RpcRequest } from '@voicechat/make-contracts'
import { DEV_COMPONENT_IDS } from '@voicechat/shared'
import { compareOperationSchema, compareResultSchema, extendedStandOperationSchema, localComponentSchema, type PreviewOperation } from './projectAdapters.js'
import { userStandArgsSchema, userStandResultSchema, type UserStandOperation, type UserStandResult } from './userStand.js'

// Compatibility with make-contracts 1.4: preserve new result fields and accept live operations.
// Keep all other methods on the owner's schema-validated dispatcher.
const liveArgs = z.tuple([z.string().min(1), z.string().min(1), z.object({
  op: z.enum(['live_on', 'live_off']), subprojectPath: projectPathSchema,
  standId: z.string().min(1), component: z.enum(DEV_COMPONENT_IDS as [typeof DEV_COMPONENT_IDS[number], ...typeof DEV_COMPONENT_IDS])
}).strict()])
const transferArgs = z.tuple([z.string().min(1), createTransferTaskSchema])
const standWindowArgs = z.tuple([
  z.string().min(1), z.string().min(1), z.string().min(1), z.string().url(), makeStandWindowSchema.nullable().optional()
])
const transferResult = transferTaskResultSchema.extend({
  branch: z.string().min(1).optional(), taskUrl: z.string().min(1).optional(),
  branchUrl: z.string().min(1).optional(), designUrl: z.string().min(1).optional()
})

const standResult = makeStandResultSchema.extend({
  availableComponents: z.array(localComponentSchema).optional(),
  git: z.union([makeStandResultSchema.shape.git.unwrap(), compareResultSchema]).optional(),
  components: z.array(z.object({ component: localComponentSchema, branch: z.string().nullable(), workingCopyPath: z.string().min(1), phase: makeStandResultSchema.shape.phase })).optional(),
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
      if (request.method === 'projectGit' && Array.isArray(request.args) && (request.args[2] as { op?: string })?.op === 'compare') {
        const parsed = z.tuple([z.string().min(1), z.string().min(1), compareOperationSchema]).safeParse(request.args)
        if (!parsed.success) throw new RpcError(400, 'Invalid project mode arguments')
        return compareResultSchema.parse(await core.projectGit(parsed.data[0], parsed.data[1], parsed.data[2] as unknown as Parameters<MakeCore['projectGit']>[2]))
      }
      if (request.method === 'makeStand') {
        const parsed = z.tuple([z.string().min(1), z.string().min(1), extendedStandOperationSchema]).safeParse(request.args)
        if (!parsed.success) throw new RpcError(400, 'Invalid project mode arguments')
        const operation = parsed.data[2] as Parameters<MakeCore['makeStand']>[2]
        const result = standResult.parse(await core.makeStand(parsed.data[0], parsed.data[1], operation))
        // The owner validator compares operation discriminators, including the new compare value.
        try { validateMakeStandResult(operation, result as z.infer<typeof makeStandResultSchema>) }
        catch { throw new RpcError(502, 'Mismatched Make stand result') }
        return result
      }
      // make-contracts 1.8.15 does not list `userStand` yet; validate it locally until Core pins 1.8.16.
      if (request.method === 'userStand') {
        const parsed = userStandArgsSchema.safeParse(request.args)
        if (!parsed.success) throw new RpcError(400, 'Invalid project mode arguments')
        const fn = (core as MakeCore & { userStand?: (user: string, op: UserStandOperation) => Promise<UserStandResult> }).userStand
        if (typeof fn !== 'function') throw new RpcError(409, 'Project mode is unavailable on this Core')
        return userStandResultSchema.parse(await fn.call(core, parsed.data[0], parsed.data[1] as UserStandOperation))
      }
      if (request.method === 'openStandWindow') {
        const parsed = standWindowArgs.safeParse(request.args)
        if (!parsed.success) throw new RpcError(400, 'Invalid stand window arguments')
        const fn = (core as MakeCore & { openStandWindow?: (...args: z.infer<typeof standWindowArgs>) => Promise<unknown> }).openStandWindow
        if (typeof fn !== 'function') throw new RpcError(503, 'stand_window_unavailable')
        return makeStandWindowSchema.parse(await fn.call(core, ...parsed.data))
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
