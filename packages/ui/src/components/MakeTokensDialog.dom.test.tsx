import { describe, expect, it, vi } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { render } from '../test/uiRender'
import { createFakeApi } from '../test/fakeApi'
import { MakeTokensDialog } from './MakeTokensDialog'

const CONV = 'make-1'

describe('MakeTokensDialog', () => {
  it('без токенов предлагает создать tokens.css и подключает его в index.html', async () => {
    const api = createFakeApi([])
    const onWritten = vi.fn()
    render(<MakeTokensDialog conversationId={CONV} api={api} files={['index.html', 'styles.css']} onClose={() => {}} onWritten={onWritten} />)
    await userEvent.click(await screen.findByRole('button', { name: 'Создать tokens.css' }))
    await waitFor(() => expect(onWritten).toHaveBeenCalled())
    expect((await api['make:read']({ conversationId: CONV, path: 'tokens.css' })).content).toContain('--accent')
    const index = (await api['make:read']({ conversationId: CONV, path: 'index.html' })).content
    expect(index.indexOf('tokens.css')).toBeGreaterThan(-1)
    expect(index.indexOf('tokens.css')).toBeLessThan(index.indexOf('styles.css'))
    expect(await screen.findByRole('region', { name: 'Цвета' })).toBeInTheDocument()
  })

  it('правит значение токена на месте, добавляет и удаляет токены', async () => {
    const api = createFakeApi([])
    await api['make:write']({ conversationId: CONV, path: 'styles.css', content: `/* база */\n:root {\n  --accent: #4f7cff;\n  --gap: 8px;\n}\n.a { color: var(--accent) }\n` })
    const onWritten = vi.fn()
    render(<MakeTokensDialog conversationId={CONV} api={api} files={['index.html', 'styles.css']} onClose={() => {}} onWritten={onWritten} />)
    const gap = await screen.findByLabelText('Значение --gap')
    await userEvent.clear(gap)
    await userEvent.type(gap, '12px')
    await userEvent.click(screen.getByRole('button', { name: 'Сохранить (1)' }))
    await waitFor(async () => expect((await api['make:read']({ conversationId: CONV, path: 'styles.css' })).content).toBe(`/* база */\n:root {\n  --accent: #4f7cff;\n  --gap: 12px;\n}\n.a { color: var(--accent) }\n`))

    await userEvent.type(screen.getByLabelText('Имя нового токена'), 'radius')
    await userEvent.type(screen.getByLabelText('Значение нового токена'), '10px')
    await userEvent.click(screen.getByRole('button', { name: '+ Токен' }))
    await waitFor(async () => expect((await api['make:read']({ conversationId: CONV, path: 'styles.css' })).content).toContain('--radius: 10px;'))
    expect(within(screen.getByRole('region', { name: 'Размеры и отступы' })).getByLabelText('Значение --radius')).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Удалить --accent' }))
    await waitFor(async () => expect((await api['make:read']({ conversationId: CONV, path: 'styles.css' })).content).not.toContain('--accent: #4f7cff'))
  })
})

describe('MakeTokensDialog — контраст WCAG (roadmap-4 п.25)', () => {
  it('показывает пары текст/акцент × фон с коэффициентом и уровнем; правка черновика пересчитывает', async () => {
    const api = createFakeApi([])
    await api['make:write']({ conversationId: CONV, path: 'tokens.css', content: `:root {\n  --bg: #fff;\n  --fg: #1a1d23;\n  --accent: #e5484d;\n}\n` })
    render(<MakeTokensDialog conversationId={CONV} api={api} files={['index.html', 'tokens.css']} onClose={() => {}} onWritten={() => {}} />)
    const contrast = await screen.findByTestId('make-contrast')
    const rows = within(contrast).getAllByRole('listitem')
    expect(rows).toHaveLength(2)
    expect(rows[0]!.textContent).toContain('--accent')
    expect(rows[0]!.textContent).toContain('3.91:1')
    expect(rows[0]!.textContent).toContain('AA крупный')
    expect(rows[1]!.textContent).toContain('AAA')
    const accent = await screen.findByLabelText('Значение --accent')
    await userEvent.clear(accent)
    await userEvent.type(accent, '#7a0000')
    await waitFor(() => expect(within(screen.getByTestId('make-contrast')).getAllByRole('listitem')[0]!.textContent).toContain('AAA'))
  })
})

describe('MakeTokensDialog — импорт Figma и тёмная тема (roadmap-4 пп.26–27)', () => {
  it('JSON Tokens Studio дописывает токены в tokens.css; «Тёмная тема» добавляет блок [data-theme=dark]', async () => {
    const api = createFakeApi([])
    await api['make:write']({ conversationId: CONV, path: 'tokens.css', content: `:root {\n  --bg: #fff;\n  --fg: #1a1d23;\n}\n` })
    const onWritten = vi.fn()
    render(<MakeTokensDialog conversationId={CONV} api={api} files={['index.html', 'tokens.css']} onClose={() => {}} onWritten={onWritten} />)
    await screen.findByLabelText('Значение --bg')
    const file = new File([JSON.stringify({ brand: { accent: { value: '#e5484d', type: 'color' }, gap: { value: 12, type: 'spacing' } } })], 'tokens.json', { type: 'application/json' })
    await userEvent.upload(screen.getByTestId('make-figma-file'), file)
    await waitFor(async () => expect((await api['make:read']({ conversationId: CONV, path: 'tokens.css' })).content).toContain('--brand-accent: #e5484d'))
    expect((await api['make:read']({ conversationId: CONV, path: 'tokens.css' })).content).toContain('--brand-gap: 12px')
    await userEvent.click(await screen.findByRole('button', { name: 'Тёмная тема' }))
    await waitFor(async () => expect((await api['make:read']({ conversationId: CONV, path: 'tokens.css' })).content).toContain('[data-theme=dark] {'))
    const dark = (await api['make:read']({ conversationId: CONV, path: 'tokens.css' })).content.split('[data-theme=dark]')[1]!
    expect(dark).toMatch(/--bg: #[0-9a-f]{6};/)
    expect(dark).toMatch(/--brand-accent: #[0-9a-f]{6};/)
    expect(dark).not.toContain('--brand-gap')
    expect(onWritten).toHaveBeenCalledTimes(2)
  })
  it('невалидный JSON — тост без записи', async () => {
    const api = createFakeApi([])
    await api['make:write']({ conversationId: CONV, path: 'tokens.css', content: `:root {\n  --bg: #fff;\n}\n` })
    render(<MakeTokensDialog conversationId={CONV} api={api} files={['tokens.css']} onClose={() => {}} onWritten={() => {}} />)
    await screen.findByLabelText('Значение --bg')
    await userEvent.upload(screen.getByTestId('make-figma-file'), new File(['{'], 'bad.json', { type: 'application/json' }))
    await screen.findByText('Файл не является корректным JSON')
    expect((await api['make:read']({ conversationId: CONV, path: 'tokens.css' })).content).toBe(`:root {\n  --bg: #fff;\n}\n`)
  })
})
