const form = document.getElementById('form') as HTMLFormElement
const button = document.getElementById('add') as HTMLButtonElement
const status = document.getElementById('status') as HTMLDivElement
const field = (id: string): HTMLInputElement => document.getElementById(id) as HTMLInputElement

form.addEventListener('submit', (event) => {
  event.preventDefault()
  button.disabled = true
  status.className = 'status'
  status.textContent = 'Подключаем устройство…'
  void window.loginApplication.addCurrentDevice({
    serverUrl: field('server').value.trim(),
    name: field('name').value.trim(),
    password: field('password').value
  }).then((result) => {
    field('password').value = ''
    status.className = result.ok ? 'status success' : 'status error'
    status.textContent = result.ok ? 'Устройство добавлено. Приложение поддерживает подключение в фоне.' : (result.error ?? 'Не удалось подключить устройство')
    button.disabled = result.ok
  })
})
window.loginApplication.onStatus((value) => {
  status.className = value.startsWith('Подключено') ? 'status success' : 'status'
  status.textContent = value
})
export {}
