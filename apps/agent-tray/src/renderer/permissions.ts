// Окно «Разрешения машины»: булевы права — чекбоксами (правятся тут), списки —
// только показ (правятся в веб-настройках). Изменения уходят на сервер.

const root = document.getElementById('root') as HTMLDivElement
let policy: AgentPolicyR | null = null

function list(title: string, items: string[]): string {
  const body = items.length
    ? items.map((i) => `<div class="item">${escapeHtml(i)}</div>`).join('')
    : '<div class="empty">— пусто</div>'
  return `<section><h2>${title}</h2><div class="list">${body}</div></section>`
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>]/g, (c) => (c === '&' ? '&amp;' : c === '<' ? '&lt;' : '&gt;'))
}

function render(): void {
  if (!policy) {
    root.innerHTML = '<p class="placeholder">Нет данных — подключитесь к серверу.</p>'
    return
  }
  const p = policy
  root.innerHTML =
    `<div class="perm">
       <input type="checkbox" id="net" ${p.allowNetwork ? 'checked' : ''} />
       <label for="net"><span class="t">Доступ в сеть / API</span>
         <span class="d">curl/wget/ssh и сетевые запросы</span></label>
     </div>
     <div class="perm">
       <input type="checkbox" id="write" ${p.allowWrite ? 'checked' : ''} />
       <label for="write"><span class="t">Изменение файлов</span>
         <span class="d">создание, правка, удаление, загрузка</span></label>
     </div>` +
    list('Разрешённые каталоги', p.allowedDirs) +
    list('Запрещённые паттерны команд', p.denyPatterns) +
    list('Разрешённые паттерны', p.allowPatterns) +
    list('Навыки', p.skills.map((s) => `${s.name}: ${s.command}`)) +
    '<p class="note">Списки и навыки меняются в веб-настройках (раздел «Агент»).</p>'

  const net = document.getElementById('net') as HTMLInputElement
  const write = document.getElementById('write') as HTMLInputElement
  net.addEventListener('change', () => void save({ allowNetwork: net.checked }))
  write.addEventListener('change', () => void save({ allowWrite: write.checked }))
}

async function save(patch: Partial<AgentPolicyR>): Promise<void> {
  if (!policy) return
  policy = { ...policy, ...patch }
  await window.agent.setPolicy(policy)
}

window.agent.onPolicy((p) => {
  policy = p
  render()
})

void window.agent.getPolicy().then((p) => {
  policy = p
  render()
})

export {}
