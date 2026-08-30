// Конфиг Storybook пакета UI. Билдер — vite; единственная тонкость — алиас
// @shared на исходники packages/shared (как в vitest.config.ts): у пакета нет
// своего vite-конфига, поэтому алиасы задаются здесь.
import type { StorybookConfig } from '@storybook/react-vite'
import { fileURLToPath } from 'node:url'

const config: StorybookConfig = {
  // Сториз — рядом с компонентами, docs-страницы витрины (Foundations) — .mdx.
  stories: ['../src/**/*.mdx', '../src/**/*.stories.tsx', '../../app-shell/src/**/*.stories.tsx', '../../chat-app/src/**/*.stories.tsx', '../../web-reader-app/src/**/*.stories.tsx', '../../playwright-reader-app/src/**/*.stories.tsx', '../../projects-app/src/**/*.stories.tsx', '../../operations-app/src/**/*.stories.tsx', '../../admin-app/src/**/*.stories.tsx', '../../sessions-app/src/**/*.stories.tsx'],
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
