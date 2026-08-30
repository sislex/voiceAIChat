// Тестовые идентификаторы на пути автотеста.
//
// Reader записывает шаги селекторами и честно помечает надёжность: без
// `data-testid` селектор строится по пути в дереве (`div > div > form > button`)
// и ломается от вставки любого соседнего узла. Измерение круга 16: на самом
// проходимом пути — форме входа — их не было ни одного, поэтому все записанные
// там сценарии были заведомо ломкими.
//
// Соглашение: `<экран>-<роль>` в kebab-case, без индексов и без текста подписи —
// подпись меняется, роль нет.
//
// @vitest-environment node
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const read = (name: string): string => readFileSync(fileURLToPath(new URL(`./${name}`, import.meta.url)), 'utf8')

/** Экран → идентификаторы, без которых сценарий не записать устойчиво. */
const REQUIRED: Array<{ file: string; ids: string[] }> = [
  { file: 'LoginScreen.tsx', ids: ['login-form', 'login-username', 'login-password', 'login-submit', 'login-error', 'login-remember', 'login-toggle-password'] },
  { file: 'Sidebar.tsx', ids: ['create-project', 'search-conversations', 'search-projects', 'project-item', 'account-avatar'] },
  // Доска была покрыта и до круга 16 — сторожим, чтобы покрытие не пропало при
  // правках вёрстки: именно на ней записывается большинство сценариев.
  { file: 'kanban/KanbanBoard.tsx', ids: ['kanban-board', 'kanban-column', 'board-filters'] },
  { file: 'kanban/TaskCard.tsx', ids: ['task-card'] }
]

describe('идентификаторы на пути автотеста', () => {
  for (const { file, ids } of REQUIRED) {
    it(`${file}: на месте`, () => {
      const source = read(file)
      const missing = ids.filter((id) => !source.includes(`data-testid="${id}"`))
      expect(missing, 'Пропавший идентификатор делает записанные сценарии ломкими').toEqual([])
    })
  }

  it('именование единообразно: kebab-case без индексов', () => {
    const all = REQUIRED.flatMap(({ file }) => [...read(file).matchAll(/data-testid="([^"{]+)"/g)].map((m) => m[1]))
    const odd = all.filter((id) => !/^[a-z][a-z0-9]*(-[a-z0-9]+)*$/.test(id))
    expect(odd).toEqual([])
  })
})
