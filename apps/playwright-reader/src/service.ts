import type { BrowserActionOutcome, PreviewAction } from '@voicechat/shared'

/** MCP остаётся общим входом браузерных инструментов; Chromium исполняется этим портом. */
export interface PlaywrightReaderService {
  execute(userId: string, conversationId: string, action: PreviewAction): Promise<BrowserActionOutcome | null>
  screenshot(userId: string, conversationId: string, args: { selector?: string }): Promise<BrowserActionOutcome | null>
}
