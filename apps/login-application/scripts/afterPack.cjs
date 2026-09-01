// Ad-hoc подпись .app после упаковки: на Apple Silicon неподписанное приложение
// macOS считает «повреждённым» и не запускает. Ad-hoc подпись (codesign -s -)
// позволяет открыть через ПКМ → «Открыть» (Gatekeeper покажет обычное
// предупреждение о неизвестном разработчике вместо «damaged»).

const { execFileSync } = require('node:child_process')
const { join } = require('node:path')

exports.default = async function afterPack(context) {
  if (context.electronPlatformName !== 'darwin') return
  const appName = `${context.packager.appInfo.productFilename}.app`
  const appPath = join(context.appOutDir, appName)
  execFileSync('codesign', ['--force', '--deep', '--sign', '-', appPath], { stdio: 'inherit' })
  console.log(`  • ad-hoc подпись применена  app=${appName}`)
}
