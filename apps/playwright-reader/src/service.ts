import type { BrowserActionOutcome, BrowserControlCommand, BrowserModelScreenshotOptions, PreviewAction } from '@voicechat/shared'

/** MCP остаётся общим входом браузерных инструментов; Chromium исполняется этим портом. */
export interface PlaywrightReaderService {
  control(userId: string, conversationId: string, command: BrowserControlCommand): Promise<BrowserActionOutcome | null>
  execute(userId: string, conversationId: string, action: PreviewAction): Promise<BrowserActionOutcome | null>
  screenshot(userId: string, conversationId: string, args: BrowserModelScreenshotOptions): Promise<BrowserActionOutcome | null>
}
