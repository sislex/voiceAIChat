// Окно настройки: приём строки подключения и передача в main.

const conn = document.getElementById('conn') as HTMLTextAreaElement
const save = document.getElementById('save') as HTMLButtonElement
const msg = document.getElementById('msg') as HTMLSpanElement

async function submit(): Promise<void> {
  const str = conn.value.trim()
  if (!str) return
  save.disabled = true
  msg.textContent = ''
  const res = await window.agent.submitConnection(str)
  if (res.ok) {
    msg.className = 'ok'
    msg.textContent = '✓ подключаюсь…'
  } else {
    msg.className = 'err'
    msg.textContent = res.error ?? 'Ошибка'
    save.disabled = false
  }
}

save.addEventListener('click', () => void submit())
conn.addEventListener('keydown', (e) => {
  if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') void submit()
})

export {}
