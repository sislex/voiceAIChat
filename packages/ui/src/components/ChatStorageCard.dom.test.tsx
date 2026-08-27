import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { ChatStorageCard } from './ChatStorageCard'
import type { ChatStorageView } from '@shared/projects'

const view: ChatStorageView = {
  conversationId: 'c1', machineId: 'm1', storageId: 's1', relativePath: 'chats/c1', rootPath: '/home/bob/ChatAI', status: 'ready',
  directories: { chatRoot: '/home/bob/ChatAI/chats/c1', attachments: '/home/bob/ChatAI/chats/c1/attachments', artifacts: '/home/bob/ChatAI/chats/c1/artifacts', generated: '/home/bob/ChatAI/chats/c1/.generated' }
}

describe('ChatStorageCard', () => {
  it('показывает абсолютный путь, копирует его и открывает проводник машины', async () => {
    const writeText = vi.fn(async () => {})
    Object.assign(navigator, { clipboard: { writeText } })
    const onOpenExplorer = vi.fn()
    render(<ChatStorageCard storage={view} machineName="Мак" onOpenExplorer={onOpenExplorer} />)
    expect(screen.getByTestId('chat-storage-card')).toHaveTextContent('/home/bob/ChatAI/chats/c1')
    expect(screen.getByText('доступно')).toBeInTheDocument()
    fireEvent.click(screen.getByText('Скопировать путь'))
    await waitFor(() => expect(writeText).toHaveBeenCalledWith('/home/bob/ChatAI/chats/c1'))
    expect(await screen.findByText('Скопировано')).toBeInTheDocument()
    fireEvent.click(screen.getByText('Открыть в проводнике'))
    expect(onOpenExplorer).toHaveBeenCalledWith('m1', '/home/bob/ChatAI/chats/c1')
  })

  it('офлайн-машина блокирует открытие проводника; без привязки — подсказка', () => {
    const onOpenExplorer = vi.fn()
    const { rerender } = render(<ChatStorageCard storage={{ ...view, status: 'offline' }} onOpenExplorer={onOpenExplorer} />)
    expect(screen.getByText('Открыть в проводнике')).toBeDisabled()
    rerender(<ChatStorageCard storage={null} />)
    expect(screen.getByTestId('chat-storage-empty')).toBeInTheDocument()
  })

  it('компактный чип в шапке показывает относительный путь и открывает проводник', () => {
    const onOpenExplorer = vi.fn()
    render(<ChatStorageCard compact storage={view} onOpenExplorer={onOpenExplorer} />)
    const chip = screen.getByTestId('chat-storage-chip')
    expect(chip).toHaveTextContent('chats/c1')
    fireEvent.click(chip)
    expect(onOpenExplorer).toHaveBeenCalledWith('m1', '/home/bob/ChatAI/chats/c1')
  })
})
