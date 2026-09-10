import { describe, expect, it } from 'vitest'
import { READER_PROJECT_ORIGIN as origin, isReaderProjectPath, readerProjectUrl } from './previewProject'
describe('адрес текущего проекта Reader', () => {
  it('канонизирует HTTP алиас без порта', () => expect(readerProjectUrl('http://app.internal/#/machines')).toBe(origin + '/#/machines'))
  it('копия адреса текущего приложения сохраняет query и hash', () => expect(readerProjectUrl('http://localhost:8787/path?x=1#/admin', 'http://localhost:8787')).toBe(origin + '/path?x=1#/admin'))
  it('не подменяет другой порт и внешний сайт', () => { for (const value of ['http://localhost:5173/', 'https://example.com/']) expect(readerProjectUrl(value, 'http://localhost:8787')).toBe(value) })
  it('не скрывает credentials и нестандартный порт алиаса', () => { for (const value of ['https://user:secret@app.internal/', 'https://app.internal:9999/']) expect(readerProjectUrl(value)).toBe(value) })
  it('принимает реальные страницы, API и query с адресом', () => { for (const value of ['/','/api/session/login','/api/conversations?scope=web-reader','/path?next=https://example.com']) expect(isReaderProjectPath(value)).toBe(true) })
  it.each(['/api/preview?url=x','/%69nternal/reader/core','/mcp/preview','//other/path','/\\other/path'])('отклоняет рекурсию/служебный путь %s', path => expect(isReaderProjectPath(path)).toBe(false))
})
