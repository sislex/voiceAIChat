import { MakeHub, type MakeService } from '@voicechat/make-contracts'
import type { ImageStudioService } from '@sislexa/image-studio/image-studio/index'
import type { PlaywrightReaderService } from '@voicechat/playwright-reader-contracts'

/** Empty read adapters keep unrelated Core consumers usable without starting an owner module. */
export function disabledMake(): { service: MakeService; hub: MakeHub } {
  return { hub: new MakeHub(), service: {
    promptContext: async () => '', turnSnapshot: () => undefined, listFiles: async () => [],
    taskSources: () => [], metrics: async () => '', subscribe: () => () => {},
    sweep: async () => ({ projects: 0, snapshots: 0, shots: 0 }),
    adminStats: async () => ({ projects: 0, bytes: 0, filesBytes: 0, snapshotsBytes: 0, shotsBytes: 0,
      published: 0, shared: 0, views: 0, limitBytes: 0, userLimitBytes: 0, byUser: [], top: [] }),
  } }
}
export const disabledImageStudio: ImageStudioService = {
  promptContext: async () => '', captureImages: async () => {},
}
const unavailable = async (): Promise<never> => { throw Object.assign(new Error('application_disabled'), { statusCode: 404 }) }
export const disabledPlaywrightReader: PlaywrightReaderService = {
  control: unavailable, execute: unavailable, screenshot: unavailable,
}
