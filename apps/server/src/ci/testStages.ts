/** Разбор настройки test_command проекта в список стадий. Общий для
 *  merge-рана и Component QA: пустая настройка → дефолт вызывающей стороны;
 *  строка без ведущей '[' → одиночная команда; валидный JSON-массив →
 *  непустые trim-нутые стадии; некорректный JSON с ведущей '[' выполняется
 *  как одна команда, чтобы явно упасть с понятной ошибкой. */
export function testStages(value: string, fallback: string[]): string[] {
  const trimmed = value.trim()
  if (!trimmed) return fallback
  if (!trimmed.startsWith('[')) return [trimmed]
  try {
    const parsed = JSON.parse(trimmed)
    if (Array.isArray(parsed)) {
      const stages = parsed.filter((item): item is string => typeof item === 'string' && item.trim().length > 0).map((item) => item.trim())
      if (stages.length) return stages
    }
  } catch { /* execute malformed value as a plain command for an explicit failure */ }
  return [trimmed]
}
