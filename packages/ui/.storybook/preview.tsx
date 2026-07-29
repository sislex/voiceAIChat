// Превью: подключает боевые стили app.css (экспортируемый styles.css — это
// global.css, канбан-классов там нет) и переключатель светлой/тёмной темы,
// повторяя корень приложения <div class="app" data-theme=...>.
import type { Preview } from '@storybook/react'
import '../src/styles/app.css'

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
    (Story, ctx) => (
      <div className="app" data-theme={ctx.globals.theme} style={{ display: 'block', minHeight: '100vh', padding: 16 }}>
        <Story />
      </div>
    )
  ]
}
export default preview
