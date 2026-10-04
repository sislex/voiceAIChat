import type { TurnMeta, TurnRequestInfo } from './types'

function jsonBytes(value: unknown): number {
  return new TextEncoder().encode(JSON.stringify(value)).byteLength
}

function summarizeRequest(request: TurnRequestInfo): TurnRequestInfo {
  return {
    model: request.model,
    permissionMode: request.permissionMode,
    promptChars: request.promptChars,
    ...(request.kbContext ? { kbContext: request.kbContext } : {})
  } as unknown as TurnRequestInfo
}

/** Removes large per-message diagnostics while retaining fields needed by conversation summaries. */
export function stripServiceData(meta: TurnMeta): TurnMeta {
  if (meta.serviceData) return meta
  const { activity, request, ...rest } = meta
  if (!activity && !request) return meta
  return {
    ...rest,
    ...(request ? { request: summarizeRequest(request) } : {}),
    serviceData: {
      activityEntries: activity?.length ?? 0,
      activityBytes: activity ? jsonBytes(activity) : 0,
      requestBytes: request ? jsonBytes(request) : 0
    }
  }
}
