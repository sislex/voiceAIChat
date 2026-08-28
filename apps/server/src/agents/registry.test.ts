import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { AgentRegistry, type AgentSocket } from './registry'
import { DEFAULT_AGENT_POLICY, type ServerToAgent } from '@voicechat/shared'

/** Фейковый сокет: копит отправленные сообщения. */
function fakeSocket(): AgentSocket & { sent: ServerToAgent[]; closed: boolean } {
  const s = {
    sent: [] as ServerToAgent[],
    closed: false,
    send(data: string) {
      s.sent.push(JSON.parse(data) as ServerToAgent)
    },
    close() {
      s.closed = true
    }
  }
  return s
}

function makeRegistry(): AgentRegistry {
  let n = 0
  return new AgentRegistry({ newId: () => `exec-${++n}` })
}

describe('AgentRegistry', () => {
  it('exec: шлёт exec.start, копит chunks и резолвится по done', async () => {
    const reg = makeRegistry()
    const sock = fakeSocket()
    reg.register('a1', 'Мак', sock)

    const p = reg.exec('a1', 'df -h', 1000)
    expect(sock.sent[0]).toEqual({ t: 'exec.start', execId: 'exec-1', command: 'df -h', timeoutMs: 1000 })

    reg.handleMessage('a1', { t: 'exec.chunk', execId: 'exec-1', stream: 'stdout', data: 'диск ' })
    reg.handleMessage('a1', { t: 'exec.chunk', execId: 'exec-1', stream: 'stderr', data: 'warn' })
    reg.handleMessage('a1', { t: 'exec.done', execId: 'exec-1', exitCode: 0 })

    await expect(p).resolves.toEqual({ exitCode: 0, output: 'диск warn', timedOut: false })
  })

  it('exec: onCommand получает запись журнала с источником, кодом выхода и длительностью; отказ политики — тоже', async () => {
    const reg = makeRegistry()
    const sock = fakeSocket()
    reg.register('a1', 'Мак', sock)
    const records: Array<Parameters<Parameters<AgentRegistry['onCommand']>[0]>[0]> = []
    reg.onCommand((rec) => records.push(rec))
    const p = reg.exec('a1', 'ls', 1000, undefined, { source: 'console', userId: 'bob' })
    reg.handleMessage('a1', { t: 'exec.chunk', execId: 'exec-1', stream: 'stdout', data: 'a.txt' })
    reg.handleMessage('a1', { t: 'exec.done', execId: 'exec-1', exitCode: 0 })
    await p
    expect(records[0]).toMatchObject({ machineId: 'a1', userId: 'bob', source: 'console', command: 'ls', exitCode: 0, timedOut: false, error: null, outputExcerpt: 'a.txt', output: 'a.txt', conversationId: null })
    reg.updatePolicy('a1', { allowedDirs: [], allowNetwork: true, allowWrite: false, denyPatterns: [], allowPatterns: [], skills: [] })
    await expect(reg.exec('a1', 'rm -rf x', 1000, undefined, { source: 'chat', conversationId: 'c1' })).rejects.toThrow()
    expect(records[1]).toMatchObject({ source: 'chat', conversationId: 'c1', exitCode: null })
    expect(records[1]!.error).toContain('политикой')
  })

  it('offlineGraceMs: exec и fs ждут возврата машины и продолжают после register; по таймауту — «не в сети»', async () => {
    let n = 0
    const reg = new AgentRegistry({ newId: () => `exec-${++n}`, offlineGraceMs: 200 })
    const sock = fakeSocket()
    // машина офлайн: команда не падает, а ждёт
    const p = reg.exec('a1', 'uptime', 1000)
    const fsP = reg.fsList('a1', '/')
    expect(sock.sent).toHaveLength(0)
    reg.register('a1', 'Мак', sock, undefined, '0.15.0')
    await new Promise((r) => setTimeout(r, 0))
    expect(sock.sent.map((m) => m.t)).toEqual(['exec.start', 'fs.list'])
    reg.handleMessage('a1', { t: 'exec.done', execId: 'exec-1', exitCode: 0 })
    reg.handleMessage('a1', { t: 'fs.result', opId: 'exec-2', result: { root: '/', cwd: '/', entries: [] } })
    await expect(p).resolves.toMatchObject({ exitCode: 0 })
    await expect(fsP).resolves.toMatchObject({ root: '/' })
    // никто не подключился — отказ с указанием, сколько ждали
    await expect(reg.exec('a2', 'uptime', 1000)).rejects.toThrow('не в сети')
  })

  it('exec: офлайн-агент → reject сразу', async () => {
    const reg = makeRegistry()
    await expect(reg.exec('нет', 'ls', 1000)).rejects.toThrow('не в сети')
  })

  it('exec: команда, запрещённая политикой, → reject без отправки', async () => {
    const reg = makeRegistry()
    const sock = fakeSocket()
    reg.register('a1', 'Мак', sock, {
      allowedDirs: [],
      allowNetwork: true,
      allowWrite: false,
      denyPatterns: [],
      allowPatterns: [],
      skills: []
    })
    await expect(reg.exec('a1', 'rm -rf x', 1000)).rejects.toThrow('политик')
    expect(sock.sent.some((m) => m.t === 'exec.start')).toBe(false)
  })

  it('updatePolicy шлёт agent.policy онлайн-агенту', () => {
    const reg = makeRegistry()
    const sock = fakeSocket()
    reg.register('a1', 'Мак', sock)
    reg.updatePolicy('a1', { ...DEFAULT_AGENT_POLICY, allowNetwork: false })
    const msg = sock.sent.find((m) => m.t === 'agent.policy')
    expect(msg).toBeTruthy()
  })

  it('onChange вызывается на register/unregister', () => {
    const reg = makeRegistry()
    let n = 0
    reg.onChange(() => n++)
    reg.register('a1', 'Мак', fakeSocket())
    reg.unregister('a1')
    expect(n).toBe(2)
  })

  it('exec.error → reject с сообщением', async () => {
    const reg = makeRegistry()
    reg.register('a1', 'Мак', fakeSocket())
    const p = reg.exec('a1', 'x', 1000)
    reg.handleMessage('a1', { t: 'exec.error', execId: 'exec-1', message: 'spawn failed' })
    await expect(p).rejects.toThrow('spawn failed')
  })

  it('дисконнект агента отклоняет незавершённые команды', async () => {
    const reg = makeRegistry()
    reg.register('a1', 'Мак', fakeSocket())
    const p = reg.exec('a1', 'sleep 5', 1000)
    reg.unregister('a1')
    await expect(p).rejects.toThrow('отключилась')
    expect(reg.isOnline('a1')).toBe(false)
  })

  it('кап вывода: лишние чанки отбрасываются с маркером', async () => {
    const reg = makeRegistry()
    reg.register('a1', 'Мак', fakeSocket())
    const p = reg.exec('a1', 'cat big', 1000)
    const big = 'x'.repeat(120 * 1024)
    reg.handleMessage('a1', { t: 'exec.chunk', execId: 'exec-1', stream: 'stdout', data: big })
    reg.handleMessage('a1', { t: 'exec.chunk', execId: 'exec-1', stream: 'stdout', data: big })
    reg.handleMessage('a1', { t: 'exec.chunk', execId: 'exec-1', stream: 'stdout', data: 'хвост' })
    reg.handleMessage('a1', { t: 'exec.done', execId: 'exec-1', exitCode: 0 })
    const res = await p
    expect(res.output).toContain('…[вывод обрезан]')
    expect(res.output).not.toContain('хвост')
    expect(res.output.length).toBeLessThan(130 * 1024)
  })

  describe('таймауты (fake timers)', () => {
    beforeEach(() => vi.useFakeTimers())
    afterEach(() => vi.useRealTimers())

    it('страховочный таймаут → resolve с timedOut и exec.cancel агенту', async () => {
      const reg = makeRegistry()
      const sock = fakeSocket()
      reg.register('a1', 'Мак', sock)
      const p = reg.exec('a1', 'sleep 999', 1000)
      vi.advanceTimersByTime(1000 + 10_000 + 1)
      const res = await p
      expect(res.timedOut).toBe(true)
      expect(sock.sent.some((m) => m.t === 'exec.cancel')).toBe(true)
    })

    it('fsRead: таймаут сообщает отдельную причину и заданный предел', async () => {
      const reg = makeRegistry()
      reg.register('a1', 'Мак', fakeSocket(), DEFAULT_AGENT_POLICY, '0.6.0')
      const pending = reg.fsRead('a1', '/large.jpg')
      vi.advanceTimersByTime(30_000 + 1)
      await expect(pending).rejects.toThrow('файловую операцию за 30 с')
    })

    it('pty: отписанный сеанс живёт полчаса, а потом убивается по простою', () => {
      const reg = makeRegistry()
      const sock = fakeSocket()
      reg.register('a1', 'Мак', sock, DEFAULT_AGENT_POLICY, '0.9.0')
      reg.ptyStart('a1', 'p1', 80, 24, undefined, () => {})
      reg.ptyDetach('p1')
      vi.advanceTimersByTime(29 * 60_000)
      expect(sock.sent.some((m) => m.t === 'pty.kill')).toBe(false)
      // Вернулись до срока — таймер простоя снят, сеанс остаётся жив.
      reg.ptyStart('a1', 'p1', 80, 24, undefined, () => {})
      vi.advanceTimersByTime(31 * 60_000)
      expect(sock.sent.some((m) => m.t === 'pty.kill')).toBe(false)

      reg.ptyDetach('p1')
      vi.advanceTimersByTime(30 * 60_000 + 1)
      expect(sock.sent).toContainEqual({ t: 'pty.kill', ptyId: 'p1' })
    })
  })

  it('повторная регистрация того же агента вытесняет старый сокет', () => {
    const reg = makeRegistry()
    const oldSock = fakeSocket()
    const newSock = fakeSocket()
    reg.register('a1', 'Мак', oldSock)
    reg.register('a1', 'Мак', newSock)
    expect(oldSock.closed).toBe(true)
    expect(reg.isOnline('a1')).toBe(true)
    expect(reg.nameOf('a1')).toBe('Мак')
  })

  it('signal отменяет только свою команду, не трогая другие на той же машине', async () => {
    const reg = makeRegistry()
    const sock = fakeSocket()
    reg.register('a1', 'Мак', sock)
    const ac = new AbortController()
    const p1 = reg.exec('a1', 'sleep 5', 10_000, ac.signal) // exec-1
    const p2 = reg.exec('a1', 'sleep 5', 10_000) // exec-2 (без signal)
    ac.abort()
    await expect(p1).rejects.toThrow('отменена')
    // exec.cancel отправлен только для exec-1.
    const cancels = sock.sent.filter((m) => m.t === 'exec.cancel')
    expect(cancels).toEqual([{ t: 'exec.cancel', execId: 'exec-1' }])
    // exec-2 всё ещё живой — завершаем его штатно.
    reg.handleMessage('a1', { t: 'exec.done', execId: 'exec-2', exitCode: 0 })
    await expect(p2).resolves.toMatchObject({ exitCode: 0 })
  })

  it('exec с уже прерванным signal → reject сразу', async () => {
    const reg = makeRegistry()
    reg.register('a1', 'Мак', fakeSocket())
    const ac = new AbortController()
    ac.abort()
    await expect(reg.exec('a1', 'ls', 1000, ac.signal)).rejects.toThrow('отменена')
  })

  it('cancelAll отклоняет команды и шлёт exec.cancel', async () => {
    const reg = makeRegistry()
    const sock = fakeSocket()
    reg.register('a1', 'Мак', sock)
    const p = reg.exec('a1', 'sleep 5', 1000)
    reg.cancelAll('a1')
    await expect(p).rejects.toThrow('отменена')
    expect(sock.sent.some((m) => m.t === 'exec.cancel')).toBe(true)
  })

  it('fsList: шлёт fs.list и резолвится по fs.result (по opId)', async () => {
    const reg = makeRegistry()
    const sock = fakeSocket()
    reg.register('a1', 'Мак', sock, DEFAULT_AGENT_POLICY, '0.6.0')

    const p = reg.fsList('a1', '')
    expect(sock.sent[0]).toEqual({ t: 'fs.list', opId: 'exec-1', path: '' })
    const result = { root: '/home/u', cwd: '/home/u', entries: [] }
    reg.handleMessage('a1', { t: 'fs.result', opId: 'exec-1', result })
    await expect(p).resolves.toEqual(result)
  })

  it('fs.error → reject с сообщением; offline → reject', async () => {
    const reg = makeRegistry()
    const sock = fakeSocket()
    reg.register('a1', 'Мак', sock, DEFAULT_AGENT_POLICY, '0.2.0')

    const p = reg.fsDelete('a1', '/x')
    reg.handleMessage('a1', { t: 'fs.error', opId: 'exec-1', message: 'ENOENT: no such file', code: 'ENOENT' })
    await expect(p).rejects.toMatchObject({ message: 'ENOENT: no such file', code: 'ENOENT' })

    await expect(reg.fsList('offline', '')).rejects.toThrow('не в сети')
  })

  it('fsRead: обрыв соединения отклоняется как отключение машины', async () => {
    const reg = makeRegistry()
    reg.register('a1', 'Мак', fakeSocket(), DEFAULT_AGENT_POLICY, '0.6.0')
    const pending = reg.fsRead('a1', '/large.jpg')
    reg.unregister('a1')
    await expect(pending).rejects.toThrow('Машина отключилась')
  })

  it('гейтинг версии: старый агент (0.1.0) → fs запрещён + сигнал обновления; exec разрешён', async () => {
    const reg = makeRegistry()
    const sock = fakeSocket()
    reg.register('a1', 'Мак', sock, DEFAULT_AGENT_POLICY, '0.1.0')

    await expect(reg.fsList('a1', '')).rejects.toThrow(/устарел/i)
    // Агенту ушёл сигнал об обновлении.
    expect(sock.sent.some((m) => m.t === 'agent.updateAvailable')).toBe(true)
    // exec (min 0.1.0) не гейтится — уходит exec.start.
    reg.exec('a1', 'ls', 1000)
    expect(sock.sent.some((m) => m.t === 'exec.start')).toBe(true)
  })
  it('pty: релеит start/input агенту и вывод/exit клиенту', () => {
    const reg = makeRegistry()
    const sock = fakeSocket()
    reg.register('a1', 'Мак', sock, DEFAULT_AGENT_POLICY, '0.9.0')

    const events: Array<{ t: string }> = []
    reg.ptyStart('a1', 'p1', 80, 24, '/work', (e) => events.push(e))
    expect(sock.sent).toContainEqual({ t: 'pty.start', ptyId: 'p1', cols: 80, rows: 24, cwd: '/work' })

    reg.ptyInput('p1', 'ls\r')
    expect(sock.sent).toContainEqual({ t: 'pty.input', ptyId: 'p1', data: 'ls\r' })
    reg.ptyResize('p1', 100, 30)
    expect(sock.sent).toContainEqual({ t: 'pty.resize', ptyId: 'p1', cols: 100, rows: 30 })

    reg.handleMessage('a1', { t: 'pty.output', ptyId: 'p1', data: 'файлы' })
    reg.handleMessage('a1', { t: 'pty.exit', ptyId: 'p1', exitCode: 0 })
    expect(events).toEqual([
      { t: 'pty.output', ptyId: 'p1', data: 'файлы' },
      { t: 'pty.exit', ptyId: 'p1', exitCode: 0 }
    ])
    // После exit сессия удалена: ввод больше не уходит агенту.
    const before = sock.sent.length
    reg.ptyInput('p1', 'x')
    expect(sock.sent.length).toBe(before)
  })

  it('pty: переподписка не запускает второй shell и возвращает ограниченный буфер', () => {
    const reg = makeRegistry()
    const sock = fakeSocket()
    reg.register('a1', 'Мак', sock, DEFAULT_AGENT_POLICY, '0.9.0')
    const first: Array<{ t: string; data?: string }> = []
    reg.ptyStart('a1', 'p1', 80, 24, undefined, (e) => first.push(e))
    reg.handleMessage('a1', { t: 'pty.output', ptyId: 'p1', data: 'готово\\r\\n' })
    reg.ptyDetach('p1')
    const second: Array<{ t: string; data?: string }> = []
    reg.ptyStart('a1', 'p1', 100, 30, undefined, (e) => second.push(e))
    expect(sock.sent.filter((m) => m.t === 'pty.start')).toHaveLength(1)
    expect(second).toContainEqual({ t: 'pty.output', ptyId: 'p1', data: 'готово\\r\\n' })
    expect(sock.sent).toContainEqual({ t: 'pty.resize', ptyId: 'p1', cols: 100, rows: 30 })
  })

  it('pty: буфер сеанса ограничен — при переподписке отдаётся хвост вывода', () => {
    const reg = makeRegistry()
    const sock = fakeSocket()
    reg.register('a1', 'Мак', sock, DEFAULT_AGENT_POLICY, '0.9.0')
    reg.ptyStart('a1', 'p1', 80, 24, undefined, () => {})
    for (let i = 0; i < 30; i++) {
      reg.handleMessage('a1', { t: 'pty.output', ptyId: 'p1', data: `${'x'.repeat(10 * 1024)}#${i}` })
    }
    reg.ptyDetach('p1')
    const replayed: string[] = []
    reg.ptyStart('a1', 'p1', 80, 24, undefined, (e) => {
      if (e.t === 'pty.output') replayed.push(e.data)
    })
    const bytes = Buffer.byteLength(replayed.join(''))
    expect(bytes).toBeLessThanOrEqual(210 * 1024)
    expect(replayed.join('')).toContain('#29')
    expect(replayed.join('')).not.toContain('#0')
  })

  it('pty: старый агент (<0.9.0) → pty.error клиенту, без pty.start агенту', () => {
    const reg = makeRegistry()
    const sock = fakeSocket()
    reg.register('a1', 'Мак', sock, DEFAULT_AGENT_POLICY, '0.2.0')
    const events: Array<{ t: string; message?: string }> = []
    reg.ptyStart('a1', 'p1', 80, 24, undefined, (e) => events.push(e))
    expect(events[0].t).toBe('pty.error')
    expect(sock.sent.some((m) => m.t === 'pty.start')).toBe(false)
  })

  it('pty: дисконнект агента шлёт pty.error по активным сессиям', () => {
    const reg = makeRegistry()
    const sock = fakeSocket()
    reg.register('a1', 'Мак', sock, DEFAULT_AGENT_POLICY, '0.9.0')
    const events: Array<{ t: string }> = []
    reg.ptyStart('a1', 'p1', 80, 24, undefined, (e) => events.push(e))
    reg.unregister('a1')
    expect(events.some((e) => e.t === 'pty.error')).toBe(true)
  })

  it('туннель идемпотентно слушает локально и релеет только заданный target-порт', async () => {
    const reg = makeRegistry()
    const local = fakeSocket(), preview = fakeSocket()
    reg.register('local', 'Ноутбук', local, DEFAULT_AGENT_POLICY, '0.10.0')
    reg.register('preview', 'Docker', preview, DEFAULT_AGENT_POLICY, '0.10.0')
    const opening = reg.createTunnel('tun', 'local', 'preview', 18000)
    expect(local.sent.at(-1)).toEqual({ t: 'tunnel.listen', tunnelId: 'tun' })
    reg.handleMessage('local', { t: 'tunnel.listening', tunnelId: 'tun', port: 32100 })
    await expect(opening).resolves.toBe(32100)
    await expect(reg.createTunnel('tun', 'local', 'preview', 18000)).resolves.toBe(32100)
    expect(local.sent.filter((msg) => msg.t === 'tunnel.listen')).toHaveLength(1)
    reg.handleMessage('local', { t: 'tunnel.open', tunnelId: 'tun', connectionId: 'c1' })
    expect(preview.sent.at(-1)).toEqual({ t: 'tunnel.connect', tunnelId: 'tun', connectionId: 'c1', port: 18000 })
    reg.handleMessage('preview', { t: 'tunnel.data', tunnelId: 'tun', connectionId: 'c1', data: 'YQ==' })
    expect(local.sent.at(-1)).toEqual({ t: 'tunnel.data', tunnelId: 'tun', connectionId: 'c1', data: 'YQ==' })
    expect(reg.closeTunnel('tun')).toBe(true)
  })

})

