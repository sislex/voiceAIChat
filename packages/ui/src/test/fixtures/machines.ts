// Фикстуры машин-агентов: телеметрия, парк машин, операции над файлами и фейковый
// PTY. Состояния, которые иначе воспроизводятся только живым агентом (офлайн,
// устаревшая версия, Android с батареей, забитый диск), здесь просто объекты.

import type {
  AgentCreated,
  AgentExecResult,
  AgentInfo,
  AgentPolicy,
  AgentTelemetry,
  FsEntry,
  FsResult
} from '@shared/agentProtocol'
import { DEFAULT_AGENT_POLICY } from '@shared/agentProtocol'
import { AGENT_VERSION } from '@shared/version'
import type { RendererPtyBridge } from '@shared/ipc'
import type { MachineOps } from '../../components/machine'
import { T0 } from './chat'

const GB = 1024 ** 3

/** Телеметрия онлайн-машины (Linux, половина памяти занята, диск свободен). */
export function makeTelemetry(over: Partial<AgentTelemetry> = {}): AgentTelemetry {
  return {
    ts: 1000,
    os: { platform: 'linux', release: '6.8', arch: 'x64', isAndroid: false },
    cpu: { count: 8, loadPct: 42 },
    mem: { totalBytes: 16 * GB, usedBytes: 8 * GB },
    disk: {
      root: { totalBytes: 100 * GB, freeBytes: 40 * GB },
      work: { totalBytes: 100 * GB, freeBytes: 55 * GB }
    },
    ...over
  }
}

/** Политика с заполненными списками — чтобы в карточке было что показывать. */
export function makePolicy(over: Partial<AgentPolicy> = {}): AgentPolicy {
  return {
    ...DEFAULT_AGENT_POLICY,
    allowedDirs: ['/home/dev/projects'],
    denyPatterns: ['rm\\s+-rf', 'sudo'],
    allowPatterns: [],
    skills: [
      { name: 'build', command: 'npm run build' },
      { name: 'gate', command: 'npm run typecheck && npm test' }
    ],
    ...over
  }
}

/** Машина в сети со свежим агентом. */
export function makeAgent(over: Partial<AgentInfo> = {}): AgentInfo {
  return {
    id: 'a1',
    name: 'Мак',
    online: true,
    createdAt: 0,
    lastSeen: 1,
    policy: { ...DEFAULT_AGENT_POLICY },
    version: '0.4.0',
    telemetry: makeTelemetry(),
    ...over
  }
}

/** Офлайн-машина: телеметрии и версии нет — сервер их не знает. */
export function makeOfflineAgent(over: Partial<AgentInfo> = {}): AgentInfo {
  const agent = makeAgent({
    id: 'a-off',
    name: 'Домашний ПК',
    online: false,
    lastSeen: T0 - 3 * 60 * 60 * 1000,
    ...over
  })
  delete agent.telemetry
  delete agent.version
  return agent
}

/**
 * Машина с устаревшим агентом: версия меньше серверной (`AGENT_VERSION`), поэтому
 * в строке появляются «устарел», «⧉ команда» и «⬆ обновить». Версию считаем от
 * серверной, а не пишем цифрами: иначе фикстура молча состарится вместе с релизом.
 */
export function makeOutdatedAgent(over: Partial<AgentInfo> = {}): AgentInfo {
  return makeAgent({ id: 'a-old', name: 'Сборочный сервер', version: '0.0.1', ...over })
}

/** Android-машина: батарея, arm64 и мало места в рабочем разделе. */
export function makeAndroidAgent(over: Partial<AgentInfo> = {}): AgentInfo {
  return makeAgent({
    id: 'a-droid',
    name: 'Pixel',
    version: AGENT_VERSION,
    telemetry: makeTelemetry({
      os: { platform: 'android', release: '14', arch: 'arm64', isAndroid: true },
      cpu: { count: 8, loadPct: 91 },
      mem: { totalBytes: 8 * GB, usedBytes: 7 * GB },
      disk: { root: { totalBytes: 128 * GB, freeBytes: 4 * GB }, work: { totalBytes: 128 * GB, freeBytes: 2 * GB } },
      battery: { percent: 12, charging: false }
    }),
    ...over
  })
}

/** Парк машин на все состояния строки таблицы (порядок = порядок в таблице). */
export function makeFleet(): AgentInfo[] {
  return [
    makeAgent({ id: 'm1', name: 'MacBook', version: AGENT_VERSION }),
    makeOutdatedAgent(),
    makeAndroidAgent(),
    makeOfflineAgent()
  ]
}

