/** Диалог блокирует JavaScript страницы до явного ответа человека или модели. */
export type BrowserDialogType = 'alert' | 'confirm' | 'prompt' | 'beforeunload'
export const BROWSER_DIALOG_MESSAGE_LIMIT = 4000
export const BROWSER_DIALOG_DEFAULT_LIMIT = 2000
export const BROWSER_DIALOG_ANSWER_LIMIT = 20000

export interface BrowserDialogInfo {
  id: string
  tabId: string
  type: BrowserDialogType
  message: string
  defaultValue: string
  openedAt: number
  messageTruncated?: boolean
  defaultValueTruncated?: boolean
}

export interface BrowserDialogAnswer {
  dialogId: string
  accept: boolean
  /** Пропущено — оставить исходное значение prompt; пустая строка — очистить. */
  promptText?: string
}

export interface BrowserDialogListResult {
  ok: true
  dialogs: BrowserDialogInfo[]
  total: number
  truncated?: boolean
}

export function normalizeBrowserDialogAnswer(value: BrowserDialogAnswer): BrowserDialogAnswer {
  if (
    !value ||
    typeof value.dialogId !== 'string' ||
    !value.dialogId.trim() ||
    value.dialogId.length > 200 ||
    typeof value.accept !== 'boolean'
  )
    throw new Error('Нужны dialogId и явный accept')
  if (
    value.promptText !== undefined &&
    (!value.accept || typeof value.promptText !== 'string' || value.promptText.length > BROWSER_DIALOG_ANSWER_LIMIT)
  )
    throw new Error('promptText допустим только при принятии диалога, до 20000 символов')
  return {
    dialogId: value.dialogId,
    accept: value.accept,
    ...(value.promptText !== undefined ? { promptText: value.promptText } : {})
  }
}

/** Список вписывается в ответ MCP; активный диалог панели идёт первым. */
export function boundedBrowserDialogs(dialogs: BrowserDialogInfo[], activeTabId?: string): BrowserDialogListResult {
  const ordered = activeTabId
    ? [
        ...dialogs.filter((dialog) => dialog.tabId === activeTabId),
        ...dialogs.filter((dialog) => dialog.tabId !== activeTabId)
      ]
    : dialogs
  const included: BrowserDialogInfo[] = []
  let size = 100
  for (const original of ordered) {
    const dialog = {
      ...original,
      message: original.message.slice(0, BROWSER_DIALOG_MESSAGE_LIMIT),
      defaultValue: original.defaultValue.slice(0, BROWSER_DIALOG_DEFAULT_LIMIT),
      ...(original.message.length > BROWSER_DIALOG_MESSAGE_LIMIT ? { messageTruncated: true } : {}),
      ...(original.defaultValue.length > BROWSER_DIALOG_DEFAULT_LIMIT ? { defaultValueTruncated: true } : {})
    }

    // Управляющие символы могут занять шесть знаков в JSON: лимит текста сам
    // по себе не гарантирует, что активный диалог поместится в ответ модели.
    while (JSON.stringify(dialog).length > 14000 && (dialog.message.length || dialog.defaultValue.length)) {
      if (JSON.stringify(dialog.message).length >= JSON.stringify(dialog.defaultValue).length) {
        dialog.message = dialog.message.slice(0, Math.floor(dialog.message.length / 2)); dialog.messageTruncated = true
      } else {
        dialog.defaultValue = dialog.defaultValue.slice(0, Math.floor(dialog.defaultValue.length / 2)); dialog.defaultValueTruncated = true
      }
    }
    const length = JSON.stringify(dialog).length + 1
    if (size + length > 16000) break
    included.push(dialog)
    size += length
  }
  return {
    ok: true,
    dialogs: included,
    total: dialogs.length,
    ...(included.length < dialogs.length ? { truncated: true } : {})
  }
}

export function isBrowserDialogListResult(value: unknown): value is BrowserDialogListResult {
  if (!value || typeof value !== 'object') return false
  const result = value as Record<string, unknown>
  return (
    result.ok === true &&
    Array.isArray(result.dialogs) &&
    Number.isSafeInteger(result.total) &&
    (result.total as number) >= result.dialogs.length &&
    result.dialogs.every(
      (dialog) =>
        dialog &&
        typeof dialog === 'object' &&
        typeof dialog.id === 'string' &&
        typeof dialog.tabId === 'string' &&
        ['alert', 'confirm', 'prompt', 'beforeunload'].includes(dialog.type) &&
        typeof dialog.message === 'string' &&
        typeof dialog.defaultValue === 'string' &&
        Number.isFinite(dialog.openedAt)
    )
  )
}
