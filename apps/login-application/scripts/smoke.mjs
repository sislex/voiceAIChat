import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const release = join(import.meta.dirname, '..', 'release')
if (!existsSync(release)) throw new Error('release directory not found; run dist first')
const dmg = readdirSync(release).find((name) => name.endsWith('-arm64.dmg') || name.endsWith('.dmg'))
if (!dmg) throw new Error('macOS ARM64 DMG not found')
const appDir = readdirSync(release).find((name) => name.endsWith('-arm64'))
if (!appDir) throw new Error('unpacked macOS ARM64 application not found')
const plist = join(release, appDir, 'VoiceChat Login.app', 'Contents', 'Info.plist')
if (!existsSync(plist)) throw new Error('packaged .app metadata not found')
const metadata = readFileSync(plist, 'utf8')
if (!metadata.includes('voicechat-login')) throw new Error('voicechat-login protocol is absent from packaged metadata')
console.log(`packaged smoke ok: ${dmg}`)
