// Monaco (движок VS Code) для редактора Make. Грузится лениво — только когда открыт файл в
// режиме «Код», чтобы не раздувать основной бандл. Воркеры собираются Vite (`?worker`), а не
// тянутся с CDN: прод может стоять без выхода в интернет для клиента.
import * as monaco from 'monaco-editor/esm/vs/editor/editor.api'
// Языки подключаем выборочно: полный monaco-editor тянет ~4 МБ, нам нужны html/css/json/ts и базовая подсветка.
import 'monaco-editor/esm/vs/language/typescript/monaco.contribution'
import 'monaco-editor/esm/vs/language/html/monaco.contribution'
import 'monaco-editor/esm/vs/language/css/monaco.contribution'
import 'monaco-editor/esm/vs/language/json/monaco.contribution'
import 'monaco-editor/esm/vs/basic-languages/javascript/javascript.contribution'
import 'monaco-editor/esm/vs/basic-languages/typescript/typescript.contribution'
import 'monaco-editor/esm/vs/basic-languages/html/html.contribution'
import 'monaco-editor/esm/vs/basic-languages/css/css.contribution'
import 'monaco-editor/esm/vs/basic-languages/markdown/markdown.contribution'
import 'monaco-editor/esm/vs/basic-languages/xml/xml.contribution'
import 'monaco-editor/esm/vs/basic-languages/yaml/yaml.contribution'
import 'monaco-editor/esm/vs/editor/contrib/find/browser/findController'
import 'monaco-editor/esm/vs/editor/contrib/folding/browser/folding'
import 'monaco-editor/esm/vs/editor/contrib/suggest/browser/suggestController'
import 'monaco-editor/esm/vs/editor/contrib/bracketMatching/browser/bracketMatching'
import 'monaco-editor/esm/vs/editor/contrib/comment/browser/comment'
import 'monaco-editor/esm/vs/editor/contrib/multicursor/browser/multicursor'
import 'monaco-editor/esm/vs/editor/contrib/hover/browser/hoverContribution'
import 'monaco-editor/esm/vs/editor/contrib/linesOperations/browser/linesOperations'
import 'monaco-editor/esm/vs/editor/contrib/wordHighlighter/browser/wordHighlighter'
import 'monaco-editor/esm/vs/editor/contrib/format/browser/formatActions'
import 'monaco-editor/esm/vs/editor/contrib/clipboard/browser/clipboard'
import 'monaco-editor/esm/vs/editor/contrib/contextmenu/browser/contextmenu'
import 'monaco-editor/esm/vs/editor/contrib/indentation/browser/indentation'
import 'monaco-editor/esm/vs/editor/contrib/linkedEditing/browser/linkedEditing'
import { jsxClosingTagFor } from './monacoLang'
import { REACT_TYPE_LIBS } from './monacoTypes'
import { formatCode } from '../../lib/formatCode'
import { loader } from '@monaco-editor/react'
import EditorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker'
import TsWorker from 'monaco-editor/esm/vs/language/typescript/ts.worker?worker'
import HtmlWorker from 'monaco-editor/esm/vs/language/html/html.worker?worker'
import CssWorker from 'monaco-editor/esm/vs/language/css/css.worker?worker'
import JsonWorker from 'monaco-editor/esm/vs/language/json/json.worker?worker'

let configured = false

