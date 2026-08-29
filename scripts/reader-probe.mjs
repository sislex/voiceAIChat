#!/usr/bin/env node
// Живая проверка Playwright Reader без прода в цепочке.
//
// Раннер поднимается локально контейнером (см. scripts/browser-runner-local.sh),
// а сайт открывается настоящий: снаружи `http://89.125.68.35:8787/` доступен без
// ограничений — запрет «контейнер → публичный IP своего хоста» действует только
// на самом прод-хосте.
//
// Использование: node scripts/reader-probe.mjs [url] [...селекторы для чтения]

const BASE = process.env.VC_READER_PROBE_URL ?? 'http://localhost:8892/v1'
const TOKEN = process.env.VC_BROWSER_RUNNER_TOKEN ?? 'vc-local-reader'
const target = process.argv[2] ?? 'http://89.125.68.35:8787/'
const selectors = process.argv.slice(3)

const headers = { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' }
const post = (path, body) => fetch(BASE + path, { method: 'POST', headers, body: JSON.stringify(body) })
const short = (value, limit = 160) => String(value ?? '(пусто)').replace(/\s+/g, ' ').slice(0, limit)

const sessionId = `probe-${process.pid}`
let failed = false

try {
  const health = await fetch(`${BASE}/health`, { headers }).then((r) => r.json())
  if (!health.ok) throw new Error(`раннер нездоров: ${JSON.stringify(health)}`)

  const session = await post('/sessions', { sessionId, userKey: 'probe', conversationKey: sessionId }).then((r) => r.json())
  if (!session.incarnation) throw new Error(`сессия не создана: ${JSON.stringify(session)}`)

  const command = async (body) => {
    const res = await post(`/sessions/${sessionId}/commands`, { requestId: String(Math.random()), incarnation: session.incarnation, actor: 'assistant', command: body })
    return res.headers.get('content-type')?.startsWith('image/') ? { image: (await res.arrayBuffer()).byteLength } : res.json()
  }

  const nav = await command({ type: 'navigate', url: target })
  if (nav.error) throw new Error(`переход не удался: ${short(nav.error)}`)
  console.log(`адрес: ${nav.currentUrl}`)
  console.log(`заголовок: ${JSON.stringify(nav.title)}`)

  const read = await command({ type: 'selector', action: { kind: 'read', limit: 400 } })
  console.log(`текст: ${short(read.text ?? read.error)}`)

  for (const selector of selectors) {
    // Ждём элемент, а не проверяем сразу после перехода: на медленной странице
    // мгновенная проверка давала ложный отрицательный результат.
    await command({ type: 'selector', action: { kind: 'wait', selector, timeoutMs: 10_000 } })
    const found = await command({ type: 'selector', action: { kind: 'find', selector, limit: 3 } })
    const matches = found.matches ?? []
    // У полей ввода `innerText` пуст — печатаем видимость, иначе строка выглядит
    // так, будто ничего не нашлось.
    const describe = (m) => `${m.visible ? 'виден' : 'скрыт'}${m.text ? `: ${short(m.text, 40)}` : ''}`
    console.log(`${selector}: ${matches.length ? `${matches.length} шт. — ${matches.map(describe).join(' | ')}` : `НЕ НАЙДЕН (${short(found.error)})`}`)
    if (!matches.length) failed = true
  }

  const errors = await command({ type: 'inspect', action: { kind: 'console', level: 'error', limit: 10 } })
  const pageErrors = errors.console ?? []
  console.log(`ошибки страницы: ${pageErrors.length ? pageErrors.map((e) => short(e.text, 90)).join(' ; ') : 'нет'}`)
  if (pageErrors.length) failed = true

  const shot = await command({ type: 'screenshot', format: 'png' })
  console.log(`снимок: ${shot.image ?? 0} байт`)
} catch (error) {
  console.error(`СБОЙ: ${error instanceof Error ? error.message : String(error)}`)
  failed = true
} finally {
  await fetch(`${BASE}/sessions/${sessionId}`, { method: 'DELETE', headers }).catch(() => undefined)
}

process.exit(failed ? 1 : 0)
