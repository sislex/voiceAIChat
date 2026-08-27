import { describe, it, expect, vi } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { FileExplorer } from './FileExplorer'
import type { AgentInfo } from '@shared/agentProtocol'
import type { MachineOps } from './machine'

const policy = (allowWrite: boolean) => ({
  allowedDirs: [],
  allowNetwork: true,
  allowWrite,
  denyPatterns: [],
  allowPatterns: [],
  skills: []
})

const encodeBase64 = (text: string) => btoa(String.fromCharCode(...new TextEncoder().encode(text)))

const decodeBase64 = (value: string) =>
  new TextDecoder().decode(new Uint8Array(Array.from(atob(value), (char) => char.charCodeAt(0))))
const agent = (allowWrite = true): AgentInfo => ({
  id: 'm1',
  name: 'Мак',
  online: true,
  createdAt: 1,
  lastSeen: null,
  policy: policy(allowWrite)
})

function makeOps(): MachineOps {
  const listing = {
    root: '/r',
    cwd: '/r',
    entries: [
      { name: 'sub', kind: 'dir' as const, size: 0, mtime: 1 },
      { name: 'a.txt', kind: 'file' as const, size: 1234, mtime: 2 }
    ]
  }
  return {
    list: vi.fn().mockResolvedValue(listing),
    read: vi.fn().mockResolvedValue(listing),
    write: vi.fn().mockResolvedValue(listing),
    remove: vi.fn().mockResolvedValue(listing),
    trash: vi.fn().mockResolvedValue({ ...listing, trashedPath: '/r/.voicechat_trash/20260828-101112__a.txt' }),
    rename: vi.fn().mockResolvedValue(listing),
    mkdir: vi.fn().mockResolvedValue(listing),
    download: vi.fn().mockResolvedValue(undefined),
    upload: vi.fn().mockResolvedValue(listing),
    exec: vi.fn().mockResolvedValue({ exitCode: 0, output: '', timedOut: false })
  }
}

