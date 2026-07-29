// Конфиг Storybook пакета UI. Билдер — vite; единственная тонкость — алиас
// @shared на исходники packages/shared (как в vitest.config.ts): у пакета нет
// своего vite-конфига, поэтому алиасы задаются здесь.
import type { StorybookConfig } from '@storybook/react-vite'
import { fileURLToPath } from 'node:url'

const config: StorybookConfig = {
  stories: ['../src/**/*.stories.tsx'],
  addons: ['@storybook/addon-essentials', '@storybook/addon-a11y'],
  framework: { name: '@storybook/react-vite', options: {} },
  viteFinal: (cfg) => {
    cfg.resolve ??= {}
    cfg.resolve.alias = [
      ...(Array.isArray(cfg.resolve.alias) ? cfg.resolve.alias : []),
      { find: /^@shared\//, replacement: fileURLToPath(new URL('../../shared/src/', import.meta.url)) }
    ]
    return cfg
  }
}
export default config
