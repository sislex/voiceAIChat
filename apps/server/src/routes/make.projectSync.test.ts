// Обмен мастерской с репозиторием проекта: копирование компонентов и стилей
// из рабочей директории машины (pull), правка в Make и возврат обратно (push).
// Машина — фейковый файловый мост: важно поведение сервера (пути, хеши,
// конфликты), а не транспорт агента.
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Fastify, { type FastifyInstance } from 'fastify'
import { VoiceChatDb } from '../db/database.js'
import { MakeWorkspaces } from '../make/workspace.js'
import { MakeHub } from '../make/hub.js'
import { MakeLibrary } from '../make/library.js'
import { registerMakeRoutes } from './make.js'

const U = 'admin'
let app: FastifyInstance
let db: VoiceChatDb
let workspaces: MakeWorkspaces
let dataDir: string
let convId: string
/** «Диск машины»: путь → содержимое. Абсолютные пути от корня /repo. */
let machineDisk: Map<string, string>
let machineWrites: Array<{ path: string; content: string }>
let online = true

function fakeMachineFs() {
  return {
    async list(_agentId: string, path: string) {
      const prefix = path === '/repo' ? '/repo/' : `${path}/`
      const names = new Map<string, 'dir' | 'file'>()
      for (const key of machineDisk.keys()) {
        if (!key.startsWith(prefix)) continue
        const rest = key.slice(prefix.length)
        const head = rest.split('/')[0]!
        names.set(head, rest.includes('/') ? 'dir' : 'file')
      }
      return {
        root: '/repo', cwd: path,
        entries: [...names.entries()].map(([name, kind]) => ({ name, kind, size: 10, mtime: 0 }))
      }
    },
    async read(_agentId: string, path: string) {
      const content = machineDisk.get(path)
      if (content === undefined) throw new Error(`нет файла ${path}`)
      return { root: '/repo', cwd: path, dataBase64: Buffer.from(content, 'utf8').toString('base64') }
    },
    async write(_agentId: string, path: string, dataBase64: string) {
      const content = Buffer.from(dataBase64, 'base64').toString('utf8')
      machineDisk.set(path, content)
      machineWrites.push({ path, content })
      return { root: '/repo', cwd: path }
    },
    isOnline: () => online
  }
}

beforeEach(async () => {
  dataDir = mkdtempSync(join(tmpdir(), 'make-sync-'))
  db = new VoiceChatDb(':memory:')
  db.createUser(U, '', 'admin')
  workspaces = new MakeWorkspaces(join(dataDir, 'make'))
  machineDisk = new Map([
    ['/repo/src/components/Button.jsx', 'export const Button = () => <button>Ok</button>'],
    ['/repo/src/components/Card.jsx', 'export const Card = () => <div/>'],
    ['/repo/styles/theme.css', ':root { --accent: #06c; }'],
    ['/repo/README.md', 'readme']
  ])
  machineWrites = []
  online = true

  const project = db.createProject(U, { name: 'Проект' })
  const agent = db.createAgent(U, 'Машина')
  db.linkMachine(U, project.id, agent.id)
  db.setProjectMachinePath(U, project.id, agent.id, '/repo')
  convId = db.createConversation(U, 'Витрина', 'make', project.id)!.id

  app = Fastify()
  app.decorateRequest('user', null)
  app.addHook('preHandler', async (req) => { (req as unknown as { user: { name: string } }).user = { name: U } })
  registerMakeRoutes(app, {
    db, workspaces, hub: new MakeHub(), library: new MakeLibrary(dataDir),
    machineFs: fakeMachineFs()
  })
  await app.ready()
})
afterEach(async () => {
  await app.close()
  db.close()
  rmSync(dataDir, { recursive: true, force: true })
})

