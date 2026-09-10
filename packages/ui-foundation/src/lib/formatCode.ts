// Форматирование кода Prettier в браузере (п.4): standalone-ядро + плагины по языку файла,
// всё лениво — чанк ~1 МБ нужен только тому, кто нажал Shift+Alt+F или включил формат при сохранении.
export function prettierParserFor(path: string): { parser: string; plugins: () => Promise<unknown[]> } | null {
  const ext = path.slice(path.lastIndexOf('.') + 1).toLowerCase()
  switch (ext) {
    case 'js': case 'jsx': case 'mjs': case 'cjs':
      return { parser: 'babel', plugins: async () => [(await import('prettier/plugins/babel')).default, (await import('prettier/plugins/estree')).default] }
    case 'ts': case 'tsx':
      return { parser: 'typescript', plugins: async () => [(await import('prettier/plugins/typescript')).default, (await import('prettier/plugins/estree')).default] }
    case 'html': case 'htm':
      return { parser: 'html', plugins: async () => [(await import('prettier/plugins/html')).default, (await import('prettier/plugins/babel')).default, (await import('prettier/plugins/postcss')).default, (await import('prettier/plugins/estree')).default] }
    case 'css':
      return { parser: 'css', plugins: async () => [(await import('prettier/plugins/postcss')).default] }
    case 'json': case 'webmanifest':
      return { parser: 'json', plugins: async () => [(await import('prettier/plugins/babel')).default, (await import('prettier/plugins/estree')).default] }
    case 'md': case 'markdown':
      return { parser: 'markdown', plugins: async () => [(await import('prettier/plugins/markdown')).default] }
    case 'yml': case 'yaml':
      return { parser: 'yaml', plugins: async () => [(await import('prettier/plugins/yaml')).default] }
    default:
      return null
  }
}

/** Отформатированный текст или null, если для файла нет парсера. Ошибка синтаксиса пробрасывается. */
export async function formatCode(path: string, source: string): Promise<string | null> {
  const target = prettierParserFor(path)
  if (!target) return null
  const { format } = await import('prettier/standalone')
  return format(source, {
    parser: target.parser,
    plugins: (await target.plugins()) as never,
    semi: false, singleQuote: true, printWidth: 100, trailingComma: 'none', tabWidth: 2
  })
}
