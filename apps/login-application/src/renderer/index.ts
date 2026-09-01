const form = document.querySelector('form')!
const button = document.querySelector<HTMLButtonElement>('button')!
const message = document.querySelector<HTMLElement>('#message')!
const field = (name: string): HTMLInputElement => document.querySelector<HTMLInputElement>(`[name="${name}"]`)!

function show(text: string, error = false): void {
  message.textContent = text
  message.className = error ? 'error' : ''
}
void window.voicechatLogin.configured().then((configured) => {
  if (configured) show('Этот Mac уже подключён. Существующая настройка защищена от перезаписи.')
})
form.addEventListener('submit', (event) => {
  event.preventDefault()
  button.disabled = true
  show('Подключаем текущий Mac…')
  void window.voicechatLogin.addCurrentDevice({
    serverUrl: field('serverUrl').value,
    login: field('login').value,
    password: field('password').value
  }).catch((error) => {
    show(error instanceof Error ? error.message : String(error), true)
    button.disabled = false
  }).finally(() => { field('password').value = '' })
})
window.voicechatLogin.onStatus((status) => show(`Статус машины: ${status}`))
window.voicechatLogin.onComplete((name) => { show(`Mac «${name}» подключён. Можно вернуться в ChatAI.`); button.disabled = true })
window.voicechatLogin.onError((error) => { show(error, true); button.disabled = false })
export {}
