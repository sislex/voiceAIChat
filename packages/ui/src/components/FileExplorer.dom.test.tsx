import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
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
    write: vi.fn().mockResolvedValue(listing),
    remove: vi.fn().mockResolvedValue(listing),
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

  it('без allowWrite кнопки мутаций скрыты', async () => {
    const ops = makeOps()
    render(<FileExplorer agents={[agent(false)]} initialAgentId="m1" ops={ops} variant="embedded" />)
    await screen.findByText(/a\.txt/)
    expect(screen.queryByRole('button', { name: /Загрузить/ })).toBeNull()
    expect(screen.queryByTitle('Удалить')).toBeNull()
    expect(screen.getByTitle('Скачать')).toBeInTheDocument()
  })
})
