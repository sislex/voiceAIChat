// Поиск и замена по проекту Make (roadmap-4 п.11): сборка регулярного выражения из запроса
// и предпросмотр замены построчно. Чистая логика — используется сервером, UI и фейковым API тестов.

export interface MakeSearchOptions {
  /** Трактовать запрос как регулярное выражение (иначе — экранированная подстрока). */
  regex?: boolean
  matchCase?: boolean
}

/** Строка предпросмотра замены: как выглядела и как будет выглядеть. */
export interface MakeReplacePreviewLine {
  path: string
  line: number
  before: string
  after: string
}

const ESCAPE = /[.*+?^${}()|[\]\\]/g

/** Глобальное выражение по запросу; при невалидном regex бросает SyntaxError — вызывающий показывает сообщение. */
export function buildMakeSearchRegex(query: string, options: MakeSearchOptions = {}): RegExp {
  const source = options.regex ? query : query.replace(ESCAPE, '\\$&')
  const flags = options.matchCase ? 'g' : 'gi'
  const re = new RegExp(source, flags)
  // Пустое совпадение (например, `a*`) зациклит построчную замену — считаем такой запрос ошибкой.
  if (re.test('')) throw new SyntaxError('Выражение совпадает с пустой строкой')
  return re
}

/** Строки файла, где выражение находит совпадение, с результатом замены (`$1`-подстановки работают). */
export function previewMakeReplace(path: string, content: string, re: RegExp, replacement: string | (() => string)): MakeReplacePreviewLine[] {
  const out: MakeReplacePreviewLine[] = []
  content.split('\n').forEach((text, i) => {
    re.lastIndex = 0
    if (!re.test(text)) return
    re.lastIndex = 0
    out.push({ path, line: i + 1, before: text.trim().slice(0, 200), after: (typeof replacement === 'string' ? text.replace(re, replacement) : text.replace(re, replacement)).trim().slice(0, 200) })
  })
  return out
}
