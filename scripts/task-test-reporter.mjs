// @ts-check
import { writeFileSync } from 'node:fs'

// Persist after each result so a timed-out runner still has useful evidence.
export default async function* reporter(source) {
  const destination = process.env.GATE_TASK_REPORT
  if (!destination) throw Error('Missing GATE_TASK_REPORT')
  /** @type {{numTotalTests: number, testResults: {name: string, assertionResults: {fullName: string, duration: number}[]}[]}} */
  const report = { numTotalTests: 0, testResults: [] }
  for await (const { type, data } of source) {
    if ((type === 'test:pass' || type === 'test:fail') && data.details?.type !== 'suite') {
      report.numTotalTests++
      report.testResults.push({ name: data.file ?? 'node:test', assertionResults: [
        { fullName: data.name, duration: data.details?.duration_ms ?? 0 }
      ] })
      writeFileSync(destination, JSON.stringify(report))
      yield `${type}: ${data.name}\n`
      if (type === 'test:fail') yield `${data.details?.error?.stack ?? data.details?.error}\n`
    }
    if (type === 'test:stdout' || type === 'test:stderr') yield data.message
  }
  writeFileSync(destination, JSON.stringify(report))
}
