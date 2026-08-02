// Превью: подключает боевые стили (global.css — сброс и шрифт, как в web;
// app.css — все классы приложения) и переключатель светлой/тёмной темы,
// повторяя корень приложения <div class="app" data-theme=…>.
import { useEffect, type ReactNode } from 'react'
import type { Preview } from '@storybook/react'
import '../src/styles/global.css'
import '../src/styles/app.css'
import { UiProviders } from '../src/components/ui/UiProviders'

// Как и в App: тема дублируется на <html>, иначе модальные окна (портал в
// document.body) остаются без токенов [data-theme='dark']. Фон body тянем к
// --bg — иначе под сториз в тёмной теме просвечивает светлая канва Storybook,
// и «проверил в тёмной» означало бы проверку на неправильном фоне.
function Frame({ theme, children }: { theme: string; children: ReactNode }): JSX.Element {
  useEffect(() => {
    document.documentElement.dataset.theme = theme
    document.body.style.background = 'var(--bg)'
    document.body.style.color = 'var(--text)'
  }, [theme])
  return (
    <div
      className="app"
      data-theme={theme}
      // .app — это грид на всю высоту с overflow: hidden; витрине нужен обычный
      // поток, иначе длинные таблицы Foundations обрезаются без скролла.
      style={{ display: 'block', height: 'auto', minHeight: '100vh', overflow: 'visible', padding: 16 }}
    >
      {children}
    </div>
  )
}

const preview: Preview = {
  parameters: {
    layout: 'fullscreen',
    // Своего переключателя фонов не нужно: фон задаёт тема через --bg.
    backgrounds: { disable: true },
    options: {
      storySort: { order: ['Foundations', 'UI', 'Chat', 'CI', 'Machines', 'Kanban', 'AI Assist', 'Prompt Builder', '*'] }
    }
  },
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
