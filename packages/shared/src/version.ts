// Версия компаньон-агента и минимальные версии для тулов.
//
// AGENT_VERSION — канонич. версия агента (её рапортует свежий скрипт/приложение
// при регистрации и её же отдаёт сервер как «последнюю доступную»). Бампим здесь
// при добавлении возможностей. Тулы объявляют минимальную версию агента; если
// подключённый агент старее — тула не выполняется (просим обновиться).

export const AGENT_VERSION = '0.5.0'

/**
 * Минимальная версия агента для тула. 0.1.0 — базовый агент (умеет exec/bash);
 * 0.2.0 — добавлены файловые операции (проводник) и утилита «Консоль»;
 * 0.3.0 — добавлен живой PTY-терминал по машине (node-pty);
 * 0.4.0 — агент шлёт живую телеметрию (ОС/CPU/память/диск/батарея, push-only);
 * 0.5.0 — агент раздаёт картинки по HTTP из `<rootDir>/.generated_images`.
 */
export const TOOL_MIN_VERSION: Record<string, string> = {
  exec: '0.1.0',
  fs: '0.2.0',
  pty: '0.3.0',
  images: '0.5.0'
}

/** Сравнение версий x.y.z: -1 (a<b), 0 (равны), 1 (a>b). Терпит недостающие части. */
export function compareVersions(a: string, b: string): -1 | 0 | 1 {
  const pa = a.split('.').map((n) => parseInt(n, 10) || 0)
  const pb = b.split('.').map((n) => parseInt(n, 10) || 0)
  const len = Math.max(pa.length, pb.length)
  for (let i = 0; i < len; i++) {
    const x = pa[i] ?? 0
    const y = pb[i] ?? 0
    if (x < y) return -1
    if (x > y) return 1
  }
  return 0
}

/** Требуемая версия агента для тула (по умолчанию — базовая 0.1.0). */
export function requiredVersion(tool: string): string {
  return TOOL_MIN_VERSION[tool] ?? '0.1.0'
}

/** Разрешён ли тул на агенте данной версии. */
export function isToolAllowed(agentVersion: string, tool: string): boolean {
  return compareVersions(agentVersion, requiredVersion(tool)) >= 0
}
