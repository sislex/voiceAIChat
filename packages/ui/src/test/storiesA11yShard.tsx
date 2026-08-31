import { describe, expect, it } from 'vitest'
import { render } from '@testing-library/react'
import { composeStories, setProjectAnnotations } from '@storybook/react'
import previewAnnotations from '../../.storybook/preview'
import { expectNoCriticalViolations } from './a11y'

// Декораторы и globals витрины — те же, что в браузере. Вызывается один раз на
// процесс; шарды живут в разных файлах, значит в разных воркерах.
setProjectAnnotations([previewAnnotations])

type StoryModules = Record<string, () => Promise<unknown>>

/**
 * Один шард прогона витрины через axe.
 *
 * Зачем шарды: 457 проверок жили в одном файле, а Vitest параллелит по файлам,
 * не по тестам. Замер: `packages/ui` целиком 72 с, без этого файла 53 с, сам
 * файл 24 с — то есть его время почти не перекрывалось с остальными 148
 * файлами и ложилось в конец прогона.
 *
 * Глоб в вызывающем файле остаётся **ленивым** (без `eager`) и покрывает всю
 * витрину: шард отбирает свою долю путей по остатку от деления и грузит только
 * их. Так сохраняется главное свойство прежнего файла — новая сториз попадает
 * под проверку сама, без правки списка, — и при этом каждый шард импортирует
 * лишь треть модулей.
 */
export async function collectShard(
  modules: StoryModules,
  { index, total }: { index: number; total: number }
): Promise<Array<readonly [string, () => JSX.Element]>> {
  const paths = Object.keys(modules).sort().filter((_, position) => position % total === index)
  const loaded = await Promise.all(paths.map(async (path) => {
    const module = await modules[path]()
    return Object.entries(composeStories(module as Parameters<typeof composeStories>[0])).map(
      ([name, Story]) => [`${path.replace('../', '')} › ${name}`, Story as () => JSX.Element] as const
    )
  }))
  return loaded.flat()
}

/** Тесты шарда: непустота и axe по каждой сториз. */
export function describeStoryShard(
  label: string,
  stories: Array<readonly [string, () => JSX.Element]>,
  minimum: number
): void {
  describe(label, () => {
    it('шард не пуст — иначе прогон «зелёный» ни на чём', () => {
      expect(stories.length).toBeGreaterThan(minimum)
    })

    it.each(stories)('%s — без serious/critical нарушений', async (_name, Story) => {
      render(<Story />)
      // Проверяем документ целиком: окна (Dialog, PromptBuilder) уходят порталом
      // в document.body, вне контейнера рендера.
      await expectNoCriticalViolations()
    })
  })
}
