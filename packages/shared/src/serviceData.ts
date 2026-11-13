import type { TurnMeta } from './types'

function jsonBytes(value: unknown): number {
  return new TextEncoder().encode(JSON.stringify(value)).byteLength
}

/** Removes large per-message diagnostics while retaining fields needed by conversation summaries. */
export function stripServiceData(meta: TurnMeta): TurnMeta {
  const { activity, request, ...rest } = meta
  if (!activity && !request) return meta
  return {
    ...rest,
    ...(meta.model ?? request?.model ? { model: meta.model ?? request?.model } : {}),
    ...(meta.permissionMode ?? request?.permissionMode ? { permissionMode: meta.permissionMode ?? request?.permissionMode } : {}),
    serviceData: meta.serviceData ?? {
      activityEntries: activity?.length ?? 0,
      activityBytes: activity ? jsonBytes(activity) : 0,
      requestBytes: request ? jsonBytes(request) : 0
    }
  }
}