export function setupMonaco(): typeof monaco {
  if (configured) return monaco
  configured = true
  ;(self as unknown as { MonacoEnvironment: unknown }).MonacoEnvironment = {
    getWorker(_: string, label: string) {
      if (label === 'typescript' || label === 'javascript') return new TsWorker()
      if (label === 'html' || label === 'handlebars' || label === 'razor') return new HtmlWorker()
      if (label === 'css' || label === 'scss' || label === 'less') return new CssWorker()
      if (label === 'json') return new JsonWorker()
      return new EditorWorker()
    }
  }
  loader.config({ monaco: monaco as unknown as Parameters<typeof loader.config>[0]['monaco'] })
  // Форматирование Prettier (Shift+Alt+F и «формат при сохранении»): один провайдер на все наши языки,
  // путь файла берём из URI модели — по нему выбирается парсер.
  for (const language of ['html', 'css', 'javascript', 'typescript', 'json', 'markdown', 'yaml']) {
    monaco.languages.registerDocumentFormattingEditProvider(language, {
      async provideDocumentFormattingEdits(model) {
        const path = model.uri.path.replace(/^\//, '')
        const formatted = await formatCode(path, model.getValue()).catch(() => null)
        if (formatted === null || formatted === model.getValue()) return []
        return [{ range: model.getFullModelRange(), text: formatted }]
      }
    })
  }
  // JSX/TSX без установленных типов React: синтаксис проверяем, семантику — нет (иначе всё красное).
  for (const defaults of [monaco.languages.typescript.typescriptDefaults, monaco.languages.typescript.javascriptDefaults]) {
    defaults.setCompilerOptions({
      jsx: monaco.languages.typescript.JsxEmit.ReactJSX,
      target: monaco.languages.typescript.ScriptTarget.ES2020,
      module: monaco.languages.typescript.ModuleKind.ESNext,
      moduleResolution: monaco.languages.typescript.ModuleResolutionKind.NodeJs,
      allowJs: true,
      allowNonTsExtensions: true,
      esModuleInterop: true,
      noEmit: true
    })
    defaults.setDiagnosticsOptions({ noSemanticValidation: true, noSyntaxValidation: false })
    defaults.setEagerModelSync(true)
    for (const lib of REACT_TYPE_LIBS) defaults.addExtraLib(lib.content, lib.path)
  }
  return monaco
}

const VOID_TAGS = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'source', 'track', 'wbr'])

/** Для jsx/tsx: вставить закрывающий тег, если он уместен. Возвращает true, если вставили. */
export function attachJsxAutoClose(editor: monaco.editor.IStandaloneCodeEditor, m: typeof monaco): monaco.IDisposable {
  return editor.onDidChangeModelContent((e) => {
    const model = editor.getModel()
    if (!model || e.isUndoing || e.isRedoing || e.changes.length !== 1) return
    const change = e.changes[0]!
    if (change.text !== '>') return
    const lang = model.getLanguageId()
    if (lang !== 'javascript' && lang !== 'typescript') return
    const pos = editor.getPosition()
    if (!pos) return
    const before = model.getValueInRange({ startLineNumber: pos.lineNumber, startColumn: 1, endLineNumber: pos.lineNumber, endColumn: pos.column })
    const closing = jsxClosingTagFor(before)
    if (!closing) return
    const tag = closing.slice(2, -1)
    if (VOID_TAGS.has(tag.toLowerCase())) return
    const after = model.getValueInRange({ startLineNumber: pos.lineNumber, startColumn: pos.column, endLineNumber: pos.lineNumber, endColumn: model.getLineMaxColumn(pos.lineNumber) })
    if (after.startsWith(closing)) return
    editor.executeEdits('jsx-auto-close', [{ range: new m.Range(pos.lineNumber, pos.column, pos.lineNumber, pos.column), text: closing, forceMoveMarkers: false }])
    editor.setPosition(pos)
  })
}

/**
 * Модели всех текстовых файлов проекта (п.2): TS-сервис Monaco резолвит `./components/Button.tsx`
 * только если такой модели существует — тогда работают переход к определению (F12/Cmd+клик) и
 * автодополнение импортов. Модели живут под `file:///<путь>`; редактор открытого файла использует
 * ту же модель через `path` у <Editor>.
 */
export function syncProjectModels(m: typeof monaco, files: ReadonlyArray<{ path: string; content: string }>): void {
  const keep = new Set<string>()
  for (const file of files) {
    const uri = m.Uri.parse(`file:///${file.path}`)
    keep.add(uri.toString())
    const existing = m.editor.getModel(uri)
    if (!existing) m.editor.createModel(file.content, undefined, uri)
    else if (existing.getValue() !== file.content && !existing.isAttachedToEditor()) existing.setValue(file.content)
  }
  // Удалённые файлы проекта — убрать, иначе TS будет резолвить в призраков.
  for (const model of m.editor.getModels()) {
    const key = model.uri.toString()
    if (key.startsWith('file:///') && !key.includes('/node_modules/') && !keep.has(key) && !model.isAttachedToEditor()) model.dispose()
  }
}