describe('make: обмен с репозиторием проекта', () => {
  it('листинг машины скрывает служебное и ходит по подкаталогам', async () => {
    machineDisk.set('/repo/.git/config', 'x')
    machineDisk.set('/repo/node_modules/react/index.js', 'x')
    const root = (await app.inject({ method: 'GET', url: `/api/make/${convId}/project-files` })).json()
    expect(root.map((entry: { name: string }) => entry.name).sort()).toEqual(['README.md', 'src', 'styles'])
    const src = (await app.inject({ method: 'GET', url: `/api/make/${convId}/project-files?path=src/components` })).json()
    expect(src.map((entry: { path: string }) => entry.path)).toEqual(['src/components/Button.jsx', 'src/components/Card.jsx'])
  })

  it('pull копирует файлы в мастерскую и заводит связи со статусом same', async () => {
    const res = await app.inject({ method: 'POST', url: `/api/make/${convId}/project-pull`, payload: {
      paths: ['src/components/Button.jsx', 'styles/theme.css']
    } })
    expect(res.statusCode).toBe(200)
    const { links } = res.json()
    expect(links.map((link: { path: string; status: string }) => [link.path, link.status])).toEqual([
      ['src/components/Button.jsx', 'same'],
      ['styles/theme.css', 'same']
    ])
    // Файл действительно в мастерской и с тем же содержимым.
    const copied = await workspaces.read(convId, 'src/components/Button.jsx')
    expect(copied.content).toContain('export const Button')
  })

  it('правка в Make делает edited_in_make; push возвращает файл и обновляет хеш', async () => {
    await app.inject({ method: 'POST', url: `/api/make/${convId}/project-pull`, payload: { paths: ['styles/theme.css'] } })
    await workspaces.write(convId, 'styles/theme.css', ':root { --accent: #f00; }')

    const links = (await app.inject({ method: 'GET', url: `/api/make/${convId}/project-links` })).json()
    expect(links[0]).toMatchObject({ path: 'styles/theme.css', status: 'edited_in_make' })

    const push = await app.inject({ method: 'POST', url: `/api/make/${convId}/project-push`, payload: {} })
    expect(push.statusCode).toBe(200)
    expect(push.json().pushed).toEqual(['styles/theme.css'])
    // Файл на машине заменён правкой из Make…
    expect(machineDisk.get('/repo/styles/theme.css')).toContain('#f00')
    // …и связь снова «совпадает»: хеш обновлён на возвращённое содержимое.
    expect(push.json().links[0].status).toBe('same')
  })

  it('push без force отклоняется, если файл в проекте изменился после копирования', async () => {
    await app.inject({ method: 'POST', url: `/api/make/${convId}/project-pull`, payload: { paths: ['styles/theme.css'] } })
    await workspaces.write(convId, 'styles/theme.css', ':root { --accent: #f00; }')
    // Кто-то поменял файл в репозитории.
    machineDisk.set('/repo/styles/theme.css', ':root { --accent: #0c6; } /* чужая правка */')

    const blocked = await app.inject({ method: 'POST', url: `/api/make/${convId}/project-push`, payload: {} })
    expect(blocked.statusCode).toBe(409)
    expect(blocked.json().conflicts).toEqual(['styles/theme.css'])
    expect(machineWrites).toEqual([]) // ничего не записано

    const forced = await app.inject({ method: 'POST', url: `/api/make/${convId}/project-push`, payload: { force: true } })
    expect(forced.statusCode).toBe(200)
    expect(machineDisk.get('/repo/styles/theme.css')).toContain('#f00')
  })

  it('пути с .. и абсолютные отклоняются, офлайн-машина — честная ошибка', async () => {
    const bad = await app.inject({ method: 'POST', url: `/api/make/${convId}/project-pull`, payload: { paths: ['../secrets.txt'] } })
    expect(bad.statusCode).toBe(400)
    const abs = await app.inject({ method: 'POST', url: `/api/make/${convId}/project-pull`, payload: { paths: ['/etc/passwd'] } })
    expect(abs.statusCode).toBe(400)

    online = false
    const off = await app.inject({ method: 'GET', url: `/api/make/${convId}/project-files` })
    expect(off.statusCode).toBe(409)
    expect(off.json().error).toContain('offline')
  })

  it('чат без проекта получает объяснение, а не 500', async () => {
    const solo = db.createConversation(U, 'Без проекта', 'make', null)!.id
    const res = await app.inject({ method: 'GET', url: `/api/make/${solo}/project-links` })
    expect(res.statusCode).toBe(409)
    expect(res.json().error).toContain('не привязан к проекту')
  })
})
