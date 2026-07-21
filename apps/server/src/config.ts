// Конфигурация сервера из окружения.

import { existsSync, readdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

export interface ServerConfig {
  port: number
  host: string
  /** Каталог данных (БД, модели). */
  dataDir: string
  /** Каталог GGML-моделей Whisper. */
  modelsDir: string
  /** Путь к исполняемому whisper-cli (whisper.cpp). */
  whisperCli: string
  /** Каталог голосов Piper. */
  piperVoicesDir: string
  /** Путь к исполняемому piper (или python для `python -m piper`). */
  piperBin: string
  /** Префикс аргументов piper (['-m','piper'] при запуске через python). */
  piperArgsPrefix: string[]
  /** Путь к .dmg компаньон-приложения для скачивания (undefined — не собрано). */
  agentAppPath?: string
}

const DEFAULT_DATA_DIR = join(homedir(), '.voicechat-server')

// Авто-обнаружение готовых артефактов из desktop-приложения в этом монорепо —
// чтобы `npm run dev` в apps/server работал без env. В проде/на другой машине этих
// путей нет → откат к дефолтам, а env всегда имеет приоритет.
const REPO_ROOT = fileURLToPath(new URL('../../../', import.meta.url))
const REPO = {
  whisperCli: join(
    REPO_ROOT,
    'apps/desktop/node_modules/nodejs-whisper/cpp/whisper.cpp/build/bin/whisper-cli'
  ),
  modelsDir: join(REPO_ROOT, 'apps/desktop/node_modules/nodejs-whisper/cpp/whisper.cpp/models'),
  piperBin: join(REPO_ROOT, '.venv-piper/bin/piper'),
  piperVoicesDir: join(REPO_ROOT, 'apps/desktop/resources/piper-voices'),
  agentAppDir: join(REPO_ROOT, 'apps/agent-tray/release')
}

/** Первый .dmg в каталоге (собранный компаньон-агент) или undefined. */
function findDmg(dir: string): string | undefined {
  try {
    const f = readdirSync(dir).find((n) => n.endsWith('.dmg'))
    return f ? join(dir, f) : undefined
  } catch {
    return undefined
  }
}

// Под тестами (vitest) авто-обнаружение репо-путей ОТКЛЮЧЕНО: иначе деструктивные
// операции в тестах (удаление модели/голоса) затронули бы реальные файлы репозитория.
const AUTODISCOVER = !process.env.VITEST

/** env → значение → in-repo артефакт (если существует и не тест) → дефолт. */
function pick(envVal: string | undefined, repoPath: string, fallback: string): string {
  if (envVal) return envVal
  if (AUTODISCOVER && existsSync(repoPath)) return repoPath
  return fallback
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): ServerConfig {
  const dataDir = env.VC_DATA_DIR ?? DEFAULT_DATA_DIR
  const modelsDir = pick(env.VC_MODELS_DIR, REPO.modelsDir, join(dataDir, 'models'))
  return {
    port: Number(env.PORT ?? 8787),
    host: env.HOST ?? '127.0.0.1',
    dataDir,
    modelsDir,
    whisperCli: pick(env.VC_WHISPER_CLI, REPO.whisperCli, join(dataDir, 'whisper-cli')),
    piperVoicesDir: pick(env.VC_PIPER_VOICES_DIR, REPO.piperVoicesDir, join(modelsDir, 'piper')),
    piperBin: pick(env.VC_PIPER_BIN, REPO.piperBin, 'piper'),
    piperArgsPrefix: env.VC_PIPER_ARGS ? env.VC_PIPER_ARGS.split(' ') : [],
    agentAppPath: env.VC_AGENT_APP ?? (AUTODISCOVER ? findDmg(REPO.agentAppDir) : undefined)
  }
}
