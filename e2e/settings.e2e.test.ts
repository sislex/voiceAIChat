// E2E сохранности настроек в реальном Chromium: то, ради чего всё затевалось —
// пересборка релиза не должна сбрасывать выбор человека.
//
// jsdom-тесты проверяют стор и адаптеры по отдельности; здесь проверяется
// связка целиком на живом сервере: настройка сохраняется, падение сервера не
// превращает её в дефолт, а вернувшийся сервер подхватывается сам, без
// перезагрузки страницы.
import { spawn, execFileSync, type ChildProcess } from 'node:child_process'
import { RemoteTtsClient } from '../apps/server/src/tts/client/remoteTtsClient'
import { encodeWav } from '../apps/stt-runner/src/run/wav'
import { floatTo16BitPCM, resampleLinear } from '../packages/shared/src/pcm'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { chromium, _electron, type Browser, type Page } from 'playwright'

const ROOT = resolve(__dirname, '..')
const WEB_DIST = join(ROOT, 'apps/web/dist')
const PORT = 8991 + Math.floor(Math.random() * 60)
const BASE = `http://127.0.0.1:${PORT}`
const PASSWORD = 'e2e-settings-pass'

let server: ChildProcess | null = null
let dataDir = ''
let browser: Browser
let page: Page
let token = ''
let runnerEnv: Record<string, string> = {}

function startServer(): ChildProcess {
  return spawn(process.execPath, ['--import', 'tsx', 'src/index.ts'], {
    cwd: join(ROOT, 'apps/server'),
    env: { ...process.env, ...runnerEnv, PORT: String(PORT), HOST: '127.0.0.1', VC_DATA_DIR: dataDir, VC_WEB_DIR: WEB_DIST, VC_ADMIN_PASSWORD: PASSWORD },
    stdio: 'ignore'
  })
}

async function waitHealth(): Promise<void> {
  for (let i = 0; i < 60; i++) {
    try { const r = await fetch(`${BASE}/api/health`); if (r.ok) return } catch { /* ещё не поднялся */ }
    await new Promise((r) => setTimeout(r, 1000))
  }
  throw new Error('сервер не поднялся за 60 с')
}

/** Сервер ушёл в перезапуск: ждём, пока порт действительно замолчит. */
async function waitDown(): Promise<void> {
  for (let i = 0; i < 30; i++) {
    try { await fetch(`${BASE}/api/health`) } catch { return }
    await new Promise((r) => setTimeout(r, 500))
  }
  throw new Error('сервер не остановился')
}

const api = async (path: string, init: RequestInit = {}): Promise<Response> =>
  fetch(`${BASE}${path}`, { ...init, headers: { 'content-type': 'application/json', authorization: `Bearer ${token}`, ...(init.headers ?? {}) } })

const savedTheme = async (): Promise<string> => ((await (await api('/api/settings')).json()) as { theme: string }).theme

/** Меню аккаунта → «Настройки» → раздел «Интерфейс». */
async function openInterfaceSettings(): Promise<void> {
  if (!(await page.getByTestId('overlay').isVisible().catch(() => false))) {
    // Кнопка меню подписана ролью пользователя; ждём её появления — сразу
    // после загрузки страница ещё проверяет сессию.
    const account = page.getByRole('button', { name: new RegExp('admin') })
    await account.waitFor({ state: 'visible', timeout: 30_000 })
    await account.click()
    await page.getByRole('menuitem', { name: 'Настройки' }).click()
  }
  await page.getByRole('button', { name: 'Интерфейс' }).click()
}

