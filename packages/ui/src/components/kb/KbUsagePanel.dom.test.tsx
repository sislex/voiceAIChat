import { describe, it, expect, vi, afterEach } from 'vitest'
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expectLabelledIconButtons, expectNoViolations } from '../../test/a11y'
import { KbUsagePanel } from './KbUsagePanel'
import { emptyKbUsageCache } from '../../lib/kbUsage'
import { makeKbProjectCache, makeKbQuery, makeKbStatus, makeKbUsageCache } from '../../test/fixtures'

afterEach(cleanup)

function renderPanel(props: Partial<Parameters<typeof KbUsagePanel>[0]> = {}): { onLoad: ReturnType<typeof vi.fn>; onLoadProject: ReturnType<typeof vi.fn>; onClose: ReturnType<typeof vi.fn> } {
  const onLoad = vi.fn()
  const onLoadProject = vi.fn()
  const onClose = vi.fn()
  render(
    <KbUsagePanel
      conversationId="c1"
      projectId="p1"
      cache={makeKbUsageCache()}
      kbStatus={makeKbStatus()}
      onLoad={onLoad}
      onLoadProject={onLoadProject}
      onClose={onClose}
      {...props}
    />
  )
  return { onLoad, onLoadProject, onClose }
}

describe('KbUsagePanel — загрузка снапшота', () => {
  it('просит снапшот чата один раз при открытии', () => {
    const { onLoad } = renderPanel()
    expect(onLoad).toHaveBeenCalledWith('c1')
    expect(onLoad).toHaveBeenCalledTimes(1)
  })

  it('кнопка «Обновить» перечитывает снапшот', async () => {
    const { onLoad } = renderPanel()
    await userEvent.click(screen.getByRole('button', { name: 'Обновить' }))
    expect(onLoad).toHaveBeenCalledTimes(2)
  })

  it('вкладка «По проекту» грузит агрегат только при переключении', async () => {
    const { onLoadProject } = renderPanel({ projectCache: makeKbProjectCache() })
    expect(onLoadProject).not.toHaveBeenCalled()
    await userEvent.click(screen.getByRole('tab', { name: 'По проекту' }))
    expect(onLoadProject).toHaveBeenCalledWith('p1')
    expect(screen.getByTestId('kb-usage-mode')).toHaveTextContent('Чатов с обращениями: 2')
    // Проектный агрегат показывает и число чатов на раздел.
    expect(within(screen.getByTestId('kb-usage-sections')).getAllByRole('columnheader').map((c) => c.textContent)).toContain('чатов')
  })
})

describe('KbUsagePanel — числа и разделы', () => {
  it('сводка показывает символы, оценку токенов и оговорку про биллинг', () => {
    renderPanel()
    const summary = screen.getByLabelText('Сводка использования базы знаний')
    expect(summary).toHaveTextContent('обращений')
    expect(summary).toHaveTextContent('символов')
    expect(summary).toHaveTextContent('≈ токенов')
    expect(screen.getByTestId('kb-usage-estimate-note')).toHaveTextContent('оценка по символам')
  })

  it('таблица объявляет сортировку через aria-sort и меняет её по клику', async () => {
    renderPanel()
    const table = screen.getByTestId('kb-usage-sections')
    const header = (label: string): HTMLElement =>
      within(table).getAllByRole('columnheader').find((cell) => cell.textContent?.includes(label))!
    expect(header('обращений')).toHaveAttribute('aria-sort', 'descending')
    expect(header('символы')).toHaveAttribute('aria-sort', 'none')
    await userEvent.click(within(table).getByRole('button', { name: 'Сортировать по «символы»' }))
    expect(header('символы')).toHaveAttribute('aria-sort', 'descending')
    expect(header('обращений')).toHaveAttribute('aria-sort', 'none')
  })

  it('клик по названию раздела ведёт в базу знаний', async () => {
    const onOpenDocument = vi.fn()
    renderPanel({ onOpenDocument })
    const table = screen.getByTestId('kb-usage-sections')
    await userEvent.click(within(table).getAllByTitle(/Открыть «/)[0])
    expect(onOpenDocument).toHaveBeenCalledWith(expect.any(String), expect.any(String))
  })

  it('лента показывает «запрашивает…» для незавершённого обращения', () => {
    const cache = makeKbUsageCache({ recent: [makeKbQuery({ id: 'live', status: 'pending', chars: 0, sections: [] })] })
    renderPanel({ cache })
    expect(screen.getByTestId('kb-usage-feed')).toHaveTextContent('запрашивает…')
  })
})

