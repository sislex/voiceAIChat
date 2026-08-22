import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ensureImageDir, imageDirOf, localAddresses, startImageHost, type ImageHost } from './imageHost.js'

let root: string
let host: ImageHost | null = null

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'vc-imghost-'))
})

afterEach(() => {
  host?.stop()
  host = null
  rmSync(root, { recursive: true, force: true })
})

const get = async (path: string): Promise<Response> =>
  fetch(`http://127.0.0.1:${host!.port}${path}`)

describe('startImageHost — раздача картинок с машины', () => {
  it('создаёт каталог .generated_images и отдаёт из него файл', async () => {
    host = await startImageHost(root, 0)
    expect(host).not.toBeNull()
    expect(host!.dir).toBe(join(root, '.generated_images'))

    writeFileSync(join(host!.dir, 'a.png'), 'PNGDATA')
    const res = await get('/a.png')
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('image/png')
    expect(res.headers.get('access-control-allow-origin')).toBe('*')
    expect(await res.text()).toBe('PNGDATA')
  })

  it('имя с пробелами и кириллицей отдаётся по закодированному URL', async () => {
    host = await startImageHost(root, 0)
    writeFileSync(join(host!.dir, 'схема 1.png'), 'X')
    const res = await get(`/${encodeURIComponent('схема 1.png')}`)
    expect(res.status).toBe(200)
  })

  it('несуществующий файл — 404', async () => {
    host = await startImageHost(root, 0)
    expect((await get('/нет.png')).status).toBe(404)
    expect((await get('/')).status).toBe(404)
  })

  it('обход каталога не работает', async () => {
    host = await startImageHost(root, 0)
    writeFileSync(join(root, 'secret.txt'), 'NOPE')
    for (const p of ['/../secret.txt', '/%2e%2e%2fsecret.txt', '/sub/a.png']) {
      expect((await get(p)).status).toBe(404)
    }
  })

  it('симлинк наружу не отдаётся: имя есть в каталоге, но файл чужой', async () => {
    host = await startImageHost(root, 0)
    writeFileSync(join(root, 'outside.png'), 'OUT')
    symlinkSync(join(root, 'outside.png'), join(host!.dir, 'link.png'))
    expect((await get('/link.png')).status).toBe(404)
  })

  it('метод не GET/HEAD — 405', async () => {
    host = await startImageHost(root, 0)
    const res = await fetch(`http://127.0.0.1:${host!.port}/a.png`, { method: 'POST' })
    expect(res.status).toBe(405)
  })

  it('занятый порт — берётся свободный, раздача всё равно работает', async () => {
    host = await startImageHost(root, 0)
    const second = await startImageHost(mkdtempSync(join(tmpdir(), 'vc-imghost2-')), host!.port)
    expect(second).not.toBeNull()
    expect(second!.port).not.toBe(host!.port)
    second!.stop()
  })
})

describe('вспомогательное', () => {
  it('ensureImageDir создаёт каталог и терпит повторный вызов', () => {
    expect(ensureImageDir(root)).toBe(true)
    expect(ensureImageDir(root)).toBe(true)
    expect(imageDirOf(root)).toBe(join(root, '.generated_images'))
  })

  it('localAddresses отдаёт только внешние IPv4 без loopback', () => {
    for (const a of localAddresses()) {
      expect(a).toMatch(/^\d+\.\d+\.\d+\.\d+$/)
      expect(a.startsWith('127.')).toBe(false)
    }
  })

  it('каталог нельзя создать (путь занят файлом) → null, агент продолжает работать', async () => {
    const busy = join(root, 'busy')
    mkdirSync(busy)
    writeFileSync(join(busy, '.generated_images'), 'файл вместо каталога')
    expect(await startImageHost(busy, 0)).toBeNull()
  })
})
