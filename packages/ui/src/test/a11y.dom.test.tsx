// Страж правила packages/ui/AGENTS.md: «кнопка без видимой подписи обязана иметь
// и aria-label, и title». До этого правило держалось на ревью и на типах
// IconButton — но обычный <button> с глифом типы не ловят, а иконка внутри
// .vc-btn__ico не считается подписью.
//
// Здесь два вида проверок: сам страж на выдуманной разметке (падает ли он,
// когда атрибут убрали) и он же на настоящих экранах — там правило и должно
// работать. Прогон по экранам живёт в их же dom-тестах рядом с axe.

import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import {
  expectLabelledIconButtons,
  expectNoCriticalViolations,
  expectNoViolations,
  iconButtonProblems
} from './a11y'
import { IconButton } from '@voicechat/ui-kit'
import { Button } from '@voicechat/ui-kit'
import { LoginScreen } from '../components/LoginScreen'

describe('страж icon-only кнопок', () => {
  it('IconButton проходит: у него оба атрибута обязательны по типам', () => {
    const { container } = render(
      <IconButton aria-label="Закрыть окно" title="Закрыть">
        ✕
      </IconButton>
    )
    expect(iconButtonProblems(container)).toEqual([])
  })

  it('падает без aria-label, без title и без обоих', () => {
    const { container } = render(
      <>
        <button type="button">✕</button>
        <button type="button" aria-label="Удалить">
          ✕
        </button>
        <button type="button" title="Удалить">
          ✕
        </button>
      </>
    )
    expect(iconButtonProblems(container).map((p) => p.missing)).toEqual([
      ['aria-label', 'title'],
      ['title'],
      ['aria-label']
    ])
    expect(() => expectLabelledIconButtons(container)).toThrow(/без видимой подписи/)
  })

  it('кнопка с текстом атрибутов не требует — тултип у неё дублирует подпись', () => {
    const { container } = render(
      <>
        <Button>Сохранить</Button>
        <Button iconLeft={<span aria-hidden="true">💬</span>}>Чат</Button>
      </>
    )
    expect(iconButtonProblems(container)).toEqual([])
  })

  it('иконкой считается и глиф, и svg, и всё aria-hidden — подписью они не станут', () => {
    const { container } = render(
      <>
        {/* Глиф без букв: читалка прочитает «крестик» или промолчит. */}
        <button type="button">⋯</button>
        <button type="button">
          <svg viewBox="0 0 10 10" />
        </button>
        <button type="button">
          <span aria-hidden="true">📎</span>
        </button>
      </>
    )
    expect(iconButtonProblems(container)).toHaveLength(3)
  })

  it('имя из aria-labelledby считается, но тултип всё равно нужен', () => {
    const { container } = render(
      <>
        <span id="lbl">Прикрепить файл</span>
        <button type="button" aria-labelledby="lbl">
          📎
        </button>
      </>
    )
    expect(iconButtonProblems(container).map((p) => p.missing)).toEqual([['title']])
  })

  it('пустая разметка не считается нарушением', () => {
    const { container } = render(<p>без кнопок</p>)
    expect(iconButtonProblems(container)).toEqual([])
    expect(() => expectLabelledIconButtons(container)).not.toThrow()
  })
})

describe('общий конфиг axe', () => {
  it('находит настоящее нарушение и печатает узел с подсказкой', async () => {
    // Проверяем сам хелпер: иначе «все экраны зелёные» может означать, что axe
    // просто не запускался (не тот контекст, отключённое правило).
    render(
      <>
        <button type="button" />
        <img src="x.png" />
      </>
    )
    await expect(expectNoViolations()).rejects.toThrow(/button-name[\s\S]*image-alt|image-alt[\s\S]*button-name/)
  })

  it('порог сториз пропускает придирки, но не серьёзное нарушение', async () => {
    // Кнопка без имени — critical: мягкий порог прогона сториз обязан её ловить,
    // иначе «235 сториз зелёные» ничего не значит.
    const { container } = render(<button type="button" />)
    await expect(expectNoCriticalViolations(container)).rejects.toThrow(/button-name/)
  })

  it('на исправной разметке молчит', async () => {
    const { container } = render(<LoginScreen onLogin={vi.fn()} />)
    await expectNoViolations(container)
    expect(screen.getByRole('button', { name: 'Войти' })).toBeInTheDocument()
  })
})
