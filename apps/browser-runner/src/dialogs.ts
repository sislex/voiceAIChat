import { randomUUID } from 'node:crypto'
import type { Dialog, Page, Frame } from 'playwright'

import {
  BROWSER_DIALOG_DEFAULT_LIMIT,
  BROWSER_DIALOG_MESSAGE_LIMIT,
  normalizeBrowserDialogAnswer,
  type BrowserDialogAnswer,
  type BrowserDialogInfo
} from '@voicechat/shared'

interface PendingDialog {
  page: Page
  dialog: Dialog
  info: BrowserDialogInfo
  answering?: boolean
}
const required = (info: BrowserDialogInfo) =>
  new Error(
    `Открыт диалог ${info.type} (id: ${info.id}): ${info.message}. Ответь через handle-dialog или панель; действие ожидает ответа.`
  )

/** Обработчик хранит диалог, не выбирая ответ за модель/человека. */
export class BrowserDialogs {
  private readonly entries = new Map<string, PendingDialog>()
  private readonly byPage = new WeakMap<Page, PendingDialog>()
  private readonly listeners = new Set<(entry: PendingDialog) => void>()
  private readonly titles = new WeakMap<Page | Frame, string>()
  private readonly titleRequests = new WeakMap<Page | Frame, Promise<string>>()
  register(page: Page, tabId: string): void {
    page.on('dialog', (dialog) => {
      const previous = this.byPage.get(page)
      if (previous) this.remove(previous)
      const message = dialog.message(),
        defaultValue = dialog.defaultValue()
      const info: BrowserDialogInfo = {
        id: randomUUID(),
        tabId,
        type: dialog.type() as BrowserDialogInfo['type'],
        message: message.slice(0, BROWSER_DIALOG_MESSAGE_LIMIT),
        defaultValue: defaultValue.slice(0, BROWSER_DIALOG_DEFAULT_LIMIT),
        openedAt: Date.now(),
        ...(message.length > BROWSER_DIALOG_MESSAGE_LIMIT ? { messageTruncated: true } : {}),
        ...(defaultValue.length > BROWSER_DIALOG_DEFAULT_LIMIT ? { defaultValueTruncated: true } : {})
      }
      const entry = { page, dialog, info }
      this.entries.set(info.id, entry)
      this.byPage.set(page, entry)
      for (const listener of this.listeners) listener(entry)
    })
    page.on('close', () => {
      const entry = this.byPage.get(page)
      if (entry) this.remove(entry)
    })
  }
  private remove(entry: PendingDialog): void {
    if (this.entries.get(entry.info.id) === entry) this.entries.delete(entry.info.id)
    if (this.byPage.get(entry.page) === entry) this.byPage.delete(entry.page)
  }
  list(tabId?: string): BrowserDialogInfo[] {
    return [...this.entries.values()].filter((e) => !tabId || e.info.tabId === tabId).map((e) => ({ ...e.info }))
  }
  forPage(page: Page): BrowserDialogInfo | undefined {
    return this.byPage.get(page)?.info
  }
  async title(page: Page, source: Page | Frame = page): Promise<string> {
    if (this.byPage.has(page)) return this.titles.get(source) ?? ''
    let pending = this.titleRequests.get(source)
    if (!pending) {
      pending = this.run(page, () => source.title())
        .then(title => { this.titles.set(source, title); return title })
        .catch(() => this.titles.get(source) ?? '')
        .finally(() => { if (this.titleRequests.get(source) === pending) this.titleRequests.delete(source) })
      this.titleRequests.set(source, pending)
    }
    // Один зависший renderer не должен скрывать вкладки, диалоги и управление.
    // Повторный status разделяет прежний запрос, не накапливает новые title RPC.
    let timer: ReturnType<typeof setTimeout> | undefined
    try { return await Promise.race([pending, new Promise<string>(resolve => { timer = setTimeout(() => resolve(this.titles.get(source) ?? ''), 200) })]) }
    finally { if (timer) clearTimeout(timer) }
  }
  async handle(answer: BrowserDialogAnswer): Promise<void> {
    const { dialogId, accept, promptText } = normalizeBrowserDialogAnswer(answer)
    const entry = this.entries.get(dialogId)
    if (!entry) throw new Error('stale_dialog')
    if (entry.answering) throw new Error('Ответ на этот диалог уже выполняется')
    if (promptText !== undefined && entry.info.type !== 'prompt')
      throw new Error('promptText доступен только для prompt')
    entry.answering = true
    try {
      // Оригинальное значение остаётся у Dialog, даже если показано только начало.
      if (accept)
        await entry.dialog.accept(
          entry.info.type === 'prompt' ? (promptText ?? entry.dialog.defaultValue()) : undefined
        )
      else await entry.dialog.dismiss()
      this.remove(entry)
    } finally {
      entry.answering = false
    }
  }
  async run<T>(page: Page | undefined, operation: () => Promise<T>, ignoreExisting = false): Promise<T> {
    const existing = page && this.byPage.get(page)
    if (existing && !ignoreExisting) throw required(existing.info)
    let rejectDialog!: (error: Error) => void
    const opened = new Promise<never>((_, reject) => {
      rejectDialog = reject
    })
    const listener = (entry: PendingDialog) => {
      if (!page || entry.page === page) rejectDialog(required(entry.info))
    }
    this.listeners.add(listener)
    const pending = Promise.resolve().then(operation)
    // Нативный click/goto продолжится после ответа на диалог. Его поздний отказ
    // не должен стать unhandled rejection после раннего ответа инструменту.
    void pending.catch(() => undefined)
    try {
      return await Promise.race([pending, opened])
    } finally {
      this.listeners.delete(listener)
    }
  }
}
