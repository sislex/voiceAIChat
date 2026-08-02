// Фильтр «только чтение» для фазы плана CI-рана. Рабочая копия живёт на машине
// пользователя, и единственный доступ модели к ней — remote-bash MCP. Поэтому в
// плане мост не отключается целиком, а пропускает исследование и отклоняет всё,
// что меняет состояние. Best-effort по паттернам, а не песочница — цель в том,
// чтобы план оставался планом, а не в защите от злонамеренной команды.

/** Убирает безобидные редиректы (в /dev/null и 2>&1) — иначе их примут за запись в файл. */
function stripHarmlessRedirects(command: string): string {
  return command.replace(/\d*>>?\s*\/dev\/null/g, ' ').replace(/\d*>&\d*/g, ' ')
}

/** Команды, меняющие файлы, пакеты или процессы. Граница слева — начало, пробел или разделитель. */
const MUTATING_RE =
  /(^|[\s;&|(])(rm|rmdir|mv|cp|dd|truncate|tee|mkdir|touch|chmod|chown|chgrp|ln|install|patch|npm|npx|yarn|pnpm|make|docker|systemctl|service|kill|pkill|apt|apt-get|pip|pip3)\b/i

/** Мутирующие подкоманды git (branch/fetch/config не в списке: чтение или безобидны). */
const GIT_MUTATING_RE =
  /\bgit\s+(add|commit|checkout|switch|restore|reset|clean|merge|rebase|push|pull|stash|apply|cherry-pick|revert|rm|mv)\b/i

const SED_INPLACE_RE = /\bsed\b[^|;&]*\s-i\b/i

export interface PlanModeVerdict {
  allowed: boolean
  reason?: string
}

/** Разрешена ли команда в фазе плана (только чтение рабочей копии). */
export function evaluatePlanModeCommand(command: string): PlanModeVerdict {
  const cmd = stripHarmlessRedirects(command.trim())
  if (SED_INPLACE_RE.test(cmd)) return { allowed: false, reason: 'sed -i изменяет файлы' }
  if (GIT_MUTATING_RE.test(cmd)) return { allowed: false, reason: 'git-команда меняет состояние репозитория' }
  const m = MUTATING_RE.exec(cmd)
  if (m) return { allowed: false, reason: `команда «${m[2]}» изменяет состояние` }
  if (/>>?/.test(cmd)) return { allowed: false, reason: 'перенаправление вывода в файл' }
  return { allowed: true }
}
