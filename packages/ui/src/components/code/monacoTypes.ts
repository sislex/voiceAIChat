// Типы React для Monaco (п.3 дорожной карты): d.ts берём из node_modules через Vite `?raw` и
// подкладываем как extraLibs под путями node_modules (импорт относительным путём: у @types/react
// закрытый exports, deep-import по имени пакета Vite не резолвит) — тогда `import { useState } from 'react'`
// и JSX-пропсы получают подсказки и hover. Семантическую проверку не включаем: относительные
// импорты проекта резолвятся моделями (п.2), а вот esm.sh-пакеты вне import map TS не увидит.
import reactIndex from '../../../../../node_modules/@types/react/index.d.ts?raw'
import reactGlobal from '../../../../../node_modules/@types/react/global.d.ts?raw'
import reactJsxRuntime from '../../../../../node_modules/@types/react/jsx-runtime.d.ts?raw'
import reactDomIndex from '../../../../../node_modules/@types/react-dom/index.d.ts?raw'
import reactDomClient from '../../../../../node_modules/@types/react-dom/client.d.ts?raw'
import csstype from '../../../../../node_modules/csstype/index.d.ts?raw'

export const REACT_TYPE_LIBS: ReadonlyArray<{ path: string; content: string }> = [
  { path: 'file:///node_modules/@types/react/index.d.ts', content: reactIndex },
  { path: 'file:///node_modules/@types/react/global.d.ts', content: reactGlobal },
  { path: 'file:///node_modules/@types/react/jsx-runtime.d.ts', content: reactJsxRuntime },
  { path: 'file:///node_modules/@types/react-dom/index.d.ts', content: reactDomIndex },
  { path: 'file:///node_modules/@types/react-dom/client.d.ts', content: reactDomClient },
  { path: 'file:///node_modules/csstype/index.d.ts', content: csstype }
]