/** Ответ создания машины: токен отдаётся один раз. */
export function makeAgentCreated(over: Partial<AgentCreated> = {}): AgentCreated {
  return { id: 'a-new', name: 'Новая машина', token: 'tkn-0123456789abcdef', ...over }
}

/** Содержимое каталога для проводника. */
export function makeFsEntries(): FsEntry[] {
  return [
    { name: 'apps', kind: 'dir', size: 0, mtime: T0 - 86_400_000 },
    { name: 'packages', kind: 'dir', size: 0, mtime: T0 - 3_600_000 },
    { name: 'package.json', kind: 'file', size: 2_140, mtime: T0 - 7_200_000 },
    { name: 'README.md', kind: 'file', size: 18_930, mtime: T0 - 172_800_000 },
    { name: 'npm-debug.log', kind: 'file', size: 1_204_331, mtime: T0 - 600_000 }
  ]
}

/** Простая картинка (SVG), чтобы у сториз сообщения была настоящая графика. */
const PLOT_SVG = [
  '<svg xmlns="http://www.w3.org/2000/svg" width="480" height="240" viewBox="0 0 480 240">',
  '<rect width="480" height="240" fill="#0b0e14"/>',
  '<polyline fill="none" stroke="#5cc8ff" stroke-width="3" points="20,200 90,150 160,170 230,90 300,110 370,50 450,70"/>',
  '<line x1="20" y1="210" x2="460" y2="210" stroke="#3a4356" stroke-width="2"/>',
  '<line x1="20" y1="20" x2="20" y2="210" stroke="#3a4356" stroke-width="2"/>',
  '<text x="30" y="36" fill="#d7dce5" font-family="monospace" font-size="14">ходов в день</text>',
  '</svg>'
].join('')

/**
 * base64 из UTF-8-текста. Голый `btoa` тут не годится: в подписи графика есть
 * кириллица, а он умеет только latin1 и падает `InvalidCharacterError`.
 */
function base64Utf8(text: string): string {
  if (typeof btoa !== 'function') return ''
  let binary = ''
  for (const byte of new TextEncoder().encode(text)) binary += String.fromCharCode(byte)
  return btoa(binary)
}

/** Байты картинки в base64 — ровно в том виде, в каком их отдаёт агент. */
export const PLOT_SVG_BASE64 = base64Utf8(PLOT_SVG)

/**
 * Операции над машиной: всё асинхронно и без сети. По умолчанию проводник видит
 * `makeFsEntries()`, чтение отдаёт картинку, `exec` — правдоподобный вывод.
 * Тест подменяет нужную операцию своим `vi.fn()`, сториз — своей заглушкой.
 */
export function makeMachineOps(over: Partial<MachineOps> = {}): MachineOps {
  const result = (entries?: FsEntry[]): FsResult => ({
    root: '/home/dev',
    cwd: '/home/dev/voiceAIChat',
    ...(entries ? { entries } : {})
  })
  return {
    list: async () => result(makeFsEntries()),
    read: async () => ({ ...result(), dataBase64: PLOT_SVG_BASE64, name: 'plot.svg' }),
    write: async () => result(),
    remove: async () => result(),
    rename: async () => result(),
    mkdir: async () => result(),
    download: async () => {},
    upload: async () => result(),
    exec: async (_agentId: string, command: string): Promise<AgentExecResult> => ({
      exitCode: 0,
      output: `$ ${command}\nвыполнено на машине (фейковые операции сториз)\n`,
      timedOut: false
    }),
    ...over
  }
}

/**
 * Фейковый PTY: печатает приглашение и эхом возвращает ввод. Нужен, чтобы сториз
 * терминала показывала живой xterm, не открывая настоящий сеанс на машине.
 */
export function createFakePty(): RendererPtyBridge {
  const outputs = new Set<(m: { ptyId: string; data: string }) => void>()
  const emit = (ptyId: string, data: string): void => {
    for (const cb of outputs) cb({ ptyId, data })
  }
  return {
    start: ({ ptyId, cwd }) => {
      // Задержка нулевая, но через таймер: подписка на onOutput ставится после start.
      setTimeout(() => {
        emit(ptyId, `\u001b[32mvoicechat-agent\u001b[0m: сеанс открыт${cwd ? ` в ${cwd}` : ''}\r\n`)
        emit(ptyId, `${cwd ?? '~'}$ `)
      }, 0)
    },
    input: ({ ptyId, data }) => {
      if (data === '\r') emit(ptyId, '\r\nфейковый PTY сториз: команды не выполняются\r\n$ ')
      else emit(ptyId, data)
    },
    resize: () => {},
    kill: () => {},
    onOutput: (cb) => {
      outputs.add(cb)
      return () => outputs.delete(cb)
    },
    onExit: () => () => {},
    onError: () => () => {}
  }
}
