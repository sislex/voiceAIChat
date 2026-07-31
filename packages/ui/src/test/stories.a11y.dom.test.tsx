// Прогон витрины через axe: каждая сториз рендерится в jsdom и проверяется тем
// же конфигом, что экраны в dom-тестах. Отдельный test-runner для Storybook не
// нужен — сториз это обычные функции, `composeStories` применяет к ним
// декораторы и параметры из `.storybook/preview.tsx` (тема, провайдеры
// примитивов, фейковые мосты window.*).
//
// Смысл: новая сториз попадает под проверку сама, без правки этого файла. Порог
// здесь мягче, чем у экранов, — только serious/critical: витрина показывает и
// заведомо неполные состояния (одна карточка задачи без доски вокруг, один
// лозенг без таблицы), и придирки уровня moderate относятся к обвязке сториз, а
// не к компоненту.

/// <reference types="vite/client" />
import { describe, expect, it } from 'vitest'
import { render } from '@testing-library/react'
import { composeStories, setProjectAnnotations } from '@storybook/react'
import previewAnnotations from '../../.storybook/preview'
import { expectNoCriticalViolations } from './a11y'

// Декораторы и globals витрины — те же, что в браузере.
setProjectAnnotations([previewAnnotations])

/**
 * Все сториз пакета. Foundations исключены осознанно: витрина основы читает
 * токены через getComputedStyle и CSS.supports, а в jsdom нет ни каскада, ни
 * этого API — сториз показала бы «Читаем токены…» и проверять было бы нечего.
 * Контраст токенов гейтит styles/contrast.test.ts, разметку витрины — сборка
 * Storybook (`npm run build:storybook`).
 */
const modules = import.meta.glob<Record<string, unknown>>('../components/**/*.stories.tsx', { eager: true })

const stories = Object.entries(modules).flatMap(([path, module]) => {
  const file = path.replace('../', '')
  return Object.entries(composeStories(module as Parameters<typeof composeStories>[0])).map(
    ([name, Story]) => [`${file} › ${name}`, Story as () => JSX.Element] as const
  )
})

describe('сториз', () => {
  it('витрина не пуста — иначе прогон «зелёный» ни на чём', () => {
    expect(stories.length).toBeGreaterThan(100)
  })

  it.each(stories)('%s — без serious/critical нарушений', async (_name, Story) => {
    render(<Story />)
    // Проверяем документ целиком: окна (Dialog, PromptBuilder) уходят порталом
    // в document.body, вне контейнера рендера.
    await expectNoCriticalViolations()
  })
})
