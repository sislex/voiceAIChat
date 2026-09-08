// Caddyfile не должен содержать захардкоженный адрес стенда.
//
// Он уже менялся при переезде (45.135.182.251 → 89.125.68.35), и файл остался со
// старым IP: прод работал только потому, что действующая конфигурация была
// загружена мимо файла, а контейнер Caddy с тех пор не пересоздавался. Первое же
// пересоздание подняло бы Caddy со старым адресом — и https перестал бы
// отвечать.
//
// @vitest-environment node
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const caddyfile = readFileSync(fileURLToPath(new URL('../../../Caddyfile', import.meta.url)), 'utf8')
const compose = readFileSync(fileURLToPath(new URL('../../../docker-compose.yml', import.meta.url)), 'utf8')

describe('Caddyfile', () => {
  it('не содержит IP-адресов: хост приходит переменной окружения', () => {
    const literals = caddyfile.split('\n')
      .filter((line) => !line.trim().startsWith('#'))
      .flatMap((line) => line.match(/\b\d{1,3}(?:\.\d{1,3}){3}\b/g) ?? [])
    expect(literals).toEqual([])
  })

  it('публичный хост подставляется из VC_PUBLIC_HOST', () => {
    expect(caddyfile).toContain('{$VC_PUBLIC_HOST}')
    expect(compose).toContain('VC_PUBLIC_HOST')
  })

  it('внутреннее имя `caddy` обслуживается со своим сертификатом', () => {
    // Без него браузерный раннер не откроет наш https: до публичного IP хоста
    // контейнер не достаёт, а подмена адреса алиасом меняет SNI.
    expect(caddyfile).toMatch(/https:\/\/caddy\s*\{[^}]*tls internal/s)
  })

  it('переменная обязательна в compose — пустой хост поднимет Caddy ни на что', () => {
    expect(compose).toMatch(/VC_PUBLIC_HOST:\s*\$\{VC_PUBLIC_HOST:\?/)
  })

  it('пути Make уходят в сервис make на обоих виртуальных хостах, внутренний API наружу закрыт', () => {
    const blocks = caddyfile.match(/(?:https:\/\/\{\$VC_PUBLIC_HOST\}|https:\/\/caddy)\s*\{[\s\S]*?\n\}/g) ?? []
    expect(blocks).toHaveLength(2)
    for (const block of blocks) {
      expect(block).toMatch(/@make path [^\n]*\/api\/make\/\*[^\n]*\/p\/\*/)
      expect(block).toMatch(/handle @make \{\s*reverse_proxy make:8788/)
      expect(block).toMatch(/handle \/internal\/\* \{\s*respond 404/)
    }
    expect(compose).toMatch(/^  make:\n/m)
    expect(compose).toContain('VC_MAKE_MODE: remote')
  })

  it('API Playwright Reader на обоих хостах идёт в отдельное приложение', () => {
    expect(caddyfile.match(/reverse_proxy playwright-reader:8796/g)).toHaveLength(2)
    expect(caddyfile.match(/@playwright_reader path \/api\/browser \/api\/browser\/\*/g)).toHaveLength(2)
    expect(compose).toMatch(/^  playwright-reader:\n/m)
    expect(compose).toContain('VC_PLAYWRIGHT_READER_MODE: remote')
    expect(compose).toContain('VC_PLAYWRIGHT_READER_URL: http://playwright-reader:8796')
  })
})
