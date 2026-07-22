// Сборка компаньон-агента в один самодостаточный CommonJS-файл: пользователь
// скачивает его и запускает `node voicechat-agent.cjs` без клонирования репозитория
// (ws вшивается в бандл; типы @voicechat/shared стираются как import type).

import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'

const AGENT_ENTRY = fileURLToPath(new URL('../../../agent/src/index.ts', import.meta.url))

let cached: Promise<string> | null = null

/** Собирает (и кеширует) бандл агента. Формат — CJS, чтобы ws грузился без ESM-возни. */
export function buildAgentScript(): Promise<string> {
  if (cached) return cached
  cached = build({
    entryPoints: [AGENT_ENTRY],
    bundle: true,
    platform: 'node',
    format: 'cjs',
    target: 'node18',
    write: false,
    // Опциональные нативные ускорители ws: отсутствуют → ws сам падает на JS-фолбэк.
    external: ['bufferutil', 'utf-8-validate'],
    banner: { js: '#!/usr/bin/env node' }
  })
    .then((res) => res.outputFiles[0].text)
    .catch((err) => {
      cached = null // дать шанс пересобрать при следующем запросе
      throw err
    })
  return cached
}
