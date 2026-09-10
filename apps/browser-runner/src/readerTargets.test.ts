import { describe, expect, it } from 'vitest'
import { validatePublicUrl } from './security.js'
const targets = new Set(['127.0.0.1:8799', 'localhost:8080', '[::1]:9000'])
describe('явный loopback origin своего ядра', () => {
  it.each(['http://127.0.0.1:8799/', 'http://localhost:8080/', 'http://[::1]:9000/'])('пропускает точный адрес оператора %s', url => { expect(validatePublicUrl(url, targets).href).toBe(url) })
  it.each(['http://127.0.0.1:22/', 'http://localhost:8081/', 'http://[::1]:9001/', 'http://10.0.0.1:8799/'])('не расширяет доступ на %s', url => { expect(() => validatePublicUrl(url, targets)).toThrow('private network') })
  it('без конфигурации loopback остаётся закрыт', () => { expect(() => validatePublicUrl('http://127.0.0.1:8799/')).toThrow('private network') })
})
