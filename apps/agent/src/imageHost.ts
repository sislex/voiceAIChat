// Раздача картинок с машины по HTTP. Сервер приложения кладёт сюда файлы,
// созданные моделью (`fs.write` в `<rootDir>/.generated_images`), а браузер
// тянет их напрямую с машины — байты не идут через сервер второй раз.
//
// Отдельного веб-сервера ставить не нужно: агент — это Node-процесс, поэтому
// поднимаем встроенный `node:http`. Никаких зависимостей, работает и в Termux,
// и в самодостаточном `voicechat-agent.cjs` (esbuild его бандлит как есть).
//
// Отдаём ТОЛЬКО файлы, лежащие непосредственно в этом каталоге: имя из URL
// сверяется с реальным содержимым каталога, поэтому ни `..`, ни симлинк наружу
// не сработают. Метод — только GET/HEAD.

import { createServer } from 'node:http'
import { createReadStream, existsSync, mkdirSync, readdirSync, realpathSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { networkInterfaces } from 'node:os'

/** Каталог с картинками внутри корня проводника машины. */
export const IMAGE_DIR_NAME = '.generated_images'

/** Порт по умолчанию; занят — берём эфемерный (о фактическом сообщаем серверу). */
const DEFAULT_PORT = 8788

const MIME: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  svg: 'image/svg+xml',
  bmp: 'image/bmp',
  avif: 'image/avif'
}

function mimeOf(name: string): string {
  const ext = name.slice(name.lastIndexOf('.') + 1).toLowerCase()
  return MIME[ext] ?? 'application/octet-stream'
}

/** IPv4-адреса машины без loopback. Первым — не-виртуальный интерфейс. */
export function localAddresses(): string[] {
  const out: string[] = []
  for (const [name, list] of Object.entries(networkInterfaces())) {
    for (const ni of list ?? []) {
      if (ni.family !== 'IPv4' || ni.internal) continue
      // docker/bridge/veth обычно недоступны браузеру — двигаем в конец списка.
      const virtual = /^(docker|br-|veth|virbr|tun|tap)/i.test(name)
      if (virtual) out.push(ni.address)
      else out.unshift(ni.address)
    }
  }
  return out
}

export interface ImageHost {
  /** Фактический порт (может отличаться от желаемого, если тот занят). */
  port: number
  /** Каталог, из которого идёт раздача. */
  dir: string
  stop(): void
}

/**
 * Поднимает раздачу `<rootDir>/.generated_images` (каталог создаётся, если его
 * нет). Возвращает null, если порт поднять не удалось — агент продолжает
 * работать, а картинки просто пойдут прежним путём (через сервер).
 */
export async function startImageHost(
  rootDir: string,
  port = Number(process.env.VC_AGENT_IMAGE_PORT) || DEFAULT_PORT
): Promise<ImageHost | null> {
  const dir = join(rootDir, IMAGE_DIR_NAME)
  try {
    mkdirSync(dir, { recursive: true })
  } catch (err) {
    console.error('[agent] не удалось создать каталог картинок:', err)
    return null
  }

  const server = createServer((req, res) => {
    // Картинку тянет страница с другого origin (сервер приложения), плюс
    // fetch для «скачать»/«копировать» — без этого заголовка он не пройдёт.
    res.setHeader('access-control-allow-origin', '*')
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405).end()
      return
    }
    const name = decodeURIComponent((req.url ?? '/').split('?')[0].replace(/^\//, ''))
    // Имя должно буквально совпадать с элементом каталога — так обход путей
    // («..», вложенные каталоги, симлинки) отсекается без разбора строк.
    let entries: string[]
    try {
      entries = readdirSync(dir)
    } catch {
      res.writeHead(404).end()
      return
    }
    if (!name || !entries.includes(name)) {
      res.writeHead(404).end()
      return
    }
    const file = join(dir, name)
    let size: number
    try {
      const realDir = realpathSync(dir)
      const realFile = realpathSync(file)
      const separator = realDir.endsWith('/') || realDir.endsWith('\\') ? '' : realDir.includes('\\') && !realDir.includes('/') ? '\\' : '/'
      if (!realFile.startsWith(realDir + separator)) throw new Error('выход за каталог картинок')
      const st = statSync(realFile)
      if (!st.isFile()) throw new Error('не файл')
      size = st.size
    } catch {
      res.writeHead(404).end()
      return
    }
    res.writeHead(200, {
      'content-type': mimeOf(name),
      'content-length': String(size),
      // Имя файла уникально (id вызова модели) — можно кэшировать надолго.
      'cache-control': 'public, max-age=31536000, immutable'
    })
    if (req.method === 'HEAD') {
      res.end()
      return
    }
    createReadStream(file).pipe(res)
  })

  const listen = (p: number): Promise<number> =>
    new Promise((resolve, reject) => {
      const onError = (err: NodeJS.ErrnoException): void => reject(err)
      server.once('error', onError)
      server.listen(p, '0.0.0.0', () => {
        server.off('error', onError)
        const addr = server.address()
        resolve(typeof addr === 'object' && addr ? addr.port : p)
      })
    })

  let actual: number
  try {
    actual = await listen(port)
  } catch {
    // Порт занят (напр. второй агент на той же машине) — берём любой свободный.
    try {
      actual = await listen(0)
    } catch (err) {
      console.error('[agent] раздача картинок не поднялась:', err)
      return null
    }
  }

  console.log(`[agent] картинки раздаются на :${actual} из ${dir}`)
  return {
    port: actual,
    dir,
    stop: () => server.close()
  }
}

/** Есть ли уже поднятая раздача (для диагностики в трее/логах). */
export function imageDirOf(rootDir: string): string {
  return join(rootDir, IMAGE_DIR_NAME)
}

/** Проверка «каталог на месте» — используется при переподключении. */
export function ensureImageDir(rootDir: string): boolean {
  const dir = imageDirOf(rootDir)
  if (existsSync(dir)) return true
  try {
    mkdirSync(dir, { recursive: true })
    return true
  } catch {
    return false
  }
}
