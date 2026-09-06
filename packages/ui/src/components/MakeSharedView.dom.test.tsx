import { describe, expect, it, vi } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { render } from '../test/uiRender'
import { createFakeApi } from '../test/fakeApi'
import { MakeSharedView } from './MakeSharedView'

describe('MakeSharedView', () => {
  // @testCase TC-12
  it('показывает заголовок, превью по share-адресу, файлы только для чтения и снимки', async () => {
    const api = createFakeApi([])
    await api['make:state']({ conversationId: 'make-1' })
    await api['make:snapshot']({ conversationId: 'make-1', label: 'v1' })
    const onBack = vi.fn()
    render(<MakeSharedView token="share123" api={api} onBack={onBack} />)
    expect(await screen.findByText('Проект 1')).toBeInTheDocument()
    expect(screen.getByText(/только чтение · admin/)).toBeInTheDocument()
    expect(screen.getByLabelText('Стек проекта')).toHaveTextContent('HTML+CSS+JS · своя система')
    expect((screen.getByTitle('Превью проекта (только чтение)') as HTMLIFrameElement).src).toContain('/api/preview/make-shared/share123/index.html')
    await userEvent.click(screen.getByRole('tab', { name: 'Код' }))
    const editor = await screen.findByLabelText('Содержимое index.html') as HTMLTextAreaElement
    expect(editor.readOnly).toBe(true)
    expect(editor.value).toContain('<!doctype html>')
    await userEvent.click(screen.getByRole('tab', { name: 'Снимки' }))
    expect(await screen.findByText('v1')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: '← Назад' }))
    expect(onBack).toHaveBeenCalled()
  })

  it('недействительная ссылка — состояние ошибки с повтором', async () => {
    render(<MakeSharedView token="bad" api={createFakeApi([])} onBack={() => {}} />)
    await waitFor(() => expect(screen.getByText('Проект недоступен')).toBeInTheDocument())
  })

  it('редактор по именному доступу правит файл и сохраняет через make:write (roadmap-3 п.6)', async () => {
    const api = createFakeApi([])
    await api['make:state']({ conversationId: 'make-1' })
    await api['make:shareGrant']({ conversationId: 'make-1', user: 'admin', role: 'editor' })
    render(<MakeSharedView token="share123" api={api} onBack={() => {}} />)
    expect(await screen.findByText(/редактор · admin/)).toBeInTheDocument()
    await userEvent.click(screen.getByRole('tab', { name: 'Код' }))
    const editor = await screen.findByLabelText('Содержимое index.html') as HTMLTextAreaElement
    expect(editor.readOnly).toBe(false)
    await userEvent.clear(editor)
    await userEvent.type(editor, '<h1>edited</h1>')
    await userEvent.click(screen.getByRole('button', { name: 'Сохранить' }))
    await waitFor(async () => expect((await api['make:read']({ conversationId: 'make-1', path: 'index.html' })).content).toBe('<h1>edited</h1>'))
  })
})
