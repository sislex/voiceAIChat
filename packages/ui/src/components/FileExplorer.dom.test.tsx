import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { FileExplorer, type FileExplorerProps } from './FileExplorer'
import type { FsEntry } from '@shared/agentProtocol'

const entries: FsEntry[] = [
  { name: 'sub', kind: 'dir', size: 0, mtime: 1 },
  { name: 'a.txt', kind: 'file', size: 1234, mtime: 2 }
]

function renderFs(props: Partial<FileExplorerProps> = {}): FileExplorerProps {
  const full: FileExplorerProps = {
    agents: [
      { id: 'm1', name: 'Мак', online: true, createdAt: 1, lastSeen: null, policy: { allowedDirs: [], allowNetwork: true, allowWrite: true, denyPatterns: [], allowPatterns: [], skills: [] } }
    ],
    agentId: 'm1',
    root: '/home/u',
    cwd: '/home/u',
    entries,
    error: null,
    writable: true,
    onSelectAgent: vi.fn(),
    onNavigate: vi.fn(),
    onDownload: vi.fn(),
    onUpload: vi.fn(),
    onDelete: vi.fn(),
    onRename: vi.fn(),
    onMkdir: vi.fn(),
    onClose: vi.fn(),
    ...props
  }
  render(<FileExplorer {...full} />)
  return full
}

describe('FileExplorer', () => {
  it('рендерит содержимое каталога', () => {
    renderFs()
    expect(screen.getAllByTestId('fs-row')).toHaveLength(2)
  })

  it('клик по папке зовёт onNavigate с абсолютным путём', async () => {
    const p = renderFs()
    await userEvent.click(screen.getByText(/sub/))
    expect(p.onNavigate).toHaveBeenCalledWith('/home/u/sub')
  })

  it('скачивание файла зовёт onDownload', async () => {
    const p = renderFs()
    await userEvent.click(screen.getByTitle('Скачать'))
    expect(p.onDownload).toHaveBeenCalledWith('/home/u/a.txt', 'a.txt')
  })

  it('без writable кнопки мутаций скрыты', () => {
    renderFs({ writable: false })
    expect(screen.queryByRole('button', { name: /Загрузить/ })).toBeNull()
    expect(screen.queryByTitle('Удалить')).toBeNull()
    // Скачивание доступно всегда.
    expect(screen.getByTitle('Скачать')).toBeInTheDocument()
  })
})
