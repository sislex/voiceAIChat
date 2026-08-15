// render с провайдерами примитивов интерфейса (тосты + подтверждения).
//
// Нужен почти каждому экранному тесту: нативных диалогов браузера больше нет,
// подтверждение приходит из ConfirmProvider — в тестах его кликают, а не мокают.
// Чтобы не повторять обёртку в каждом файле, экраны рендерим отсюда:
//
//   import { render } from '../../test/uiRender'
//
// Полное приложение (App) свои провайдеры ставит само — там достаточно обычного
// render из @testing-library/react.

import type { ReactElement } from 'react'
import { render as rtlRender, type RenderOptions, type RenderResult } from '@testing-library/react'
import { UiProviders } from '@voicechat/ui-kit'

export function render(ui: ReactElement, options?: Omit<RenderOptions, 'wrapper'>): RenderResult {
  return rtlRender(ui, { wrapper: UiProviders, ...options })
}