describe('FileExplorer (самодостаточный)', () => {
  it('листит корень при монтировании', async () => {
    const ops = makeOps()
    render(<FileExplorer agents={[agent()]} initialAgentId="m1" ops={ops} variant="embedded" />)
    expect(await screen.findByText(/a\.txt/)).toBeInTheDocument()
    expect(ops.list).toHaveBeenCalledWith('m1', '')
  })

  it('объясняет переподключение офлайн-машины и не листит её', () => {
    const ops = makeOps()
    render(<FileExplorer agents={[{ ...agent(), online: false }]} initialAgentId="m1" ops={ops} variant="embedded" />)

    expect(screen.getByText('Машина «Мак» переподключается')).toBeInTheDocument()
    expect(ops.list).not.toHaveBeenCalled()
    expect(screen.getByLabelText('Адрес папки')).toBeDisabled()
  })

  it('клик по папке листит её абсолютный путь', async () => {
    const ops = makeOps()
    render(<FileExplorer agents={[agent()]} initialAgentId="m1" ops={ops} variant="embedded" />)
    await userEvent.click(await screen.findByText(/sub/))
    expect(ops.list).toHaveBeenCalledWith('m1', '/r/sub')
  })

  it('скачивание файла зовёт ops.download', async () => {
    const ops = makeOps()
    render(<FileExplorer agents={[agent()]} initialAgentId="m1" ops={ops} variant="embedded" />)
    await screen.findByText(/a\.txt/)
    await userEvent.click(screen.getByTitle('Скачать'))
    expect(ops.download).toHaveBeenCalledWith('m1', '/r/a.txt', 'a.txt')
  })

  it('путь файла открывает родительскую папку и выделяет файл', async () => {
    const ops = makeOps()
    render(<FileExplorer agents={[agent()]} initialAgentId="m1" initialFilePath="/r/a.txt" ops={ops} variant="embedded" />)
    expect(await screen.findByText(/a\.txt/)).toBeInTheDocument()
    expect(ops.list).toHaveBeenCalledWith('m1', '/r')
    expect(screen.getByText(/a\.txt/).closest('[data-testid="fs-row"]')).toHaveAttribute('data-selected', 'true')
  })

  it('переключатель шапки передаёт машину и текущую папку', async () => {
    const open = vi.fn()
    render(<FileExplorer agents={[agent()]} initialAgentId="m1" ops={makeOps()} variant="embedded" onSwitchUtility={open} />)
    await screen.findByText(/a\.txt/)
    await userEvent.click(screen.getByRole('button', { name: /Терминал/ }))
    expect(open).toHaveBeenCalledWith('console', 'm1', '/r')
  })

  it('без allowWrite кнопки мутаций скрыты, но объяснено почему', async () => {
    const ops = makeOps()
    render(<FileExplorer agents={[agent(false)]} initialAgentId="m1" ops={ops} variant="embedded" />)
    await screen.findByText(/a\.txt/)
    expect(screen.queryByRole('button', { name: /Загрузить/ })).toBeNull()
    expect(screen.queryByTitle('Удалить')).toBeNull()
    expect(screen.getByTitle('Скачать')).toBeInTheDocument()
    // Пустое место на панели читалось как «функции нет»: теперь там причина.
    expect(screen.getByTestId('fs-readonly')).toHaveAttribute('title', expect.stringContaining('запрещены её политикой'))
  })


  it('позволяет вставить адрес и перейти по Enter', async () => {
    const ops = makeOps()
    render(<FileExplorer agents={[agent()]} initialAgentId="m1" ops={ops} variant="embedded" />)
    const address = await screen.findByLabelText('Адрес папки')
    await userEvent.clear(address)
    await userEvent.type(address, '/srv/project{Enter}')
    await waitFor(() => expect(ops.list).toHaveBeenCalledWith('m1', '/srv/project'))
  })

  it('initialDir открывает проводник ВНУТРИ указанной папки', async () => {
    const ops = makeOps()
    render(<FileExplorer agents={[agent()]} initialAgentId="m1" initialDir="/srv/proj" ops={ops} />)
    await waitFor(() => expect(ops.list).toHaveBeenCalledWith('m1', '/srv/proj'))
  })

  it('фильтрует уже полученный список без нового запроса', async () => {
    const ops = makeOps()
    render(<FileExplorer agents={[agent()]} initialAgentId="m1" ops={ops} variant="embedded" />)
    await screen.findByText(/a\.txt/)
    await userEvent.type(screen.getByLabelText('Фильтр по имени'), 'sub')
    expect(screen.getByText(/sub/)).toBeInTheDocument()
    expect(screen.queryByText(/a\.txt/)).toBeNull()
    expect(ops.list).toHaveBeenCalledTimes(1)
    await userEvent.clear(screen.getByLabelText('Фильтр по имени'))
    await userEvent.type(screen.getByLabelText('Фильтр по имени'), 'nothing')
    expect(screen.getByText('Ничего не найдено')).toBeInTheDocument()
  })

  it('сортирует размер в обе стороны, сохраняя папки первыми', async () => {
    const ops = makeOps()
    vi.mocked(ops.list).mockResolvedValue({
      root: '/r',
      cwd: '/r',
      entries: [
        { name: 'folder', kind: 'dir', size: 0, mtime: 1 },
        { name: 'small.txt', kind: 'file', size: 10, mtime: 2 },
        { name: 'large.txt', kind: 'file', size: 1000, mtime: 3 }
      ]
    })
    render(<FileExplorer agents={[agent()]} initialAgentId="m1" ops={ops} variant="embedded" />)
    await screen.findByText(/large\.txt/)
    await userEvent.selectOptions(screen.getByLabelText('Сортировать по'), 'size')
    expect(screen.getAllByTestId('fs-row').map((row) => row.querySelector('.fsname')?.textContent)).toEqual(
      ['📁 folder', '📄 small.txt', '📄 large.txt']
    )
    await userEvent.click(screen.getByLabelText('Сортировка по возрастанию'))
    expect(screen.getAllByTestId('fs-row').map((row) => row.querySelector('.fsname')?.textContent)).toEqual(
      ['📁 folder', '📄 large.txt', '📄 small.txt']
    )
  })

  it('показывает кликабельные крошки от корня', async () => {
    const ops = makeOps()
    vi.mocked(ops.list).mockResolvedValue({ root: '/r', cwd: '/r/one/two', entries: [] })
    render(<FileExplorer agents={[agent()]} initialAgentId="m1" ops={ops} variant="embedded" />)
    expect(await screen.findByRole('button', { name: 'Корень: /r' })).toHaveClass('fscrumb-link--root')
    await userEvent.click(screen.getByRole('button', { name: 'one' }))
    expect(ops.list).toHaveBeenCalledWith('m1', '/r/one')
  })

  it('ходит по строкам клавиатурой и открывает папку по Enter', async () => {
    const ops = makeOps()
    render(<FileExplorer agents={[agent()]} initialAgentId="m1" ops={ops} variant="embedded" />)
    const list = await screen.findByTestId('fs-list')
    list.focus()
    await userEvent.keyboard('{ArrowDown}')
    expect(screen.getByText(/sub/).closest('[data-testid="fs-row"]')).toHaveAttribute('data-selected', 'true')
    await userEvent.keyboard('{Enter}')
    expect(ops.list).toHaveBeenCalledWith('m1', '/r/sub')
  })

  it('загружает несколько файлов дропом и объясняет запрет записи', async () => {
    const ops = makeOps()
    render(<FileExplorer agents={[agent()]} initialAgentId="m1" ops={ops} variant="embedded" />)
    const list = await screen.findByTestId('fs-list')
    fireEvent.drop(list, { dataTransfer: { files: [new File(['one'], 'one.txt'), new File(['two'], 'two.txt')] } })
    await waitFor(() => expect(ops.upload).toHaveBeenCalledTimes(2))
    expect(ops.upload).toHaveBeenCalledWith('m1', '/r', expect.objectContaining({ name: 'one.txt' }))

    const readonlyOps = makeOps()
    render(<FileExplorer agents={[agent(false)]} initialAgentId="m1" ops={readonlyOps} variant="embedded" />)
    const readonlyList = (await screen.findAllByTestId('fs-list'))[1]
    fireEvent.drop(readonlyList, { dataTransfer: { files: [new File(['blocked'], 'blocked.txt')] } })
    expect(await screen.findByText(/blocked\.txt: Загрузка запрещена/)).toBeInTheDocument()
    expect(readonlyOps.upload).not.toHaveBeenCalled()
  })

  it('открывает текстовый файл без скачивания', async () => {
    const ops = makeOps()
    vi.mocked(ops.read).mockResolvedValue({ root: '/r', cwd: '/r', name: 'a.txt', dataBase64: btoa(String.fromCharCode(...new TextEncoder().encode('Привет'))) })
    render(<FileExplorer agents={[agent()]} initialAgentId="m1" ops={ops} variant="embedded" />)
    await userEvent.click(await screen.findByText(/a\.txt/))
    expect(await screen.findByText('Привет')).toBeInTheDocument()
    expect(ops.read).toHaveBeenCalledWith('m1', '/r/a.txt')
    expect(ops.download).not.toHaveBeenCalled()
  })

  it('не показывает бинарный файл и предлагает скачать его', async () => {
    const ops = makeOps()
    vi.mocked(ops.read).mockResolvedValue({ root: '/r', cwd: '/r', name: 'a.txt', dataBase64: btoa(String.fromCharCode(0, 1)) })
    render(<FileExplorer agents={[agent()]} initialAgentId="m1" ops={ops} variant="embedded" />)
    await userEvent.click(await screen.findByText(/a\.txt/))
    expect(await screen.findByText(/Предпросмотр недоступен/)).toBeInTheDocument()
    const preview = screen.getByLabelText('Предпросмотр файла')
    await userEvent.click(within(preview).getByRole('button', { name: /Скачать/ }))
    expect(ops.download).toHaveBeenCalledWith('m1', '/r/a.txt', 'a.txt')
  })

  it('сохраняет отредактированный текст и перечитывает каталог', async () => {
    const ops = makeOps()
    vi.mocked(ops.read).mockResolvedValue({ root: '/r', cwd: '/r', name: 'a.txt', dataBase64: encodeBase64('до') })
    render(<FileExplorer agents={[agent()]} initialAgentId="m1" ops={ops} variant="embedded" />)
    await userEvent.click(await screen.findByText(/a\.txt/))
    await userEvent.click(await screen.findByRole('button', { name: 'Редактировать' }))
    const editor = screen.getByLabelText('Содержимое файла')
    await userEvent.clear(editor)
    await userEvent.type(editor, 'после')
    await userEvent.click(screen.getByRole('button', { name: 'Сохранить' }))
    await userEvent.click(screen.getByRole('button', { name: 'Подтвердить сохранение' }))
    await waitFor(() => expect(ops.write).toHaveBeenCalledWith('m1', '/r/a.txt', expect.any(String)))
    expect(decodeBase64(vi.mocked(ops.write).mock.calls[0]?.[2] ?? '')).toBe('после')
    expect(ops.list).toHaveBeenCalledTimes(2)
  })

  it('удаление на новом агенте идёт в корзину, а «Вернуть» переименовывает обратно', async () => {
    const ops = makeOps()
    render(<FileExplorer agents={[{ ...agent(), version: '0.15.0' }]} initialAgentId="m1" ops={ops} variant="embedded" />)
    await screen.findByText(/a\.txt/)
    await userEvent.click(screen.getByLabelText('Удалить a.txt'))
    await userEvent.click(screen.getByRole('button', { name: 'В корзину' }))
    await waitFor(() => expect(ops.trash).toHaveBeenCalledWith('m1', '/r/a.txt'))
    expect(ops.remove).not.toHaveBeenCalled()
    expect(await screen.findByTestId('fs-trashed')).toHaveTextContent('перемещён в корзину')
    await userEvent.click(screen.getByRole('button', { name: 'Вернуть' }))
    await waitFor(() => expect(ops.rename).toHaveBeenCalledWith('m1', '/r/.voicechat_trash/20260828-101112__a.txt', '/r/a.txt'))
  })

  it('старый агент без корзины удаляет безвозвратно', async () => {
    const ops = makeOps()
    render(<FileExplorer agents={[{ ...agent(), version: '0.14.0' }]} initialAgentId="m1" ops={ops} variant="embedded" />)
    await screen.findByText(/a\.txt/)
    await userEvent.click(screen.getByLabelText('Удалить a.txt'))
    await userEvent.click(screen.getByRole('button', { name: 'Удалить' }))
    await waitFor(() => expect(ops.remove).toHaveBeenCalledWith('m1', '/r/a.txt'))
    expect(ops.trash).not.toHaveBeenCalled()
  })

  it('в режиме правки можно показать diff относительно открытого файла', async () => {
    const ops = makeOps()
    ;(ops.read as ReturnType<typeof vi.fn>).mockResolvedValue({ root: '/r', cwd: '/r', name: 'a.txt', dataBase64: btoa('hello') })
    render(<FileExplorer agents={[agent()]} initialAgentId="m1" ops={ops} variant="embedded" />)
    await userEvent.click(await screen.findByText(/a\.txt/))
    await userEvent.click(await screen.findByRole('button', { name: 'Редактировать' }))
    expect(screen.queryByRole('button', { name: 'Показать изменения' })).toBeNull()
    const editor = screen.getByLabelText('Содержимое файла')
    await userEvent.clear(editor)
    await userEvent.type(editor, 'hello world')
    await userEvent.click(screen.getByRole('button', { name: 'Показать изменения' }))
    expect(screen.getByTestId('fs-diff')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Скрыть изменения' }))
    expect(screen.queryByTestId('fs-diff')).toBeNull()
  })
})
