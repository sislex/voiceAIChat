// Сниппеты редактора Make (roadmap-4 п.15): `rfc` — React-компонент, `story` — стори для раннера,
// `token` — CSS-переменная в :root. Чистые описания без Monaco, чтобы тестировать без DOM;
// регистрация провайдера — в monacoSetup. Синтаксис — Monaco/VS Code snippet (`${1:name}`).

export interface MakeSnippet {
  prefix: string
  label: string
  detail: string
  /** Языки Monaco, где сниппет предлагается. */
  languages: string[]
  body: string
}

export const MAKE_SNIPPETS: MakeSnippet[] = [
  {
    prefix: 'rfc',
    label: 'rfc — React-компонент',
    detail: 'Функциональный компонент с пропсами и export',
    languages: ['typescript', 'javascript'],
    body: [
      'export interface ${1:Component}Props {',
      '\t${2:title}: string',
      '}',
      '',
      'export function ${1:Component}({ ${2:title} }: ${1:Component}Props) {',
      '\treturn (',
      '\t\t<div className="${3:${1/(.*)/${1:/downcase}/}}">',
      '\t\t\t{${2:title}}$0',
      '\t\t</div>',
      '\t)',
      '}'
    ].join('\n')
  },
  {
    prefix: 'story',
    label: 'story — стори компонента',
    detail: 'Именованный экспорт для раннера «Компоненты»',
    languages: ['typescript', 'javascript'],
    body: [
      'export const ${1:Default} = () => <${2:Component} ${3:title="Пример"} />$0'
    ].join('\n')
  },
  {
    prefix: 'token',
    label: 'token — дизайн-токен',
    detail: 'CSS-переменная в :root',
    languages: ['css'],
    body: '--${1:name}: ${2:#000};$0'
  }
]

/** Сниппеты для языка — то, что провайдер отдаёт Monaco. */
export function snippetsFor(language: string): MakeSnippet[] {
  return MAKE_SNIPPETS.filter((s) => s.languages.includes(language))
}

/** Слово перед курсором — префикс, по которому фильтруются сниппеты (Monaco делает fuzzy сам, нам нужен range). */
export function snippetWordAt(lineText: string, column: number): { word: string; startColumn: number } {
  const before = lineText.slice(0, Math.max(0, column - 1))
  const m = /[A-Za-z_-]*$/.exec(before)
  const word = m ? m[0] : ''
  return { word, startColumn: column - word.length }
}
