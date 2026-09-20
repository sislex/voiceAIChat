import type { ReactElement } from 'react'
import { render as rtlRender, type RenderOptions, type RenderResult } from '@testing-library/react'
import { UiProviders } from '@voicechat/ui-kit'

/** Product tests exercise real confirmation and toast providers without a host checkout. */
export function render(ui: ReactElement, options?: Omit<RenderOptions, 'wrapper'>): RenderResult {
  return rtlRender(ui, { wrapper: UiProviders, ...options })
}
