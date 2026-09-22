import type { LlmClient, LoginStatusMap } from '@voicechat/shared'
export const RUNNER_NOT_CONFIGURED = 'Исполнитель LLM не настроен. Укажите адрес и токен отдельного LLM Runner.'
export function unconfiguredLoginStatus(): LoginStatusMap {
 return {
  claude: { provider: 'claude', loggedIn: false, detail: RUNNER_NOT_CONFIGURED },
  codex: { provider: 'codex', loggedIn: false, detail: RUNNER_NOT_CONFIGURED }
 }
}
/** Non-LLM parts can boot independently; model execution requires an explicit service. */
export function unconfiguredLlmClient(): LlmClient {
 return { send(_request, handlers) {
  let cancelled = false
  queueMicrotask(() => { if (!cancelled) handlers.onError(RUNNER_NOT_CONFIGURED) })
  return { cancel() { cancelled = true } }
 } }
}
