// Пересобирает только изменившееся приложение и его общие библиотеки. Оболочка
// не перезапускается; новая версия панели появляется после обновления страницы.
import { watch } from 'node:fs'
import { resolve, join } from 'node:path'
import { APPLICATION_CATALOG } from '../packages/shared/src/applicationCatalog.ts'
import { applicationBuildPaths } from './application-build.mjs'
import { buildApplicationFrontend } from './application-frontend.mjs'
const root = resolve(import.meta.dirname, '..'),
  args = process.argv.slice(2),
  ids = args.filter((arg) => !arg.startsWith('--'))
const apps = (
  ids.length
    ? ids
    : APPLICATION_CATALOG.filter((app) => app.frontend).map((app) => app.id)
).map((id) => {
  const app = APPLICATION_CATALOG.find((app) => app.id === id && app.frontend)
  if (!app) throw new Error('Нет frontend ' + id)
  return app
})
const pending = new Set(),
  watchers = []
let running = false,
  timer
async function pump() {
  if (running) return
  running = true
  try {
    while (pending.size) {
      const id = pending.values().next().value
      pending.delete(id)
      try {
        await buildApplicationFrontend(id)
      } catch (error) {
        console.error(`[frontend:${id}]`, error)
      }
    }
  } finally {
    running = false
  }
}
for (const app of apps) {
  if (!args.includes('--skip-initial')) pending.add(app.id)
  for (const path of applicationBuildPaths(app.id)) {
    watchers.push(
      watch(join(root, path), { recursive: true }, (_event, file) => {
        if (
          !file ||
          /(^|\/)(dist|node_modules|storybook-static)(\/|$)|\.(test|stories)\.|\.tsbuildinfo$/.test(
            file
          )
        )
          return
        pending.add(app.id)
        clearTimeout(timer)
        timer = setTimeout(() => void pump(), 150)
      })
    )
  }
}
await pump()
for (const signal of ['SIGINT', 'SIGTERM'])
  process.on(signal, () => {
    clearTimeout(timer)
    watchers.forEach((watcher) => watcher.close())
    process.exit(0)
  })
