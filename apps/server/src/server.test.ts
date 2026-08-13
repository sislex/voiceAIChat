import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { WebSocket } from 'ws'
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { AddressInfo } from 'node:net'
import type { FastifyInstance } from 'fastify'
import { buildServer, parseQaPreparationResponse } from './server.js'
import { loadConfig } from './config.js'
import { buildPublicMcpUrl, mcpBaseMisconfigured } from './mcp/publicBase.js'
import { REMOTE_BASH_MCP_PATH } from './mcp/remoteBashMcp.js'
import { KB_MCP_PATH } from './kb/kbMcp.js'
import { CI_COMMANDS_MCP_PATH } from './ci/ciCommandsMcp.js'

let app: FastifyInstance
let port: number

beforeAll(async () => {
  app = await buildServer({
    config: loadConfig({ PORT: '0' }),
    // тестовый обработчик: эхо типа сообщения обратно клиенту
    createWsHandlers: () => ({
      onMessage: (msg, ctx) => ctx.send({ t: 'stt.error', message: msg.t }),
      onBinary: (data, ctx) => ctx.send({ t: 'stt.error', message: `binary:${data.length}` })
    })
  })
  await app.listen({ port: 0, host: '127.0.0.1' })
  port = (app.server.address() as AddressInfo).port
})

afterAll(async () => {
  await app.close()
})

describe('QA preparation response contract', () => {
  const valid = [{ title:'Happy path', description:'goal', preconditions:'open app', steps:'1. click', testData:'user', expectedResult:'saved', required:true, testType:'manual' }]
  it('accepts valid JSON and extracts a fenced structured response', () => {
    expect(parseQaPreparationResponse(JSON.stringify(valid))).toHaveLength(1)
    expect(parseQaPreparationResponse(`result:\n\`\`\`json\n${JSON.stringify(valid)}\n\`\`\``)[0]?.title).toBe('Happy path')
  })
  it.each([
    ['invalid JSON', 'Жду результаты…'],
    ['empty list', '[]'],
    ['schema mismatch', JSON.stringify([{ ...valid[0], steps: '' }])]
  ])('rejects %s without returning partial scenarios', (_name, response) => {
    expect(() => parseQaPreparationResponse(response)).toThrow()
  })
})

describe('server: HTTP', () => {
  it('GET /api/health → ok', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/health' })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toMatchObject({
      ok: true,
      version: null,
      commit: null,
      task: null
    })
    expect(new Date(res.json().releasedAt).toISOString()).toBe(res.json().releasedAt)
  })
})

describe('server: VC_MCP_PUBLIC_BASE', () => {
  it('строит remote/kb/ci URL от публичной базы и сохраняет ?k=секрет', () => {
    const config = loadConfig({ PORT: '8787', VC_MCP_PUBLIC_BASE: 'http://voicechat:8787/' })
    expect(buildPublicMcpUrl(config, REMOTE_BASH_MCP_PATH, 'secret')).toBe('http://voicechat:8787/mcp/remote-bash?k=secret')
    expect(buildPublicMcpUrl(config, KB_MCP_PATH, 'secret')).toBe('http://voicechat:8787/mcp/kb?k=secret')
    expect(buildPublicMcpUrl(config, CI_COMMANDS_MCP_PATH, 'secret')).toBe('http://voicechat:8787/mcp/ci-commands?k=secret')
  })

  it('исполнитель настроен, а база MCP — нет: конфигурация помечается битой', () => {
    // Ровно этот случай молча отбирал у модели mcp__remote__*/mcp__kb__* в проде:
    // CLI в контейнере исполнителя ходил на СВОЙ 127.0.0.1:8787, где никого нет.
    const broken = loadConfig({ PORT: '8787', VC_LLM_RUNNER_URL: 'http://runner-work:8790' })
    expect(mcpBaseMisconfigured(broken)).toBe(true)
    expect(buildPublicMcpUrl(broken, KB_MCP_PATH, 'secret')).toBe('http://127.0.0.1:8787/mcp/kb?k=secret')

    const fixed = loadConfig({
      PORT: '8787',
      VC_LLM_RUNNER_URL: 'http://runner-work:8790',
      VC_MCP_PUBLIC_BASE: 'http://voicechat:8787'
    })
    expect(mcpBaseMisconfigured(fixed)).toBe(false)

    // Локальный запуск без исполнителя: loopback штатен, ругаться не на что.
    expect(mcpBaseMisconfigured(loadConfig({ PORT: '8787' }))).toBe(false)
  })
})

