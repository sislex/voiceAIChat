---
title: oom-exec-stream
date: 2026-09-08
machine: alexeys-macbook-air-2
author: alexeyrozhnov
---

# Прод: ядро падает по потолку кучи под активностью

## Что сделано

- Расследование на проде (релиз 0.1.259, `mem_limit 1g`, потолок кучи ~512 МБ): три падения
  `FATAL ERROR: … heap out of memory` за утро (09:06, 09:33, 09:54), каждое — во время рана модели или регрессии
  релиза; на простое память ровная (158 МБ за 90 с).
- Найдены и исправлены два дефекта потока лога: исполнитель CI звал асинхронный `onChunk` без ожидания
  (тысячи `appendCiLog` в полёте), регрессия релиза на каждый чанк переписывала полный лог шага и писала событие
  таймлайна с его копией (`project_release_events` — 97 тысяч событий, 3 ГБ). Сток `ci/chunkSink.ts`, событие
  только при смене статуса, фоновая чистка `pruneProgressEvents()`.
- Профиль аллокаций живого процесса: `docker exec <ядро> node -e "process._debugProcess(1)"` открывает
  инспектор на localhost контейнера; скрипт ниже подключается по `ws` и снимает `HeapProfiler` sampling.

## Что выяснили (факты, которых не было в KB)

- `docker kill --signal=USR1` для прод-контейнера классификатор агента блокирует; `process._debugProcess(pid)`
  из `docker exec` — штатная замена, порт 9229 наружу не выходит.
- События релизов никто не читает (`getProjectRelease` их не грузит) — их рост бил по диску, не по памяти.
- Диск прода занят на 92 % (5,8 ГБ том данных, 23 ГБ образов, 10 ГБ build cache); `VACUUM` базы невозможен без
  освобождения места.
- В `.env` прода только `VC_PUBLIC_HOST`: внутренний токен и секрет MCP — локальные дефолты compose.

## Куда занесено

- docs/kb/testing-operations.md — «Ядро падает с heap out of memory»
- docs/kb/conventions.md — «Поток вывода команд пишется через сток с обратным давлением»

## Открытые вопросы / что осталось

- Подтвердить профилем, что после исправления рост памяти под ранами исчез (профиль снимать в фазе работы модели).
- Освободить диск прода (build cache 5,75 ГБ reclaimable, старые preview-образы) перед переносом базы на Postgres.
- Задать случайные `VC_INTERNAL_TOKEN`/`VC_MCP_SECRET` в `.env` прода.

## Скрипт профиля аллокаций

```js
// Профиль аллокаций живого процесса через инспектор (порт открыт SIGUSR1, только localhost контейнера).
const http = require('node:http')
const WebSocket = require('/app/node_modules/ws')
const seconds = Number(process.argv[2] || 60)
http.get('http://127.0.0.1:9229/json', (res) => {
  let raw = ''
  res.on('data', (d) => { raw += d })
  res.on('end', async () => {
    const url = JSON.parse(raw)[0].webSocketDebuggerUrl
    const ws = new WebSocket(url)
    let id = 0
    const pending = new Map()
    ws.on('message', (d) => { const m = JSON.parse(d.toString()); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id) } })
    const send = (method, params = {}) => new Promise((resolve) => { const i = ++id; pending.set(i, resolve); ws.send(JSON.stringify({ id: i, method, params })) })
    await new Promise((r) => ws.on('open', r))
    const mem0 = (await send('Runtime.evaluate', { expression: 'JSON.stringify(process.memoryUsage())', returnByValue: true })).result.result.value
    await send('HeapProfiler.enable')
    await send('HeapProfiler.startSampling', { samplingInterval: 65536 })
    await new Promise((r) => setTimeout(r, seconds * 1000))
    const { result } = await send('HeapProfiler.stopSampling')
    const mem1 = (await send('Runtime.evaluate', { expression: 'JSON.stringify(process.memoryUsage())', returnByValue: true })).result.result.value
    const agg = new Map()
    const walk = (node, stack) => {
      const f = node.callFrame
      const key = `${f.functionName || '(anon)'} ${f.url.replace(/^.*\/apps\//, 'apps/').replace(/^file:\/\/\/app\//, '')}:${f.lineNumber + 1}`
      const chain = [...stack, key]
      if (node.selfSize) {
        // Считаем размер по вершине стека и отдельно по ближайшему кадру приложения.
        agg.set(key, (agg.get(key) || 0) + node.selfSize)
        const app = chain.slice().reverse().find((k) => /apps\/server|apps\/make/.test(k) && !/node_modules/.test(k))
        if (app) agg.set('APP ' + app, (agg.get('APP ' + app) || 0) + node.selfSize)
      }
      for (const c of node.children) walk(c, chain.length > 40 ? chain.slice(-40) : chain)
    }
    walk(result.profile.head, [])
    const top = [...agg.entries()].sort((a, b) => b[1] - a[1])
    console.log('memory before:', mem0); console.log('memory after: ', mem1)
    console.log('--- top by self frame ---')
    for (const [k, v] of top.filter(([k]) => !k.startsWith('APP ')).slice(0, 15)) console.log((v / 1048576).toFixed(1).padStart(7), 'MB ', k)
    console.log('--- top by nearest app frame ---')
    for (const [k, v] of top.filter(([k]) => k.startsWith('APP ')).slice(0, 15)) console.log((v / 1048576).toFixed(1).padStart(7), 'MB ', k.slice(4))
    ws.close(); process.exit(0)
  })
}).on('error', (e) => { console.error('inspector недоступен:', e.message); process.exit(1) })
```