describe('AgentRegistry — телеметрия', () => {
  const sample = {
    ts: 1000,
    os: { platform: 'linux', release: '6.8', arch: 'x64', isAndroid: false },
    cpu: { count: 8, loadPct: 42 },
    mem: { totalBytes: 16_000, usedBytes: 8_000 },
    disk: { root: { totalBytes: 100, freeBytes: 40 } }
  }

  it('agent.telemetry сохраняется, отдаётся telemetryOf и уведомляет onChange', () => {
    const reg = makeRegistry()
    reg.register('a1', 'Мак', fakeSocket())
    const changes = vi.fn()
    reg.onChange(changes)

    reg.handleMessage('a1', { t: 'agent.telemetry', telemetry: sample })

    expect(reg.telemetryOf('a1')).toEqual(sample)
    expect(changes).toHaveBeenCalledTimes(1)
  })

  it('телеметрия офлайн-агента игнорируется', () => {
    const reg = makeRegistry()
    reg.handleMessage('нет', { t: 'agent.telemetry', telemetry: sample })
    expect(reg.telemetryOf('нет')).toBeUndefined()
  })

  it('unregister очищает телеметрию', () => {
    const reg = makeRegistry()
    reg.register('a1', 'Мак', fakeSocket())
    reg.handleMessage('a1', { t: 'agent.telemetry', telemetry: sample })
    reg.unregister('a1')
    expect(reg.telemetryOf('a1')).toBeUndefined()
  })

  it('platformOf берёт platform из последней телеметрии; без неё — undefined', () => {
    const reg = makeRegistry()
    reg.register('a1', 'Мак', fakeSocket())
    expect(reg.platformOf('a1')).toBeUndefined()
    reg.handleMessage('a1', { t: 'agent.telemetry', telemetry: { ...sample, os: { ...sample.os, platform: 'win32' } } })
    expect(reg.platformOf('a1')).toBe('win32')
  })
})

