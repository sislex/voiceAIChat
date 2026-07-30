// Превью: подключает боевые стили app.css (экспортируемый styles.css — это
// global.css, канбан-классов там нет) и переключатель светлой/тёмной темы,
// повторяя корень приложения <div class="app" data-theme=...>.
import { useEffect, type ReactNode } from 'react'
import type { Preview } from '@storybook/react'
import '../src/styles/app.css'
import { UiProviders } from '../src/components/ui/UiProviders'

// Как и в App: тема дублируется на <html>, иначе модальные окна (портал в
// document.body) остаются без токенов [data-theme='dark'].
function Frame({ theme, children }: { theme: string; children: ReactNode }): JSX.Element {
  useEffect(() => {
    document.documentElement.dataset.theme = theme
  }, [theme])
  return (
    <div className="app" data-theme={theme} style={{ display: 'block', minHeight: '100vh', padding: 16 }}>
      {children}
    </div>
  )
}

const preview: Preview = {
  parameters: { layout: 'fullscreen' },
  globalTypes: {
    theme: {
      description: 'Тема',
      toolbar: { title: 'Тема', icon: 'circlehollow', items: ['light', 'dark'], dynamicTitle: true }
    }
  },
  initialGlobals: { theme: 'light' },
  decorators: [
    // Провайдеры примитивов, как в корне App: иначе клик «Удалить» в сториз
    // канбана падал бы — подтверждение приходит из ConfirmProvider.
    (Story, ctx) => (
      <Frame theme={ctx.globals.theme}>
        <UiProviders>
          <Story />
        </UiProviders>
      </Frame>
    )
  ]
}
export default preview
