import { describe, expect, it } from 'vitest'
import {
  isProjectStoryPath,
  storyPathMatches,
  storybookFrameUrlAt,
  machineOrigin,
  parseStorybookIndex,
  projectStorybookFrameUrl,
  storybookStoryId,
  storybookStoryName
} from './projectComponents'

describe('storybookStoryId', () => {
  it('повторяет правила toId из @storybook/csf', () => {
    expect(storybookStoryId('Chat/VoiceBar', 'Recording')).toBe('chat-voicebar--recording')
    expect(storybookStoryId('UI / Button', 'PrimaryLarge')).toBe('ui-button--primarylarge')
  })

  it('схлопывает пунктуацию и обрезает дефисы по краям', () => {
    // Кириллица и кавычки-ёлочки в набор пунктуации Storybook не входят — id остаётся с ними.
    expect(storybookStoryId('  Make / Панель ', 'Default!')).toBe('make-панель--default')
  })
})

describe('storybookStoryName', () => {
  it('разбивает CamelCase, как это делает Storybook без явного name', () => {
    expect(storybookStoryName('PrimaryButton')).toBe('Primary Button')
    expect(storybookStoryName('WithLongURLText')).toBe('With Long URL Text')
    expect(storybookStoryName('empty_state')).toBe('empty state')
  })
})

describe('parseStorybookIndex', () => {
  const index = {
    v: 5,
    entries: {
      'chat-voicebar--recording': { type: 'story', id: 'chat-voicebar--recording', name: 'Recording', title: 'Chat/VoiceBar', importPath: './src/components/VoiceBar.stories.tsx' },
      'chat-voicebar--idle': { type: 'story', id: 'chat-voicebar--idle', name: 'Idle', title: 'Chat/VoiceBar', importPath: './src/components/VoiceBar.stories.tsx' },
      'chat-voicebar--docs': { type: 'docs', id: 'chat-voicebar--docs', name: 'Docs', title: 'Chat/VoiceBar' },
      'ui-button--primary': { type: 'story', id: 'ui-button--primary', name: 'Primary', title: 'UI/Button', importPath: './src/components/ui/Button.stories.tsx' }
    }
  }

  it('группирует стори по компоненту и запоминает путь файла', () => {
    const components = parseStorybookIndex(index)
    expect(components.map((c) => c.title)).toEqual(['Chat/VoiceBar', 'UI/Button'])
    expect(components[0]?.stories.map((s) => s.id)).toEqual(['chat-voicebar--recording', 'chat-voicebar--idle'])
    expect(components[0]?.path).toBe('src/components/VoiceBar.stories.tsx')
  })

  it('пропускает записи docs — у них другой кадр', () => {
    const names = parseStorybookIndex(index).flatMap((c) => c.stories.map((s) => s.name))
    expect(names).not.toContain('Docs')
  })

  it('принимает старый формат stories и мусор без падения', () => {
    expect(parseStorybookIndex({ stories: { a: { id: 'a--b', title: 'A', name: 'B' } } })).toHaveLength(1)
    expect(parseStorybookIndex(null)).toEqual([])
    expect(parseStorybookIndex({ entries: { broken: { id: 42 } } })).toEqual([])
  })
})

describe('адреса кадра', () => {
  it('ведёт на iframe.html машины через прокси превью', () => {
    expect(machineOrigin('agent-1', 6006)).toBe('http://agent-1.machine.internal:6006')
    const url = new URL(projectStorybookFrameUrl('agent-1', 6006, 'ui-button--primary'), 'http://chat.local')
    expect(url.pathname).toBe('/api/preview')
    const target = new URL(url.searchParams.get('url') ?? '')
    expect(target.host).toBe('agent-1.machine.internal:6006')
    expect(target.pathname).toBe('/iframe.html')
    // Storybook читает выбор стори из адреса документа, то есть из НАШЕГО query.
    expect(target.search).toBe('')
    expect(url.searchParams.get('id')).toBe('ui-button--primary')
    expect(url.searchParams.get('viewMode')).toBe('story')
  })
})

describe('isProjectStoryPath', () => {
  it('узнаёт CSF-файлы любого нашего расширения', () => {
    expect(isProjectStoryPath('src/Button.stories.tsx')).toBe(true)
    expect(isProjectStoryPath('src/Button.stories.js')).toBe(true)
    expect(isProjectStoryPath('src/Button.test.tsx')).toBe(false)
    expect(isProjectStoryPath('src/stories/readme.md')).toBe(false)
  })
})

describe('storyPathMatches', () => {
  const repo = ['packages/ui/src/components/VoiceBar.stories.tsx', 'packages/admin-app/src/AdminApp.stories.tsx']

  it('узнаёт путь, относительный пакету: Storybook запускают из packages/ui', () => {
    // Так отвечает живой индекс, поднятый командой `npm run -w @voicechat/ui storybook`.
    expect(storyPathMatches('./src/components/VoiceBar.stories.tsx', repo)).toBe(true)
    expect(storyPathMatches('src/components/VoiceBar.stories.tsx', repo)).toBe(true)
  })

  it('принимает точное совпадение и путь длиннее репозиторного', () => {
    expect(storyPathMatches('packages/admin-app/src/AdminApp.stories.tsx', repo)).toBe(true)
    expect(storyPathMatches('/abs/repo/packages/ui/src/components/VoiceBar.stories.tsx', repo)).toBe(true)
  })

  it('чужой индекс не считает своим', () => {
    expect(storyPathMatches('src/components/Other.stories.tsx', repo)).toBe(false)
    expect(storyPathMatches('', repo)).toBe(false)
  })
})

describe('storybookFrameUrlAt', () => {
  it('собирает прямой адрес кадра без прокси', () => {
    expect(storybookFrameUrlAt('http://127.0.0.1:6006', 'ui-button--primary'))
      .toBe('http://127.0.0.1:6006/iframe.html?viewMode=story&id=ui-button--primary')
    expect(storybookFrameUrlAt('http://127.0.0.1:6006/', 'a--b')).toContain('6006/iframe.html')
  })
})
