// This integration acceptance suite requires real authenticated Voice and LLM services.
import { spawn, execFileSync, type ChildProcess } from 'node:child_process'
import { RemoteTtsClient } from '../apps/server/src/tts/client/remoteTtsClient'
import { encodeWav } from '@sislexa/voice/stt-runner/run/wav'
import { floatTo16BitPCM, resampleLinear } from '@sislexa/voice/browser/audio/pcm'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { chromium } from 'playwright'

const ROOT = resolve(__dirname, '..')
const WEB_DIST = join(ROOT, 'node_modules/@sislexa/core-ui/web')
const PORT = 9091 + Math.floor(Math.random() * 60)
const BASE = `http://127.0.0.1:${PORT}`
const PASSWORD = 'e2e-settings-pass'

let server: ChildProcess | null = null
let dataDir = ''
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


describe('Live voice boundary acceptance', () => {
  beforeAll(async () => {
    if (!existsSync(WEB_DIST)) throw new Error('Build apps/web before live voice QA')
    dataDir = await mkdtemp(join(tmpdir(), 'vc-qa-live-voice-'))
    server = startServer()
    await waitHealth()
    const login = await fetch(`${BASE}/api/session/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'admin', password: PASSWORD }) })
    token = ((await login.json()) as { token: string }).token
    expect(token).toBeTruthy()
  })
  afterAll(async () => {
    server?.kill('SIGTERM')
    if (server) await waitDown()
    if (dataDir) await rm(dataDir, { recursive: true, force: true })
  })

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
