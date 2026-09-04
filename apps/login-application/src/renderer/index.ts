const form = document.querySelector<HTMLFormElement>('form')!
const button = document.querySelector<HTMLButtonElement>('form button')!
const message = document.querySelector<HTMLElement>('#message')!
const field = (name: string): HTMLInputElement | HTMLSelectElement =>
  document.querySelector<HTMLInputElement | HTMLSelectElement>(`[name="${name}"]`)!

let busy = false
let completed = false

function show(text: string, error = false): void {
  message.textContent = text
  message.className = error ? 'error' : ''
  message.setAttribute('role', error ? 'alert' : 'status')
}

export function canSubmit(serverUrl: string, login: string, password: string): boolean {
  return Boolean(serverUrl && login.trim() && password)
}

const updateValidity = (): void => {
  const disabled = busy || completed || !canSubmit(field('serverUrl').value, field('login').value, field('password').value)
  button.disabled = disabled
  button.setAttribute('aria-disabled', String(disabled))
}

void window.voicechatLogin.configured().then((configured) => {
  if (configured) show('Этот Mac уже подключён. Существующая настройка защищена от перезаписи.')
})

form.addEventListener('input', updateValidity)
form.addEventListener('change', updateValidity)
updateValidity()

form.addEventListener('submit', (event) => {
  event.preventDefault()
  if (busy || completed || !canSubmit(field('serverUrl').value, field('login').value, field('password').value)) return
  busy = true
  updateValidity()
  show('Подключаем текущий Mac…')
  void window.voicechatLogin.addCurrentDevice({
    serverUrl: field('serverUrl').value,
    login: field('login').value.trim(),
    password: field('password').value
  }).then((result) => {
    if (!result.ok) show('Существующее подключение сохранено.')
  }).catch((error) => {
    show(error instanceof Error ? error.message : String(error), true)
  }).finally(() => {
    field('password').value = ''
    busy = false
    updateValidity()
  })
})

window.voicechatLogin.onStatus((status) => show(`Статус машины: ${status}`))
window.voicechatLogin.onComplete((name) => {
  completed = true
  busy = false
  field('password').value = ''
  show(`Mac «${name}» подключён. Можно вернуться в ChatAI.`)
  updateValidity()
})
window.voicechatLogin.onError((error) => {
  busy = false
  field('password').value = ''
  show(error, true)
  updateValidity()
})
