import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ChatColumn } from './ChatColumn'
import type { Message } from '@shared/types'

const messages: Message[] = [
  { id: 'u1', conversationId: 'c', role: 'u1', text: 'Вопрос', time: '10:00', createdAt: 1 },
  { id: 'a1', conversationId: 'c', role: 'ai', text: 'Ответ **жирный**', time: '10:01', createdAt: 2 }
]

function renderCol(props: Partial<Parameters<typeof ChatColumn>[0]> = {}): void {
  render(
    <ChatColumn
      title="Тест"
      state="idle"
      messages={messages}
      liveSegments={[]}
      diarization={false}
      voiceBar={null}
      {...props}
    />
  )
}

describe('ChatColumn — кнопка озвучки ответа', () => {
  it('кнопка есть только у AI-сообщений при canSpeak', () => {
    renderCol({ canSpeak: true, onSpeakMessage: vi.fn() })
    // одна кнопка «Озвучить ответ» — только у ai-сообщения
    expect(screen.getAllByLabelText('Озвучить ответ')).toHaveLength(1)
  })

  it('без canSpeak кнопки нет', () => {
    renderCol({ canSpeak: false, onSpeakMessage: vi.fn() })
    expect(screen.queryByLabelText('Озвучить ответ')).not.toBeInTheDocument()
  })

  it('клик зовёт onSpeakMessage с id и текстом ответа', async () => {
    const onSpeak = vi.fn()
    renderCol({ canSpeak: true, onSpeakMessage: onSpeak })
    await userEvent.click(screen.getByLabelText('Озвучить ответ'))
    expect(onSpeak).toHaveBeenCalledWith('a1', 'Ответ **жирный**')
  })

  it('у озвучиваемого сообщения кнопка становится «Остановить озвучку»', () => {
    renderCol({ canSpeak: true, onSpeakMessage: vi.fn(), speakingMessageId: 'a1' })
    expect(screen.getByLabelText('Остановить озвучку')).toBeInTheDocument()
  })
})

describe('ChatColumn — копирование ответа', () => {
  it('кнопка копирования есть у AI-ответа и копирует его текст', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.assign(navigator, { clipboard: { writeText } })
    renderCol()
    const btn = screen.getByLabelText('Копировать ответ')
    await userEvent.click(btn)
    expect(writeText).toHaveBeenCalledWith('Ответ **жирный**')
  })

  it('у сообщения пользователя кнопки копирования нет', () => {
    renderCol()
    expect(screen.getAllByLabelText('Копировать ответ')).toHaveLength(1) // только ai
  })
})

describe('ChatColumn — экспорт разговора', () => {
  it('меню экспорта: Markdown/JSON зовут onExport с форматом', async () => {
    const onExport = vi.fn()
    renderCol({ onExport })
    await userEvent.click(screen.getByLabelText('Экспорт разговора'))
    const menu = screen.getByTestId('export-menu')
    await userEvent.click(screen.getByText('Markdown (.md)'))
    expect(onExport).toHaveBeenCalledWith('md')

    await userEvent.click(screen.getByLabelText('Экспорт разговора'))
    await userEvent.click(screen.getByText('JSON (.json)'))
    expect(onExport).toHaveBeenCalledWith('json')
    void menu
  })

  it('показывает мету хода под последним ответом ассистента', () => {
    renderCol({ turnMeta: { durationMs: 7200, numTurns: 2, costUsd: 0.0131 } })
    const meta = screen.getByTestId('turn-meta')
    expect(meta.textContent).toContain('7.2с')
    expect(meta.textContent).toContain('2 хода')
    expect(meta.textContent).toContain('$0.0131')
  })

  it('без сообщений кнопки экспорта нет', () => {
    render(
      <ChatColumn
        title="Пусто"
        state="idle"
        messages={[]}
        liveSegments={[]}
        diarization={false}
        onExport={vi.fn()}
        voiceBar={null}
      />
    )
    expect(screen.queryByLabelText('Экспорт разговора')).not.toBeInTheDocument()
  })
})

describe('ChatColumn — переименование разговора по заголовку', () => {
  it('клик по заголовку открывает поле, Enter сохраняет новое имя', async () => {
    const onRename = vi.fn()
    renderCol({ onRenameTitle: onRename })
    await userEvent.click(screen.getByText('Тест'))
    const input = screen.getByLabelText('Новое название разговора')
    await userEvent.clear(input)
    await userEvent.type(input, 'Новое имя{Enter}')
    expect(onRename).toHaveBeenCalledWith('Новое имя')
  })

  it('Escape отменяет редактирование, onRenameTitle не зовётся', async () => {
    const onRename = vi.fn()
    renderCol({ onRenameTitle: onRename })
    await userEvent.click(screen.getByText('Тест'))
    await userEvent.keyboard('{Escape}')
    expect(onRename).not.toHaveBeenCalled()
    expect(screen.getByText('Тест')).toBeInTheDocument()
  })

  it('пустое имя не сохраняется', async () => {
    const onRename = vi.fn()
    renderCol({ onRenameTitle: onRename })
    await userEvent.click(screen.getByText('Тест'))
    const input = screen.getByLabelText('Новое название разговора')
    await userEvent.clear(input)
    await userEvent.keyboard('{Enter}')
    expect(onRename).not.toHaveBeenCalled()
  })

  it('без onRenameTitle клик не открывает редактирование', async () => {
    renderCol()
    await userEvent.click(screen.getByText('Тест'))
    expect(screen.queryByLabelText('Новое название разговора')).not.toBeInTheDocument()
  })
})

describe('ChatColumn — кнопка меню (мобильный сайдбар)', () => {
  it('клик по ☰ зовёт onToggleSidebar', async () => {
    const onToggle = vi.fn()
    renderCol({ onToggleSidebar: onToggle })
    await userEvent.click(screen.getByLabelText('Меню разговоров'))
    expect(onToggle).toHaveBeenCalledTimes(1)
  })

  it('без onToggleSidebar кнопки нет', () => {
    renderCol()
    expect(screen.queryByLabelText('Меню разговоров')).not.toBeInTheDocument()
  })
})
