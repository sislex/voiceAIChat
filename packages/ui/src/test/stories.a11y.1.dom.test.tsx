// Прогон витрины через axe, шард 1 из 3. Разбит на шарды, потому что Vitest
// параллелит по файлам: замеры и устройство — в storiesA11yShard.tsx.
//
// Порог здесь мягче, чем у экранов, — только serious/critical: витрина
// показывает и заведомо неполные состояния (одна карточка задачи без доски
// вокруг, один лозенг без таблицы), и придирки уровня moderate относятся к
// обвязке сториз, а не к компоненту.

/// <reference types="vite/client" />
import { collectShard, describeStoryShard } from './storiesA11yShard'

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

describeStoryShard('сториз, шард 1/3', await collectShard(modules, { index: 1, total: 3 }), 40)
