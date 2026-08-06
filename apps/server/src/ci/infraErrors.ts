// Классификатор инфраструктурных ошибок шага CI: сбои машины/окружения, которые
// НЕ лечатся правкой рабочей копии. Такие падения нельзя отдавать в fix-loop —
// модель ищет причину в проекте, тратит ходы и всё равно не помогает (реальный
// случай: три попытки opus на повреждённый общий кэш npm).

/** Разобранная инфраструктурная ошибка: что случилось и что с этим делать. */
export interface CiInfraFailure {
  /** Машиночитаемый вид сбоя (уходит в аудит `run.infra_error`). */
  kind: 'npm_cache' | 'disk_full' | 'agent_offline'
  /** Короткое описание для лога шага. */
  message: string
  /** Что делать оператору. */
  hint: string
}

/** Повреждённый `_cacache`: EEXIST/ENOENT/EINTEGRITY при переносе во content-v2. */
const NPM_CACHE_PATH = /_cacache/
const NPM_CACHE_CODE = /\b(EEXIST|ENOENT|EINTEGRITY)\b/
/** Кончилось место (том машины) — тоже не про задачу. */
const DISK_FULL = /\bENOSPC\b|no space left on device/i
/**
 * Исполнитель команд отвалился посреди шага. Сообщение реестра машин приходит не
 * в stdout, а системной строкой в самом хвосте вывода, и код выхода остаётся
 * пустым — ловим только такую подпись, иначе тест проекта с этим текстом в
 * выводе сойдёт за сбой машины.
 */
const AGENT_OFFLINE = /(?:^|\n)Машина (?:отключилась[^\n]*|не в сети)\s*$/

/**
 * Признать падение шага инфраструктурным по хвосту вывода. Код выхода не
 * обязателен (npm отдаёт и 254, и 1), решает подпись в выводе.
 */
export function classifyCiInfraFailure(args: { exitCode: number | null; output: string }): CiInfraFailure | null {
  const out = args.output
  if (!out) return null
  if (NPM_CACHE_PATH.test(out) && NPM_CACHE_CODE.test(out)) {
    return {
      kind: 'npm_cache',
      message: `Повреждён кэш npm (_cacache) — инфраструктурный сбой машины, а не ошибка задачи${args.exitCode != null ? ` (код выхода ${args.exitCode})` : ''}.`,
      hint: 'Почистить кэш на машине (`npm cache clean --force`) и проверить, что шаг получает изолированный кэш рана (`npm_config_cache=$NPM_CACHE_DIR`): гонка двух `npm ci` за общий ~/.npm ломает его именно так.'
    }
  }
  if (DISK_FULL.test(out)) {
    return {
      kind: 'disk_full',
      message: 'На машине не осталось места на диске (ENOSPC) — инфраструктурный сбой, а не ошибка задачи.',
      hint: 'Освободить место на машине (рабочие копии в `$REPO_ROOT`, кэши ранов в `$REPO_ROOT/.npm-cache`, docker-образы) и повторить шаг.'
    }
  }
  if (args.exitCode === null && AGENT_OFFLINE.test(out)) {
    return {
      kind: 'agent_offline',
      message: 'Машина потеряла связь с сервером посреди шага — инфраструктурный сбой, а не ошибка задачи.',
      hint: 'Проверить, что агент машины в сети и что прод-контейнер не пересобирался во время рана: отложенная пересборка пересоздаёт `voicechat` и рвёт соединение сразу со всеми ранами. Шаг можно повторить.'
    }
  }
  return null
}

/** Ярлык вида сбоя для ленты рана: короткий, без подсказки. */
export const CI_INFRA_LABEL: Record<CiInfraFailure['kind'], string> = {
  npm_cache: 'повреждён кэш npm',
  disk_full: 'нет места на диске',
  agent_offline: 'машина потеряла связь'
}

/** Готовый текст для лога шага: диагноз + подсказка + почему без fix-loop. */
export function formatCiInfraFailure(f: CiInfraFailure): string {
  return [
    `⚠ ${f.message}`,
    `Что делать: ${f.hint}`,
    'Авто-фикс не запускаю: в рабочей копии эта ошибка не лечится.',
    ''
  ].join('\n')
}
