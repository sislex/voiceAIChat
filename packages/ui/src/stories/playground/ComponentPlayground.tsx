import { useMemo, useState } from 'react'
import {
  SandpackCodeEditor,
  SandpackConsole,
  SandpackLayout,
  SandpackPreview,
  SandpackProvider,
  useSandpack,
  type SandpackFiles
} from '@codesandbox/sandpack-react'
import './ComponentPlayground.css'

export type PlaygroundTheme = 'light' | 'dark'

export interface ComponentPlaygroundProps {
  files: SandpackFiles
  dependencies?: Record<string, string>
  activeFile?: string
  initialTheme?: PlaygroundTheme
  title?: string
}

interface PlaygroundToolbarProps {
  dirty: boolean
  theme: PlaygroundTheme
  onReset: () => void
  onToggleTheme: () => void
}

export function PlaygroundToolbar({ dirty, theme, onReset, onToggleTheme }: PlaygroundToolbarProps): JSX.Element {
  return (
    <div className="component-playground__toolbar">
      <span className="component-playground__status" aria-live="polite">
        {dirty ? 'Есть несохранённые изменения' : 'Исходный пример'}
      </span>
      <div className="component-playground__actions">
        <button type="button" className="vc-btn vc-btn--secondary vc-btn--sm" onClick={onReset} disabled={!dirty}>
          Сбросить пример
        </button>
        <button
          type="button"
          className="vc-btn vc-btn--secondary vc-btn--sm"
          onClick={onToggleTheme}
          aria-label={theme === 'light' ? 'Включить тёмную тему песочницы' : 'Включить светлую тему песочницы'}
        >
          {theme === 'light' ? 'Тёмная тема' : 'Светлая тема'}
        </button>
      </div>
    </div>
  )
}

function PlaygroundContents({ theme, setTheme }: { theme: PlaygroundTheme; setTheme: (theme: PlaygroundTheme) => void }): JSX.Element {
  const { sandpack } = useSandpack()

  return (
    <>
      <PlaygroundToolbar
        dirty={sandpack.editorState === 'dirty'}
        theme={theme}
        onReset={sandpack.resetAllFiles}
        onToggleTheme={() => setTheme(theme === 'light' ? 'dark' : 'light')}
      />
      <SandpackLayout>
        <SandpackCodeEditor showTabs showLineNumbers showInlineErrors wrapContent style={{ minHeight: 420 }} />
        <SandpackPreview
          showNavigator={false}
          showOpenInCodeSandbox={false}
          showOpenNewtab={false}
          showRefreshButton
          showRestartButton
          showSandpackErrorOverlay
          style={{ minHeight: 420 }}
        />
      </SandpackLayout>
      <div className="component-playground__console" aria-label="Ошибки и консоль примера">
        <SandpackConsole
          showHeader
          showSyntaxError
          showRestartButton
          showResetConsoleButton
          standalone
          style={{ minHeight: 120, maxHeight: 240 }}
        />
      </div>
    </>
  )
}

/**
 * Изолированный браузерный редактор для Storybook MDX. Он получает только
 * перечисленные виртуальные файлы и зависимости; изменения живут в памяти
 * вкладки и никогда не записываются в репозиторий.
 */
export function ComponentPlayground({
  files,
  dependencies = {},
  activeFile = '/App.tsx',
  initialTheme = 'light',
  title = 'Интерактивный пример'
}: ComponentPlaygroundProps): JSX.Element {
  const [theme, setTheme] = useState<PlaygroundTheme>(initialTheme)
  const stableFiles = useMemo(() => files, [files])

  return (
    <section className="component-playground" data-theme={theme} aria-label={title}>
      <SandpackProvider
        template="react-ts"
        theme={theme}
        files={stableFiles}
        customSetup={{ dependencies: { react: '18.3.1', 'react-dom': '18.3.1', ...dependencies } }}
        options={{
          activeFile,
          visibleFiles: [activeFile],
          autorun: true,
          autoReload: true,
          recompileMode: 'delayed',
          recompileDelay: 300
        }}
      >
        <PlaygroundContents theme={theme} setTheme={setTheme} />
      </SandpackProvider>
    </section>
  )
}

