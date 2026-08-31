// Прогон витрины через axe, шард 0 из 3. Разбит на шарды, потому что Vitest
// параллелит по файлам: замеры и устройство — в storiesA11yShard.tsx.
//
// Порог здесь мягче, чем у экранов, — только serious/critical: витрина
// показывает и заведомо неполные состояния (одна карточка задачи без доски
// вокруг, один лозенг без таблицы), и придирки уровня moderate относятся к
// обвязке сториз, а не к компоненту.

/// <reference types="vite/client" />
import { expect, it } from 'vitest'
import { collectShard, describeStoryShard } from './storiesA11yShard'
import storybookMain from '../../.storybook/main'

/**
 * Глоб ленивый и покрывает всю витрину — и компоненты `packages/ui`, и сториз
 * пакетов-приложений; свою треть шард отбирает сам.
 *
 * Пакеты перечислены явно, а не маской по всем каталогам `packages`: такая
 * маска затянула бы `src/stories/foundations`, исключённые осознанно — они
 * читают токены через getComputedStyle и CSS.supports, а в jsdom нет ни
 * каскада, ни этого API. Контраст токенов гейтит styles/contrast.test.ts,
 * разметку витрины — сборка Storybook.
 */
const modules = import.meta.glob<Record<string, unknown>>([
  '../components/**/*.stories.tsx',
  '../../../{app-shell,chat-app,web-reader-app,playwright-reader-app,projects-app,operations-app,admin-app,sessions-app,profile-app}/src/**/*.stories.tsx'
])

// Сторож: новый пакет в витрине обязан попасть и под axe. Иначе повторится
// история, из-за которой этот прогон девять пакетов не проверял вовсе —
// экраны в Storybook есть, проверки нет.
it('глоб покрывает все пакеты-приложения из .storybook/main.ts', () => {
  const fromStorybook = (storybookMain.stories as string[])
    .map((pattern) => pattern.match(/^\.\.\/\.\.\/([^/]+)\/src\//)?.[1])
    .filter((name): name is string => Boolean(name))
  const globbed = new Set(
    Object.keys(modules).map((path) => path.match(/\.\.\/\.\.\/\.\.\/([^/]+)\//)?.[1]).filter(Boolean)
  )
  expect(fromStorybook.filter((name) => !globbed.has(name))).toEqual([])
})

describeStoryShard('сториз, шард 0/3', await collectShard(modules, { index: 0, total: 3 }), 40)