describe('loopback HTTP-мост (http.request)', () => {
  it('шлёт http.request и резолвится по http.result с тем же requestId', async () => {
    const reg = makeRegistry()
    const sock = fakeSocket()
    reg.register('a1', 'Мак', sock, DEFAULT_AGENT_POLICY, '0.13.0')
    const promise = reg.http('a1', { method: 'GET', port: 5173, path: '/', headers: {} })
    const sent = sock.sent.at(-1) as Extract<ServerToAgent, { t: 'http.request' }>
    expect(sent).toMatchObject({ t: 'http.request', request: { method: 'GET', port: 5173, path: '/' } })
    reg.handleMessage('a1', { t: 'http.result', requestId: sent.requestId, response: { status: 200, headers: { 'content-type': 'text/html' }, bodyBase64: Buffer.from('<h1>ok</h1>').toString('base64') } })
    await expect(promise).resolves.toMatchObject({ status: 200 })
  })

  it('устаревший агент получает понятный отказ и сигнал об обновлении', async () => {
    const reg = makeRegistry()
    const sock = fakeSocket()
    reg.register('a1', 'Мак', sock, DEFAULT_AGENT_POLICY, '0.12.0')
    await expect(reg.http('a1', { method: 'GET', port: 5173, path: '/', headers: {} })).rejects.toThrow(/устарел/)
    expect(sock.sent.some((m) => m.t === 'agent.updateAvailable')).toBe(true)
  })

  it('офлайн-агент → reject; дисконнект отклоняет незавершённый запрос', async () => {
    const reg = makeRegistry()
    await expect(reg.http('a1', { method: 'GET', port: 80, path: '/', headers: {} })).rejects.toThrow('Машина не в сети')
    const sock = fakeSocket()
    reg.register('a1', 'Мак', sock, DEFAULT_AGENT_POLICY, '0.13.0')
    const pending = reg.http('a1', { method: 'GET', port: 80, path: '/', headers: {} })
    reg.unregister('a1')
    await expect(pending).rejects.toThrow('Машина отключилась')
  })

  it('http.error агента → reject с его сообщением; чужой агент игнорируется', async () => {
    const reg = makeRegistry()
    const sock = fakeSocket()
    reg.register('a1', 'Мак', sock, DEFAULT_AGENT_POLICY, '0.13.0')
    const pending = reg.http('a1', { method: 'GET', port: 80, path: '/', headers: {} })
    const sent = sock.sent.at(-1) as Extract<ServerToAgent, { t: 'http.request' }>
    reg.handleMessage('other', { t: 'http.error', requestId: sent.requestId, message: 'подделка' })
    reg.handleMessage('a1', { t: 'http.error', requestId: sent.requestId, message: 'ECONNREFUSED' })
    await expect(pending).rejects.toThrow('ECONNREFUSED')
  })
})