describe('docker-compose: runtime-метаданные и адрес исполнителя', () => {
  const compose = readFileSync(new URL('../../../docker-compose.yml', import.meta.url), 'utf8')

  it('у сервиса voicechat задан VC_MCP_PUBLIC_BASE с дефолтом на имя сервиса', () => {
    // Дефолт живёт в compose, а не в коде: имя сервиса известно только ему.
    expect(compose).toContain('VC_MCP_PUBLIC_BASE: ${VC_MCP_PUBLIC_BASE:-http://voicechat:8787}')
  })

  it('не подменяет отсутствующую версию релиза техническим номером', () => {
    expect(compose).toContain('VC_RELEASE_VERSION: ${VC_RELEASE_VERSION:-}')
    expect(compose).not.toContain('VC_RELEASE_VERSION: ${VC_RELEASE_VERSION:-0.1.0}')
  })

  it('prod-скрипты сохраняют версию защищённой публикации и используют Git-тег как fallback', () => {
    for (const script of ['deploy.sh', 'rebuild-when-idle.sh']) {
      const source = readFileSync(new URL(`../../../scripts/prod/${script}`, import.meta.url), 'utf8')
      expect(source).toContain('export VC_RELEASE_VERSION=${release_tag:+${release_tag#v}}')
      expect(source).toContain('release_version_source=${VC_RELEASE_VERSION_SOURCE:-explicit}')
      expect(source).not.toContain('export VC_RELEASE_VERSION=${VC_RELEASE_VERSION:-0.1.0}')
    }
  })

  it('launcher и detached-процесс явно переносят release metadata', () => {
    const install = readFileSync(new URL('../../../scripts/prod/install.sh', import.meta.url), 'utf8')
    const deploy = readFileSync(new URL('../../../scripts/prod/deploy.sh', import.meta.url), 'utf8')
    expect(install).toContain('exec env VC_RELEASE_VERSION="${VC_RELEASE_VERSION-}" VC_RELEASE_VERSION_SOURCE="${VC_RELEASE_VERSION_SOURCE-}" "$runtime" "$@"')
    expect(deploy).toContain('--release-version "$release_version"')
    expect(deploy).toContain('--release-version-source "$release_version_source"')
    expect(deploy).toContain('export VC_RELEASE_VERSION=$2')
    expect(deploy).toContain('source=$release_version_source')
  })
})

