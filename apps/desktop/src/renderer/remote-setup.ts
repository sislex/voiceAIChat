// Окно ввода URL сервера. Сохранение перезагружает окно чата в нужном режиме.

const input = document.getElementById('url') as HTMLInputElement
const save = document.getElementById('save') as HTMLButtonElement
const local = document.getElementById('local') as HTMLButtonElement
const msg = document.getElementById('msg') as HTMLSpanElement

void window.remoteClient.getUrl().then((u) => {
  if (u) input.value = u
})

function normalize(raw: string): string | null {
  const s = raw.trim()
  if (!s) return null
  return /^https?:\/\//.test(s) ? s : `http://${s}`
}

save.addEventListener('click', () => {
  const url = normalize(input.value)
  if (!url) {
    msg.textContent = 'Укажите адрес сервера'
    return
  }
  void window.remoteClient.setUrl(url)
})
local.addEventListener('click', () => void window.remoteClient.setUrl(null))
input.addEventListener('keydown', (e) => e.key === 'Enter' && save.click())

export {}
