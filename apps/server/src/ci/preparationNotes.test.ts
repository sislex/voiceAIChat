import { describe, it, expect } from 'vitest'
import { preparationDesignNote } from './preparationNotes.js'
import type { TaskDesignLink, LlmMakeSource } from '@voicechat/shared'

const design: TaskDesignLink = { id: 'l1', taskId: 't1', conversationId: 'conv-make', conversationTitle: 'Проект 14', conversationOwner: 'u', path: '', mode: 'whole_project', paths: [], label: 'Проект 14', createdBy: 'u', createdAt: 0 }
const source: LlmMakeSource = { name: 'make_design_1', conversationId: 'conv-make', mode: 'whole_project', paths: [], mcpUrl: 'http://mcp' }

describe('preparationDesignNote — что модель подготовки узнаёт о дизайне', () => {
  it('без связей молчит: задача без макета не должна получать лишний текст', () => {
    expect(preparationDesignNote([], [])).toBe('')
  })

  it('со связью и источником называет инструменты и запрещает ходить по URL', () => {
    const note = preparationDesignNote([design], [source])
    expect(note).toContain('mcp__make_design_1__make_read_file')
    expect(note).toContain('весь проект')
    expect(note).toContain('источник истины')
    // Ровно та ошибка, с которой начался фикс: модель искала опубликованную
    // страницу по URL и блокировала подготовку вопросом.
    expect(note).toContain('по URL открывать не нужно')
  })

  it('в файловом режиме перечисляет разрешённые пути', () => {
    const note = preparationDesignNote([{ ...design, mode: 'files', paths: ['index.html'] }], [{ ...source, mode: 'files', paths: ['index.html'] }])
    expect(note).toContain('файлы: index.html')
  })

  it('связь без источников называется недоступностью, а не поводом искать URL', () => {
    const note = preparationDesignNote([design], [])
    expect(note).toContain('недоступны')
    expect(note).toContain('не ищи опубликованную страницу')
  })
})