describe('Настройки E2E: релиз не сбрасывает выбор', () => {
  beforeAll(async () => {
    if (!existsSync(WEB_DIST)) throw new Error('Build apps/web before running required settings/onboarding E2E')
    dataDir = await mkdtemp(join(tmpdir(), 'vc-e2e-settings-'))
    server = startServer()
    await waitHealth()
    const login = await fetch(`${BASE}/api/session/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'admin', password: PASSWORD }) })
    token = ((await login.json()) as { token: string }).token
    await api('/api/settings', { method: 'PUT', body: JSON.stringify({ onboarded: true }) })

    browser = await chromium.launch()
    page = await browser.newPage({ viewport: { width: 1400, height: 900 } })
    // Returning-user fixture; first entry is covered by TC9.
    await page.addInitScript(() => localStorage.setItem('vc:shell:admin:tour', 'true'))
    await page.goto(`${BASE}/`)
    await page.evaluate((t) => localStorage.setItem('vc.session.token', t), token)
    await page.reload()
  }, 120_000)

  afterAll(async () => {
    await browser?.close()
    server?.kill('SIGTERM')
    if (dataDir) await rm(dataDir, { recursive: true, force: true })
  })

  it('выбор темы доезжает до сервера и переживает перезагрузку', async () => {
    await openInterfaceSettings()
    await page.getByLabel('Тема интерфейса').selectOption('dark')

    await expect.poll(savedTheme, { timeout: 10_000 }).toBe('dark')
    await page.reload()
    await expect.poll(() => page.locator('html').getAttribute('data-theme'), { timeout: 10_000 }).toBe('dark')
  }, 60_000)

  it('падение сервера не превращает настройки в дефолты, а возвращение подхватывается само', async () => {
    // Окно настроек открыто ДО деплоя — это и есть проверяемый сценарий:
    // человек работает, а сервер под ним уходит в перезапуск.
    await openInterfaceSettings()
    await page.context().setOffline(true)
    server?.kill('SIGTERM')
    await waitDown()

    // Изменение не сохранится, но и не сотрёт запись — экран откатывает выбор.
    await page.getByLabel('Тема интерфейса').selectOption('green').catch(() => {})
    await expect.poll(() => page.locator('html').getAttribute('data-theme'), { timeout: 10_000 }).toBe('dark')

    server = startServer()
    await waitHealth()
    expect(await savedTheme()).toBe('dark') // запись на сервере цела

    // Пока вкладка была открыта, тему сменили «с другого устройства».
    await api('/api/settings', { method: 'PUT', body: JSON.stringify({ theme: 'green' }) })
    await page.context().setOffline(false)
    // Вкладку не трогаем и не перезагружаем: её должен догнать реконнект WS.
    await expect.poll(() => page.locator('html').getAttribute('data-theme'), { timeout: 60_000 }).toBe('green')
  }, 180_000)

  // @testCase TC-UI-1
  it('keeps onboarding navigation and actions reachable across themes, touch and keyboard', async () => {
    const artifacts = join(ROOT, 'artifacts/onboarding')
    await mkdir(artifacts, { recursive: true })
    const sizes = [[1440, 900], [1280, 720], [768, 1024], [390, 844], [320, 700]]
    for (const theme of ['light', 'dark']) for (const [width, height] of sizes) {
      await api('/api/settings', { method: 'PUT', body: JSON.stringify({ theme, onboarded: true }) })
      const context = await browser.newContext({ viewport: { width, height }, hasTouch: true })
      const screen = await context.newPage()
      try {
        await screen.addInitScript((sessionToken) => {
          localStorage.setItem('vc.session.token', sessionToken)
          localStorage.setItem('vc:shell:admin:tour', 'true')
          navigator.mediaDevices.getUserMedia = async () => { throw new Error('Unexpected permission request') }
        }, token)
        const cdp = await context.newCDPSession(screen)
        await cdp.send('Emulation.setSafeAreaInsetsOverride', { insets: { top: 24, bottom: 34, left: 0, right: 0 } })
        await screen.goto(BASE + '/#/settings/ui')
        await screen.getByRole('button', { name: 'Мастер первого запуска' }).click()
        const dialog = screen.getByRole('dialog', { name: 'Добро пожаловать', exact: true })
        await dialog.waitFor()
        if (width <= 720) expect((await dialog.getByRole('button', { name: 'Закрыть', exact: true }).boundingBox())!.y).toBeGreaterThanOrEqual(24)
        await screen.getByRole('button', { name: /2\. Озвучка TTS/ }).tap()
        await screen.getByRole('button', { name: 'Пропустить шаг' }).click()
        await screen.keyboard.press('Tab')
        expect(await dialog.evaluate(el => el.contains(document.activeElement))).toBe(true)
        expect(await screen.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
        const exit = screen.getByRole('button', { name: 'Продолжить в чате' })
        await exit.scrollIntoViewIfNeeded()
        expect(await exit.evaluate(el => Number.parseFloat(getComputedStyle(el.parentElement!).paddingBottom))).toBe(34)
        const box = await exit.boundingBox()
        expect(box).not.toBeNull()
        expect(box!.y + box!.height).toBeLessThanOrEqual(height)
        await screen.screenshot({ path: join(artifacts, theme + '-' + width + 'x' + height + '.png') })
        // Reduced visual viewport models keyboard occlusion; this is not a physical OS keyboard test.
        if (width <= 390) {
          await screen.setViewportSize({ width, height: Math.floor(height * 0.6) })
          await exit.scrollIntoViewIfNeeded()
          const reduced = await exit.boundingBox()
          expect(reduced!.y + reduced!.height).toBeLessThanOrEqual(Math.floor(height * 0.6))
          await screen.screenshot({ path: join(artifacts, theme + '-' + width + '-reduced-viewport.png') })
        }
        await exit.focus()
        await screen.keyboard.press('Escape')
        await dialog.waitFor({ state: 'hidden' })
      } catch (error) {
        await screen.screenshot({ path: join(artifacts, theme + '-' + width + '-failure.png') })
        throw error
      } finally { await context.close() }
    }
  }, 180_000)

  // @testCase TC-HOST-1
  it('runs the shared renderer in Electron with persisted progress and an explicit voice check', async () => {
    const executablePath = join(ROOT, 'apps/desktop/node_modules/electron/dist/electron')
    if (!existsSync(executablePath)) throw new Error('Install apps/desktop dependencies before required Electron QA')
    await mkdir(join(ROOT, 'artifacts/onboarding'), { recursive: true })
    const entry = join(dataDir, 'onboarding-electron.cjs')
    await writeFile(entry, [
      "const { app, BrowserWindow, session } = require('electron')",
      "app.setPath('userData', " + JSON.stringify(join(dataDir, 'electron-state')) + ")",
      "app.whenReady().then(() => {",
      "session.defaultSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false))",
      "new BrowserWindow({ width: 390, height: 844, webPreferences: { sandbox: true, contextIsolation: true } }).loadURL(" + JSON.stringify(BASE + '/#/settings/ui') + ")",
      "})"
    ].join('\n'))
    const display = ':' + (190 + Math.floor(Math.random() * 1000))
    const xvfb = spawn('Xvfb', [display, '-screen', '0', '1440x900x24', '-nolisten', 'tcp'], { stdio: 'ignore' })
    let desktop: Awaited<ReturnType<typeof _electron.launch>> | null = null
    try {
      await expect.poll(() => existsSync('/tmp/.X11-unix/X' + display.slice(1)), { timeout: 10_000 }).toBe(true)
      desktop = await _electron.launch({ executablePath, args: ['--no-sandbox', entry], env: { ...process.env, DISPLAY: display } })
      const renderer = await desktop.firstWindow()
      await renderer.waitForLoadState('domcontentloaded')
      await renderer.evaluate(t => {
        localStorage.setItem('vc.session.token', t)
        localStorage.setItem('vc:shell:admin:tour', 'true')
      }, token)
      await renderer.reload()
      await renderer.getByRole('button', { name: 'Мастер первого запуска' }).click()
      await renderer.getByRole('button', { name: /1\. Микрофон/ }).click()
      await renderer.getByRole('button', { name: 'Проверить / повторить' }).click()
      await renderer.getByText(/Ошибка: Проверка не завершилась/).waitFor()
      await renderer.getByRole('button', { name: 'Пропустить шаг' }).click()
      await renderer.getByRole('button', { name: 'Продолжить в чате' }).click()
      await renderer.goto(BASE + '/#/settings/ui')
      await renderer.getByRole('button', { name: 'Мастер первого запуска' }).click()
      await renderer.getByText(/Пропущено: Пропущено пользователем/).waitFor()
      await renderer.screenshot({ path: join(ROOT, 'artifacts/onboarding/electron-resumed.png') })
      await renderer.reload()
      await renderer.goto(BASE + '/#/settings/ui')
      await renderer.getByRole('button', { name: 'Мастер первого запуска' }).click()
      await renderer.getByText(/Пропущено: Пропущено пользователем/).waitFor()
    } finally {
      await desktop?.close()
      xvfb.kill('SIGTERM')
    }
  }, 120_000)

  // @testCase TC-STATE-1
  // @testCase TC-REG-1
  it('persists onboarding across server restart and resets only its state', async () => {
    const progress = {
      version: 1, current: 'machine',
      results: Object.fromEntries(['microphone', 'tts', 'llm', 'machine', 'voice'].map(step =>
        [step, { status: step === 'tts' ? 'success' : step === 'machine' ? 'checking' : 'skipped', diagnostic: '' }]))
    }
    const before = await (await api('/api/settings')).json()
    expect((await api('/api/settings', { method: 'PUT', body: JSON.stringify({ onboarding: progress }) })).ok).toBe(true)
    server?.kill('SIGTERM')
    await waitDown()
    server = startServer()
    await waitHealth()
    expect((await (await api('/api/settings')).json()).onboarding).toEqual(progress)
    await page.reload()
    await page.goto(BASE + '/#/settings/ui')
    await page.getByRole('button', { name: 'Мастер первого запуска' }).click()
    await page.getByText(/Проверка прервана/).waitFor()
    await page.getByRole('button', { name: 'Сбросить только прогресс' }).click()
    await expect.poll(async () => (await (await api('/api/settings')).json()).onboarding.results.tts.status).toBe('idle')
    const after = await (await api('/api/settings')).json()
    expect(after.theme).toBe(before.theme)
    expect(after.voice).toBe(before.voice)
    expect(after.llmProvider).toBe(before.llmProvider)
    await page.getByRole('button', { name: 'Продолжить в чате' }).click()
  }, 120_000)

  // @testCase TC-VOICE-1
  // @testCase TC-DEGRADED-1
  it('crosses real microphone, Whisper, available CLI and TTS boundaries', async () => {
    // Explicit QA URLs/tokens are portable; the production queue can discover its local runners.
    // Keep inspect output inside the process: it contains credentials and must never enter artifacts.
    function runner(service: string, tokenKey: string, envPrefix: string): { baseUrl: string; token: string } {
      const baseUrl = process.env[envPrefix + '_URL']
      const secret = process.env[envPrefix + '_TOKEN']
      if (baseUrl && secret) return { baseUrl, token: secret }
      const value = JSON.parse(execFileSync('docker', ['inspect', 'voiceaichat-' + service + '-1'], { encoding: 'utf8' }))[0]
      const env = Object.fromEntries(value.Config.Env.map((entry: string) => {
        const split = entry.indexOf('=')
        return [entry.slice(0, split), entry.slice(split + 1)]
      }))
      const network = Object.values(value.NetworkSettings.Networks)[0] as { IPAddress: string }
      if (!network?.IPAddress || !env[tokenKey]) throw new Error('Required real QA runner is unavailable: ' + service)
      return { baseUrl: 'http://' + network.IPAddress + ':' + (env.PORT || (service.startsWith('runner-') ? '8790' : '8791')), token: env[tokenKey] }
    }
    const stt = runner('stt-runner', 'VC_STT_RUNNER_TOKEN', 'VC_QA_STT')
    const tts = runner('tts-runner', 'VC_TTS_RUNNER_TOKEN', 'VC_QA_TTS')
    const llm = runner(process.env.VC_QA_LLM_SERVICE || 'runner-work', 'VC_RUNNER_TOKEN', 'VC_QA_LLM')
    runnerEnv = {
      VC_STT_RUNNER_URL: stt.baseUrl, VC_STT_RUNNER_TOKEN: stt.token,
      VC_TTS_RUNNER_URL: tts.baseUrl, VC_TTS_RUNNER_TOKEN: tts.token,
      VC_LLM_RUNNER_URL: llm.baseUrl, VC_LLM_RUNNER_TOKEN: llm.token,
      VC_LLM_RUNNER_CLAUDE_URL: llm.baseUrl, VC_LLM_RUNNER_CODEX_URL: llm.baseUrl
    }
    server?.kill('SIGTERM')
    await waitDown()
    server = startServer()
    await waitHealth()
    const synthesis = new RemoteTtsClient(tts)
    const voices = await synthesis.listVoices()
    expect(voices.length).toBeGreaterThan(0)
    const voice = voices[0].id
    const sample = await synthesis.create({ version: 1, text: 'Ответь одним словом: готово.', voice, format: 'wav', ownerId: 'CHAT-470-qa' })
    const fixture = join(dataDir, 'spoken-request.wav')
    const wav = Buffer.from(await synthesis.audio(sample.runId))
    let format = 0, data = Buffer.alloc(0)
    for (let offset = 12; offset + 8 <= wav.length;) {
      const kind = wav.toString('ascii', offset, offset + 4)
      const length = wav.readUInt32LE(offset + 4)
      if (kind === 'fmt ') format = offset + 8
      if (kind === 'data') data = wav.subarray(offset + 8, offset + 8 + length)
      offset += 8 + length + (length % 2)
    }
    expect(format).toBeGreaterThan(0)
    expect(wav.readUInt16LE(format)).toBe(1)
    expect(wav.readUInt16LE(format + 14)).toBe(16)
    const channels = wav.readUInt16LE(format + 2)
    const sampleRate = wav.readUInt32LE(format + 4)
    const pcm = new Float32Array(data.length / (2 * channels))
    for (let i = 0; i < pcm.length; i++) {
      for (let channel = 0; channel < channels; channel++) pcm[i] += data.readInt16LE((i * channels + channel) * 2) / (32768 * channels)
    }
    // Chromium's file microphone receives a conventional mono 48 kHz PCM WAV.
    await writeFile(fixture, encodeWav(floatTo16BitPCM(resampleLinear(pcm, sampleRate, 48000)), 48000))
    const login = await (await api('/api/auth/status')).json()
    const provider = ['claude', 'codex'].find(p => login[p]?.loggedIn)
    if (!provider) throw new Error('No authorized real CLI provider for required voice QA')
    const models = await (await api('/api/stt/models')).json() as Array<{ model: string; present: boolean }>
    const model = ['small', 'medium', 'large-v3-turbo'].map(name => models.find(item => item.model === name && item.present)).find(Boolean)
    if (!model) throw new Error('No installed Whisper model for required real voice QA')
    await api('/api/settings', { method: 'PUT', body: JSON.stringify({ voice, whisperModel: model.model, micDeviceId: null, llmProvider: provider, onboarded: true }) })
    const capabilities = await (await api('/api/system/capabilities')).json()
    expect(capabilities.stt.available, capabilities.stt.reason).toBe(true)
    const voiceBrowser = await chromium.launch({
      channel: 'chromium',
      args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--use-file-for-fake-audio-capture=' + fixture]
    })
    const context = await voiceBrowser.newContext({ permissions: ['microphone'] })
    const renderer = await context.newPage()
    const mediaFailures: string[] = []
    const startedAt = Date.now()
    const boundaries: Array<{ type: string; elapsedMs: number }> = []
    let checkedConversation = ''
    renderer.on('websocket', socket => socket.on('framereceived', frame => {
      if (typeof frame.payload !== 'string') return
      try {
        const message = JSON.parse(frame.payload)
        if (message.t === 'claude.done') checkedConversation = message.conversationId
        if (['stt.final', 'claude.done', 'tts.audio'].includes(message.t)) {
          boundaries.push({ type: message.t, elapsedMs: Date.now() - startedAt })
        }
      } catch { /* Binary or unrelated traffic is not an onboarding artifact. */ }
    }))
    await renderer.exposeFunction('qaMediaFailure', (name: string) => mediaFailures.push(name))
    await renderer.addInitScript(() => {
      const report = (name: string) => (window as unknown as { qaMediaFailure: (name: string) => void }).qaMediaFailure(name)
      const capture = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices)
      navigator.mediaDevices.getUserMedia = async (...args) => {
        try { return await capture(...args) }
        catch (error) { report('getUserMedia:' + (error as Error).name + ': ' + (error as Error).message); throw error }
      }
      const addModule = AudioWorklet.prototype.addModule
      AudioWorklet.prototype.addModule = async function(...args) {
        try { return await addModule.apply(this, args) }
        catch (error) { report('worklet:' + (error as Error).name); throw error }
      }
    })
    try {
      await renderer.addInitScript(t => {
        if (!sessionStorage.getItem('qa-onboarding-auth-seeded')) {
          localStorage.setItem('vc.session.token', t)
          localStorage.setItem('vc:shell:admin:tour', 'true')
          sessionStorage.setItem('qa-onboarding-auth-seeded', 'true')
        }
      }, token)
      await renderer.goto(BASE + '/#/settings/ui')
      await renderer.getByRole('button', { name: 'Мастер первого запуска' }).click()
      await renderer.getByRole('button', { name: /5\. Голосовой запрос/ }).click()
      await renderer.getByRole('button', { name: 'Проверить / повторить' }).click()
      await renderer.getByRole('button', { name: 'Завершить запись' }).waitFor({ timeout: 10_000 })
      await renderer.waitForTimeout(5000)
      await renderer.getByRole('button', { name: 'Завершить запись' }).click()
      await renderer.getByText('Работает: Подтверждены запись, распознавание, ответ LLM и завершение воспроизведения.')
        .or(renderer.getByText(/^Ошибка:/)).first().waitFor({ timeout: 360_000 })
      expect((await (await api('/api/settings')).json()).onboarding.results.voice.status).toBe('success')
      await mkdir(join(ROOT, 'artifacts/onboarding'), { recursive: true })
      await renderer.screenshot({ path: join(ROOT, 'artifacts/onboarding/real-voice.png') })
      const saved = await (await api('/api/settings')).json()
      expect(saved.onboarding.results.voice.status).toBe('success')
      expect(boundaries.map(item => item.type)).toEqual(expect.arrayContaining(['stt.final', 'claude.done', 'tts.audio']))
      await writeFile(join(ROOT, 'artifacts/onboarding/real-voice.json'), JSON.stringify({
        provider, microphoneInput: 'Chromium WAV device', services: 'real Whisper / CLI / TTS',
        boundaries, playback: 'AudioContext source.onended', result: saved.onboarding.results.voice
      }, null, 2))

      // @testCase TC-DEGRADED-1
      // Speech capability failures must not prevent a real text reply in the same permitted chat.
      await renderer.route('**/api/system/capabilities', route => route.fulfill({ json: {
        ...capabilities, stt: { available: false, reason: 'QA speech offline' }, tts: { available: false, reason: 'QA speech offline' }
      } }))
      await renderer.reload()
      await renderer.goto(BASE + '/#/settings/ui')
      await renderer.getByRole('button', { name: 'Мастер первого запуска' }).click()
      await renderer.getByRole('button', { name: /1\. Микрофон/ }).click()
      await renderer.getByRole('button', { name: 'Проверить / повторить' }).click()
      await renderer.getByText(/Ошибка: Проверка не завершилась/).waitFor()
      await renderer.getByRole('button', { name: 'Пропустить шаг' }).click()
      await renderer.getByRole('button', { name: 'Продолжить в чате' }).click()
      expect(checkedConversation).not.toBe('')
      await renderer.goto(BASE + '/#/chat/' + checkedConversation)
      if (await renderer.getByTestId('composer-expand').isVisible()) await renderer.getByTestId('composer-expand').click()
      const composer = renderer.getByRole('textbox', { name: 'Поле ввода сообщения' })
      await composer.fill('Ответь одним словом: текст.')
      const replies = boundaries.filter(item => item.type === 'claude.done').length
      await composer.press('Enter')
      await expect.poll(() => boundaries.filter(item => item.type === 'claude.done').length, { timeout: 120_000 }).toBeGreaterThan(replies)
      await renderer.screenshot({ path: join(ROOT, 'artifacts/onboarding/degraded-text.png') })
    } catch (error) {
      await mkdir(join(ROOT, 'artifacts/onboarding'), { recursive: true })
      await renderer.screenshot({ path: join(ROOT, 'artifacts/onboarding/real-voice-failure.png') })
      throw new Error(String(error) + '\nMedia failures: ' + mediaFailures.join(', ') + '\nBoundaries: ' + JSON.stringify(boundaries) + '\nWizard status: ' + (await renderer.getByRole('status').allTextContents()).join('; '))
    } finally {
      await voiceBrowser.close()
      await synthesis.cancel(sample.runId)
    }
  }, 420_000)
})