describe('server: раздача web-статики (VC_WEB_DIR)', () => {
  let webApp: FastifyInstance
  let webDir: string
  let webRecorderDir: string

  beforeAll(async () => {
    webDir = mkdtempSync(join(tmpdir(), 'vc-web-'))
    writeFileSync(join(webDir, 'index.html'), '<!doctype html><title>voiceAIChat</title>')
    mkdirSync(join(webDir, 'assets'), { recursive: true })
    writeFileSync(join(webDir, 'assets', 'app.js'), 'console.log(1)')
    webRecorderDir = mkdtempSync(join(tmpdir(), 'vc-web-recorder-'))
    writeFileSync(join(webRecorderDir, 'index.html'), '<!doctype html><title>Web Recorder</title>')
    mkdirSync(join(webRecorderDir, 'assets'), { recursive: true })
    writeFileSync(join(webRecorderDir, 'assets', 'recorder.js'), 'console.log(\'recorder\')')
    writeFileSync(join(webRecorderDir, 'assets', 'recorder.css'), '.webpreview{display:grid}')
    webApp = await buildServer({
      config: { ...loadConfig({ PORT: '0' }), webDir, webRecorderDir },
      createWsHandlers: () => ({ onMessage: () => {}, onBinary: () => {} })
    })
  })

  afterAll(async () => {
    await webApp.close()
    rmSync(webDir, { recursive: true, force: true })
    rmSync(webRecorderDir, { recursive: true, force: true })
  })

  it('GET / отдаёт index.html', async () => {
    const res = await webApp.inject({ method: 'GET', url: '/' })
    expect(res.statusCode).toBe(200)
    expect(res.body).toContain('voiceAIChat')
  })

  it('GET /assets/app.js отдаёт ассет', async () => {
    const res = await webApp.inject({ method: 'GET', url: '/assets/app.js' })
    expect(res.statusCode).toBe(200)
    expect(res.body).toContain('console.log')
  })

  it('GET /web-recorder/ отдаёт index.html Recorder, а не ChatAI', async () => {
    const res = await webApp.inject({ method: 'GET', url: '/web-recorder/' })
    expect(res.statusCode).toBe(200)
    expect(res.body).toContain('Web Recorder')
    expect(res.body).not.toContain('voiceAIChat')
  })

  it('отдаёт JS и CSS Recorder из /web-recorder/assets/', async () => {
    const js = await webApp.inject({ method: 'GET', url: '/web-recorder/assets/recorder.js' })
    const css = await webApp.inject({ method: 'GET', url: '/web-recorder/assets/recorder.css' })
    expect(js.statusCode).toBe(200)
    expect(js.body).toContain('recorder')
    expect(css.statusCode).toBe(200)
    expect(css.headers['content-type']).toContain('text/css')
  })

  it('не подменяет отсутствующий Recorder asset fallback-страницей ChatAI', async () => {
    const res = await webApp.inject({ method: 'GET', url: '/web-recorder/assets/missing.js' })
    expect(res.statusCode).toBe(404)
    expect(res.body).not.toContain('voiceAIChat')
  })

  it('SPA-fallback: неизвестный GET → index.html', async () => {
    const res = await webApp.inject({ method: 'GET', url: '/conversations/xyz' })
    expect(res.statusCode).toBe(200)
    expect(res.body).toContain('voiceAIChat')
  })

  it('неизвестный /api не отдаёт index.html (401 от auth-хука либо 404)', async () => {
    const res = await webApp.inject({ method: 'GET', url: '/api/does-not-exist' })
    expect([401, 404]).toContain(res.statusCode)
    expect(res.body).not.toContain('voiceAIChat')
  })

  it('API и здоровье продолжают работать при включённой статике', async () => {
    const res = await webApp.inject({ method: 'GET', url: '/api/health' })
    expect(res.statusCode).toBe(200)
  })
})

describe('server: WebSocket', () => {
  function connect(): Promise<WebSocket> {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`)
    return new Promise((resolve, reject) => {
      ws.on('open', () => resolve(ws))
      ws.on('error', reject)
    })
  }

  it('принимает JSON-кадр и отвечает (round-trip)', async () => {
    const ws = await connect()
    const reply = new Promise<string>((resolve) => ws.on('message', (d) => resolve(d.toString())))
    ws.send(JSON.stringify({ t: 'audio.start', sampleRate: 16000 }))
    const msg = JSON.parse(await reply)
    expect(msg).toEqual({ t: 'stt.error', message: 'audio.start' })
    ws.close()
  })

  it('принимает бинарный кадр', async () => {
    const ws = await connect()
    const reply = new Promise<string>((resolve) => ws.on('message', (d) => resolve(d.toString())))
    ws.send(Buffer.from([1, 2, 3, 4]))
    const msg = JSON.parse(await reply)
    expect(msg.message).toBe('binary:4')
    ws.close()
  })
})
