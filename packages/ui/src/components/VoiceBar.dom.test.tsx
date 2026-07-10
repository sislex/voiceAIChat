import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { VoiceBar } from './VoiceBar'
import '../styles/app.css'

function setup(state: Parameters<typeof VoiceBar>[0]['state'], overrides = {}) {
  const props = {
    state,
    draft: '',
    diarization: true,
    detectedSpeakers: [1, 2],
    onDraftChange: vi.fn(),
    onSubmitText: vi.fn(),
    onStartVoice: vi.fn(),
    onStopVoice: vi.fn(),
    onStopSpeak: vi.fn(),
    attachments: [],
    onCancelRequest: vi.fn(),
    onAddFiles: vi.fn(),
    onRemoveAttachment: vi.fn(),
    ...overrides
  }
  render(<VoiceBar {...props} />)
  return props
}

describe('VoiceBar — состояния', () => {
  it('idle: инпут и кнопка микрофона', () => {
    setup('idle')
    expect(screen.getByLabelText('Поле ввода сообщения')).toBeInTheDocument()
    expect(screen.getByLabelText('Говорить')).toBeInTheDocument()
  })

  it('listening: волна, кнопка стоп, строка обнаруженных спикеров', () => {
    setup('listening')
    expect(screen.getByTestId('wave')).toBeInTheDocument()
    expect(screen.getByLabelText('Остановить запись')).toBeInTheDocument()
    expect(screen.getByTestId('spkline')).toHaveTextContent('Обнаружено говорящих')
    expect(screen.getByText('Спикер 1')).toBeInTheDocument()
    expect(screen.getByText('Спикер 2')).toBeInTheDocument()
  })

  it('thinking: карточка «Запрос отправлен…»', () => {
    setup('thinking')
    expect(screen.getByText('Запрос отправлен в Claude Console…')).toBeInTheDocument()
  })

  it('speaking: эквалайзер, надпись и кнопка стоп', () => {
    setup('speaking')
    expect(screen.getByText('Claude отвечает голосом…')).toBeInTheDocument()
    expect(screen.getByText('TTS · локально')).toBeInTheDocument()
    expect(screen.getByLabelText('Остановить озвучку')).toBeInTheDocument()
  })

  it('diarization off: подпись «Вы» вместо «Спикер N»', () => {
    setup('listening', { diarization: false, detectedSpeakers: [1] })
    expect(screen.getByText('Вы')).toBeInTheDocument()
    expect(screen.queryByText('Спикер 1')).not.toBeInTheDocument()
  })

  it('клик по микрофону вызывает onStartVoice', async () => {
    const props = setup('idle')
    await userEvent.click(screen.getByLabelText('Говорить'))
    expect(props.onStartVoice).toHaveBeenCalledOnce()
  })

  it('Enter в непустом инпуте вызывает onSubmitText', async () => {
    const props = setup('idle', { draft: 'привет' })
    const input = screen.getByLabelText('Поле ввода сообщения')
    input.focus()
    await userEvent.keyboard('{Enter}')
    expect(props.onSubmitText).toHaveBeenCalledOnce()
  })

  it('Enter в пустом инпуте ничего не отправляет', async () => {
    const props = setup('idle', { draft: '   ' })
    screen.getByLabelText('Поле ввода сообщения').focus()
    await userEvent.keyboard('{Enter}')
    expect(props.onSubmitText).not.toHaveBeenCalled()
  })
})
