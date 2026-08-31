// Сторож ленивых экранов главного бандла.
//
// Пять самых тяжёлых поверхностей приложения живут в своих чанках: раздел
// «Проекты» (доска, карточка задачи и все её панели), поверхность Reader, парк
// машин, утилиты машины и база знаний. Один статический `import` любой из них
// возвращает её в главный чанк — и это не видит ни typecheck, ни тесты, ни
// бюджет чанка целиком: он просто вырастет, и планку поднимут «под факт».
//
// Круг 5 снял так 123 КБ; сторож нужен, чтобы их не вернули по неосторожности.
//
// @vitest-environment node
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const app = readFileSync(fileURLToPath(new URL('./App.tsx', import.meta.url)), 'utf8')

/** Экран → путь, которым он обязан подключаться (`import(...)`, а не `from`). */
const LAZY: Array<readonly [string, string]> = [
  ['ProjectPage', './components/ProjectPage'],
  ['ProjectBoard', './components/ProjectBoard'],
  ['WebReaderFrame', '@voicechat/web-reader-app'],
  ['MachineStatus', './components/MachineStatus'],
  ['MachineUtility', './components/MachineUtility'],
  ['KnowledgeBase', './components/KnowledgeBase'],
  ['MakePane', './components/MakePane'],
  ['SettingsModal', './components/SettingsModal'],
  ['AccountPage', './components/AccountPage'],
  ['UsersAdmin', '@voicechat/admin-app'],
  ['SessionsDialogHost', './components/SessionsDialogHost'],
  ['TaskModal', './components/kanban/TaskModal'],
  ['ProjectSettings', './components/ProjectSettings'],
  ['BrowserSessionPane', './components/BrowserSessionPane']
]

describe('тяжёлые экраны не возвращаются в главный чанк', () => {
  it.each(LAZY)('%s объявлен через lazy(), а не statically', (name) => {
    expect(app, `${name} должен объявляться через lazy(...)`).toMatch(new RegExp(`const ${name} = lazy\\(`))
  })

  it.each(LAZY)('%s не импортируется статически из %s', (name, path) => {
    // Статический импорт значения из того же модуля сводит ленивый чанк на нет:
    // Rollup положит модуль в главный, а `import()` вернёт уже загруженное.
    const specifier = path.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const statics = [...app.matchAll(new RegExp(`^import (?!type )\\{([^}]*)\\} from '${specifier}'`, 'gm'))]
    const offenders = statics
      .map((match) => match[1]!.split(',').map((part) => part.trim()))
      .flat()
      .filter((part) => part === name || part.endsWith(` ${name}`))
    expect(offenders, `${name} тянется статически из ${path}`).toEqual([])
  })

  it('у каждого ленивого экрана есть Suspense с подписью ожидания', () => {
    // `Suspense` без fallback показывает пустоту вместо экрана: пользователь
    // видит белое место и не знает, что что-то грузится.
    const suspense = [...app.matchAll(/<Suspense fallback=\{([^]*?)\}>/g)]
    expect(suspense.length).toBeGreaterThanOrEqual(LAZY.length - 2)
    const empty = suspense.filter((match) => match[1]!.trim() === 'null')
    // `fallback={null}` допустим только у окна сессий: оно открывается из меню и
    // само по себе невидимо до готовности.
    expect(empty.length).toBeLessThanOrEqual(1)
  })
})

/**
 * Пакеты, которые хост подключает **только** через `import()`. Любой статический
 * импорт значения из такого пакета возвращает его целиком в главный чанк:
 * модуль, статически достижимый из входа, ложится в главный, а `import()`
 * отдаёт уже загруженное. Замер по sourcemap показал так 70 КБ админки и 60 КБ
 * профиля — из-за одного `parseAdminRoute`, взятого из индекса пакета.
 * `import type` безопасен: типы в рантайм не попадают.
 */
const LAZY_PACKAGES = ['@voicechat/admin-app', '@voicechat/web-reader-app']

describe('пакеты ленивых экранов не тянутся статически', () => {
  it.each(LAZY_PACKAGES)('%s подключается только через import()', (pkg) => {
    const specifier = pkg.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const statics = [...app.matchAll(new RegExp(`^import (?!type )[^']*from '${specifier}'`, 'gm'))]
    expect(statics.map((match) => match[0]), `${pkg} тянется статически`).toEqual([])
  })
})
