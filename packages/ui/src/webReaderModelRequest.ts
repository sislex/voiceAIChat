import type { PreviewAction } from '@shared/previewActions'
import type { PreviewActionOutcome, ReaderHostRegistration } from '@voicechat/web-reader-app'

/** ID ответа принадлежит регистрации, начавшей команду, даже если вкладка уже сменилась. */
export async function runReaderModelRequest(options: {
  conversationId: string
  activeConversationId: string | null
  registration: ReaderHostRegistration | null
  activeRegistrationId: string | null
  readerRoute: boolean
  action: PreviewAction
}): Promise<PreviewActionOutcome & { registrationId?: string }> {
  if (options.conversationId !== options.activeConversationId) return { ok: false, error: 'Этот чат сейчас не открыт на странице Reader — панель превью недоступна.' }
  const registration = options.registration
  if (!registration || registration.conversationId !== options.conversationId || registration.registrationId !== options.activeRegistrationId) {
    return { ok: false, error: options.readerRoute ? 'Панель превью активного чата не открыта или ещё не подключена.' : 'Этот чат сейчас не открыт на странице Reader — панель превью недоступна.' }
  }
  try { return { ...await registration.run(options.action), registrationId: registration.registrationId } }
  catch { return { ok: false, registrationId: registration.registrationId, error: 'Не удалось выполнить действие в Reader. Повтори команду.' } }
}

/** Неудачная или устаревшая диагностика не стирает известную ошибку новой страницы. */
export async function readReaderErrors(registration: ReaderHostRegistration | null, isCurrent: () => boolean): Promise<string | null | undefined> {
  if (!registration) return undefined
  try {
    const outcome = await registration.run({ kind: 'errors' })
    if (!outcome.ok || !isCurrent()) return undefined
    const result = outcome.result as { errors?: unknown } | undefined
    if (!Array.isArray(result?.errors)) return undefined
    const first = result.errors[0] as { message?: unknown; text?: unknown } | null | undefined
    return typeof first?.message === 'string' ? first.message : typeof first?.text === 'string' ? first.text : null
  } catch { return undefined }
}
