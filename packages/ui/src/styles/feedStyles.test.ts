import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

// Слияние ветки CHAT-354 (мерж ae9164b3, между релизами 0.1.177 и 0.1.179) молча
// снесло из `app.css` блоки ленты сообщений, страницы консоли, экрана загрузки
// сессии и редактора инструкций. Разметка эти классы использовала дальше,
// поэтому на проде у ответов модели разъезжались шапка и подвал, а консоль
// рисовалась без раскладки. Поведенческие тесты этого не видят — они не смотрят
// на стили, — поэтому набор закреплён здесь отдельно.
const css = readFileSync(join(__dirname, 'app.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
const appTsx = readFileSync(join(__dirname, '..', 'App.tsx'), 'utf8')
const styled = (cls: string): boolean => new RegExp(`\\.${cls}(?![\\w-])`).test(css)

describe('стили, потерянные при слиянии CHAT-354', () => {
  it.each([
    // Шапка и подвал ответа модели.
    'msg-head', 'msg-head-right', 'msg-engine', 'msg-model', 'msg-start', 'msg-timer',
    'msg-view', 'msg-machine-head', 'mfoot-right', 'msgact-cost', 'msgact-sep', 'copymsg',
    // Страница консоли с ассистентом.
    'console-browser-pane', 'console-browser-viewport', 'console-pane-header',
    'console-pane-machine', 'console-reader-selector',
    // Экран проверки сессии, редактор инструкций, панель веб-превью.
    'auth-loading', 'auth-loading__spinner', 'instr-list', 'instr-item', 'instr-editor',
    'webpreview-tools'
  ])('класс .%s имеет правила', (cls) => {
    expect(styled(cls)).toBe(true)
  })

  it('пузырь сообщения — якорь для кнопки копирования', () => {
    // `.copymsg` позиционируется абсолютно; без `position: relative` у `.bub`
    // кнопка считается от дальнего предка и уезжает выше пузыря.
    const bub = /\.bub\s*\{[^}]*\}/.exec(css)?.[0] ?? ''
    expect(bub).toMatch(/position:\s*relative/)
  })

  it('страница консоли участвует в раскладке приложения', () => {
    // `app--console-reader` ставит `App.tsx` строкой в массиве классов, поэтому
    // поиск по `className="..."` его не находит — из правил раскладки он выпал
    // молча, и вся страница консоли осталась без сетки.
    expect(css).toMatch(/\.app--console-reader[^{]*\{[^}]*grid-template-columns/)
    expect(css).toMatch(/\.app--console-reader > \.chat-split/)
  })

  it('каждый модификатор .app-- из App.tsx имеет правила', () => {
    // Слепое пятно, из-за которого регресс и прожил три релиза: модификаторы
    // страницы перечислены строками в массиве классов, а не в `className="…"`,
    // поэтому ни один поиск по разметке их не находит. `app--console-reader`
    // вычеркнули из списка селекторов — страница осталась без сетки, и это
    // никак не проявилось ни в тестах, ни в типах.
    const used = [...new Set([...appTsx.matchAll(/'(app--[a-z-]+)'/g)].map((m) => m[1]))]
    expect(used.length).toBeGreaterThan(3)
    const orphans = used.filter((cls) => !new RegExp(`\\.${cls}(?![\\w-])`).test(css))
    expect(orphans).toEqual([])
  })

  it('лента сообщений позиционирована', () => {
    // Иначе абсолютные подсказки `.vc-sr-only` внутри сообщений считаются от
    // `.main` и раздувают scrollHeight колонки до высоты всей ленты.
    const scroll = /\.scroll\s*\{[^}]*\}/.exec(css)?.[0] ?? ''
    expect(scroll).toMatch(/position:\s*relative/)
  })
})
