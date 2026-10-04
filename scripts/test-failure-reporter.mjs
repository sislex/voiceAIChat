import { writeFileSync } from 'node:fs'
import { relative, isAbsolute } from 'node:path'

export default async function* reporter(source) {
  const failed = new Set()
  for await (const event of source) {
    if (event.type === 'test:fail' && event.data.file) {
      const file = relative(process.env.GATE_REPOSITORY_ROOT, event.data.file).replaceAll('\\', '/')
      if (!file.startsWith('../') && !isAbsolute(file)) failed.add(file)
    }
    if (event.type === 'test:pass' || event.type === 'test:fail')
      yield `${event.type}: ${event.data.name}\n`
    if (event.type === 'test:fail') yield `${event.data.details?.error?.stack ?? event.data.details?.error ?? ''}\n`
    if (event.type === 'test:stdout' || event.type === 'test:stderr') yield event.data.message
  }
  writeFileSync(process.env.GATE_TEST_REPORT, JSON.stringify([...failed]))
}