describe('KbUsagePanel — пустые состояния', () => {
  it('mode=off объясняет причину и ведёт в настройки, но историю оставляет', async () => {
    const onOpenConversationSettings = vi.fn()
    renderPanel({ mode: 'off', onOpenConversationSettings })
    expect(screen.getByTestId('kb-usage-off')).toHaveTextContent('выключена для этого чата')
    // История есть — таблица разделов остаётся под баннером.
    expect(screen.getByTestId('kb-usage-sections')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Настройки разговора' }))
    expect(onOpenConversationSettings).toHaveBeenCalled()
  })

  it('недоступный индекс — это конфигурация, а не ошибка запроса', () => {
    renderPanel({ kbStatus: makeKbStatus({ available: false, documents: 0, chunks: 0 }) })
    expect(screen.getByTestId('kb-usage-unavailable')).toHaveTextContent('База знаний недоступна')
    expect(screen.queryByTestId('error-state')).not.toBeInTheDocument()
  })

  it('без обращений объясняет, когда они появятся', () => {
    renderPanel({ cache: makeKbUsageCache({ recent: [], totals: { queries: 0, delivered: 0, empty: 0, errors: 0, toolQueries: 0, sections: 0, documents: 0, chars: 0, estimatedTokens: 0, promptChars: 0, lastAt: null }, sections: [] }) })
    expect(screen.getByTestId('kb-usage-none')).toHaveTextContent('Обращений ещё не было')
  })

  it('вкладка проекта без projectId объясняет отсутствие привязки', async () => {
    renderPanel({ projectId: null })
    await userEvent.click(screen.getByRole('tab', { name: 'По проекту' }))
    expect(screen.getByTestId('kb-usage-no-project')).toHaveTextContent('не привязан к проекту')
  })

  it('чип «инструмент БЗ отключён администратором» виден при toolEnabled=false', () => {
    renderPanel({ mode: 'manual', cache: makeKbUsageCache({ kbContextMode: 'manual', toolEnabled: false }) })
    expect(screen.getByTestId('kb-usage-tool-off')).toBeInTheDocument()
    expect(screen.getByTestId('kb-usage-mode')).toHaveTextContent('по запросу модели')
  })

  it('скелетон до первого ответа, ошибка — с «Повторить»', async () => {
    const { onLoad } = renderPanel({ cache: { ...emptyKbUsageCache(), loading: true } })
    expect(screen.getAllByTestId('kb-usage-skeleton').length).toBeGreaterThan(0)
    cleanup()
    renderPanel({ cache: { ...emptyKbUsageCache(), error: 'HTTP 500' } })
    expect(screen.getByTestId('error-state')).toHaveTextContent('Не удалось прочитать статистику')
    await userEvent.click(screen.getByRole('button', { name: 'Повторить' }))
    expect(onLoad).toHaveBeenCalled()
  })
})

describe('KbUsagePanel — доступность и закрытие', () => {
  it('Esc закрывает панель', async () => {
    const { onClose } = renderPanel()
    await userEvent.keyboard('{Escape}')
    expect(onClose).toHaveBeenCalled()
  })

  it('крестик закрывает панель', async () => {
    const { onClose } = renderPanel()
    await userEvent.click(screen.getByLabelText('Закрыть'))
    expect(onClose).toHaveBeenCalled()
  })

  it('без нарушений axe и кнопки-иконки подписаны', async () => {
    renderPanel({ projectCache: makeKbProjectCache(), onOpenDocument: vi.fn(), onOpenKnowledgeBase: vi.fn() })
    await expectNoViolations()
    expectLabelledIconButtons()
  })
})
