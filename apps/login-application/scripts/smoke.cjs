const { execFileSync } = require('node:child_process')
const { existsSync, readFileSync } = require('node:fs')
const { join } = require('node:path')

const release = join(__dirname, '..', 'release')
const dmg = join(release, 'voicechat-login-macos-arm64.dmg')
if (process.platform !== 'darwin' || process.arch !== 'arm64') {
  throw new Error('Packaged smoke requires an Apple Silicon macOS host')
}
if (!existsSync(dmg)) throw new Error(`DMG not found: ${dmg}`)
execFileSync('hdiutil', ['verify', dmg], { stdio: 'inherit' })
const appPath = join(release, 'mac-arm64', 'Голос·Чат Login.app')
const plistPath = join(appPath, 'Contents', 'Info.plist')
if (!existsSync(plistPath)) throw new Error('Packaged .app or Info.plist is missing')
const plist = readFileSync(plistPath)
if (!plist.includes(Buffer.from('voicechat-login'))) throw new Error('voicechat-login protocol is absent from Info.plist')
execFileSync('codesign', ['--verify', '--deep', '--strict', appPath], { stdio: 'inherit' })
console.log('Packaged macOS ARM64 smoke passed')
