import { describe, it, expect, vi } from 'vitest'
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { render } from '../test/uiRender'
import { MakeProjectSyncDialog } from './MakeProjectSyncDialog'
import type { MakeProjectLinkInfo } from '@shared/make'

/** Мосты диалога: «диск машины» и связи в замыкании, как ведёт себя сервер. */
function makeApi(initialLinks: MakeProjectLinkInfo[] = []) {
  const links: MakeProjectLinkInfo[] = [...initialLinks]
  const pull = vi.fn(async ({ paths }: { paths: string[] }) => {
    for (const path of paths) links.push({ path, importedHash: `h-${path}`, importedAt: 1, status: 'same' })
    return { links: [...links], state: { rev: 1 } as never }
  })
  return {
    api: {
      'make:projectFiles': vi.fn(async ({ path }: { path?: string }) => path === 'src'
        ? [{ name: 'Button.jsx', path: 'src/Button.jsx', kind: 'file' as const, size: 10 }]
        : [
            { name: 'src', path: 'src', kind: 'dir' as const, size: 0 },
            { name: 'theme.css', path: 'theme.css', kind: 'file' as const, size: 5 }
          ]),
      'make:projectLinks': vi.fn(async () => [...links]),
      'make:projectPull': pull
    },
    pull
  }
}

describe('MakeProjectSyncDialog', () => {
  it('ходит по каталогам, копирует выбранное и показывает связи', async () => {
    const { api, pull } = makeApi()
    render(<MakeProjectSyncDialog conversationId="c1" api={api as never} onClose={vi.fn()} />)

    // Корень: каталог src и файл theme.css.
    const files = await screen.findByTestId('make-sync-files')
    fireEvent.click(within(files).getByRole('checkbox', { name: 'theme.css' }))
    // Заход в каталог и выбор компонента.
    fireEvent.click(within(files).getByRole('button', { name: '📁 src' }))
    fireEvent.click(await within(files).findByRole('checkbox', { name: 'Button.jsx' }))

    fireEvent.click(screen.getByRole('button', { name: 'Скопировать в Make (2)' }))
    await waitFor(() => expect(pull).toHaveBeenCalledWith({ conversationId: 'c1', paths: ['theme.css', 'src/Button.jsx'] }))
    const linksList = await screen.findByTestId('make-sync-links')
    expect(within(linksList).getAllByRole('listitem')).toHaveLength(2)
    expect(linksList.textContent).toContain('совпадает с проектом')
  })

  it('расхождение показывает словами и не предлагает записать в репозиторий', async () => {
    const { api } = makeApi([
      { path: 'theme.css', importedHash: 'h', importedAt: 1, status: 'both' }
    ])
    render(<MakeProjectSyncDialog conversationId="c1" api={api as never} onClose={vi.fn()} />)

    const linksList = await screen.findByTestId('make-sync-links')
    expect(linksList.textContent).toContain('конфликт')
    // Обратной записи у Make нет: общая копия проекта принадлежит git-потоку.
    expect(within(linksList).queryByRole('button', { name: 'Вернуть' })).toBeNull()
    expect(screen.queryByRole('button', { name: /Вернуть всё/ })).toBeNull()
  })

  it('машина недоступна — ошибка словами и «Повторить», а не пустой диалог', async () => {
    const api = {
      'make:projectFiles': vi.fn(async () => { throw new Error('Машина «Мак» offline.') }),
      'make:projectLinks': vi.fn(async () => []),
      'make:projectPull': vi.fn()
    }
    render(<MakeProjectSyncDialog conversationId="c1" api={api as never} onClose={vi.fn()} />)
    expect(await screen.findByText(/offline/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Повторить' })).toBeInTheDocument()
  })
})
