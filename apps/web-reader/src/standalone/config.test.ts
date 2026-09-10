import { describe, expect, it } from 'vitest'
import { loadWebReaderConfig } from './config.js'

describe('независимая конфигурация Web Reader', () => {
  it('embedded Playwright использует ядро даже при сохранённом адресе отдельного API', () => {
    expect(loadWebReaderConfig({ VC_CORE_URL: 'http://core', VC_PLAYWRIGHT_READER_MODE: 'embedded', VC_PLAYWRIGHT_READER_URL: 'http://old-api' }).playwrightReaderUrl).toBe('http://core')
    expect(loadWebReaderConfig({ VC_PLAYWRIGHT_READER_URL: 'http://api' }).playwrightReaderUrl).toBe('http://api')
  })
  it('явный remote без адреса отклоняется; БД не входит в конфигурацию', () => {
    expect(() => loadWebReaderConfig({ VC_PLAYWRIGHT_READER_MODE: 'remote' })).toThrow('VC_PLAYWRIGHT_READER_URL')
    expect(loadWebReaderConfig({ VC_DB_URL: 'postgres://unused' })).not.toHaveProperty('dbUrl')
  })
})
