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
  if (options.conversationId !== options.activeConversationId) return { ok: false, error: `У пользователя открыт другой чат: панель Web Reader этого разговора не активна. Попроси его открыть #/web-reader/${options.conversationId} и повтори действие.` }
  const registration = options.registration
  if (!registration || registration.conversationId !== options.conversationId || registration.registrationId !== options.activeRegistrationId) {
    return { ok: false, error: options.readerRoute ? 'Панель Web Reader активного чата ещё подключается или переключена на полный браузер. Подожди секунду и повтори действие.' : `Чат открыт не в разделе Web Reader: панели нет. Попроси пользователя открыть #/web-reader/${options.conversationId} и повтори действие.` }
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
