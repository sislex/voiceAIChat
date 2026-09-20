// Конфиг Storybook пакета UI. Билдер — vite; единственная тонкость — алиас
// @shared на исходники packages/shared (как в vitest.config.ts): у пакета нет
// своего vite-конфига, поэтому алиасы задаются здесь.
import type { StorybookConfig } from '@storybook/react-vite'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'

const require = createRequire(import.meta.url)
const toolStories = (name: string, workspace: string) => join(dirname(require.resolve(name + '/package.json')), workspace, 'src/**/*.stories.tsx')

const config: StorybookConfig = {
  // Сториз — рядом с компонентами, docs-страницы витрины (Foundations) — .mdx.
  stories: ['../src/**/*.mdx', toolStories('@sislexa/make', 'packages/make-app'), toolStories('@sislexa/image-studio', 'packages/image-studio-app'), '../src/**/*.stories.tsx', '../../app-shell/src/**/*.stories.tsx', '../../chat-app/src/**/*.stories.tsx', toolStories('@sislexa/web-reader', 'packages/web-reader-app'), toolStories('@sislexa/playwright-reader', 'packages/playwright-reader-app'), '../../projects-app/src/**/*.stories.tsx', '../../operations-app/src/**/*.stories.tsx', '../../admin-app/src/**/*.stories.tsx', toolStories('@sislexa/identity', 'packages/sessions-app'), toolStories('@sislexa/identity', 'packages/profile-app')],
  addons: ['@storybook/addon-essentials', '@storybook/addon-a11y'],
  framework: { name: '@storybook/react-vite', options: {} },
  viteFinal: (cfg) => {
    cfg.build ??= {}
    // Крупные чанки в сборке витрины — не наши: это внутренности Storybook и
    // axe-core из addon-a11y, разбить их мы не можем. Порог поднят, чтобы
    // смоук-сборка была честно без предупреждений и настоящее предупреждение в
    // ней было видно.
    cfg.build.chunkSizeWarningLimit = 1024
    cfg.resolve ??= {}
    cfg.resolve.alias = [
      ...(Array.isArray(cfg.resolve.alias) ? cfg.resolve.alias : []),
      { find: /^@shared\//, replacement: fileURLToPath(new URL('../../shared/src/', import.meta.url)) }
    ]
    return cfg
  }
}
export default config
