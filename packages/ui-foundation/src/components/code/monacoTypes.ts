// Editor declarations ship as licensed assets so packaged consumers need no neighboring node_modules layout.
import reactIndex from './type-libs/react-index.d.ts.txt?raw'
import reactGlobal from './type-libs/react-global.d.ts.txt?raw'
import reactJsxRuntime from './type-libs/react-jsx-runtime.d.ts.txt?raw'
import reactDomIndex from './type-libs/react-dom-index.d.ts.txt?raw'
import reactDomClient from './type-libs/react-dom-client.d.ts.txt?raw'
import csstype from './type-libs/csstype-index.d.ts.txt?raw'

export const REACT_TYPE_LIBS: ReadonlyArray<{ path: string; content: string }> = [
  { path: 'file:///node_modules/@types/react/index.d.ts', content: reactIndex },
  { path: 'file:///node_modules/@types/react/global.d.ts', content: reactGlobal },
  { path: 'file:///node_modules/@types/react/jsx-runtime.d.ts', content: reactJsxRuntime },
  { path: 'file:///node_modules/@types/react-dom/index.d.ts', content: reactDomIndex },
  { path: 'file:///node_modules/@types/react-dom/client.d.ts', content: reactDomClient },
  { path: 'file:///node_modules/csstype/index.d.ts', content: csstype }
]
