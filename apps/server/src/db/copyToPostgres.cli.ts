// Перенос базы из SQLite в Postgres: `npx tsx apps/server/src/db/copyToPostgres.cli.ts --sqlite <файл> --url <postgres://…> [--schema public]`.
// Целевая схема должна быть пустой или уже содержать актуальную схему (INSERT … ON CONFLICT DO NOTHING —
// повтор не дублирует строки, но и не обновляет их).
import { copySqliteToPostgres } from './copyToPostgres.js'

const args = new Map<string, string>()
for (let i = 2; i < process.argv.length; i += 2) args.set(process.argv[i]!.replace(/^--/, ''), process.argv[i + 1] ?? '')
const sqlitePath = args.get('sqlite')
const url = args.get('url')
if (!sqlitePath || !url) {
  console.error('использование: copyToPostgres.cli.ts --sqlite <voicechat.db> --url <postgres://user:pass@host/db> [--schema <имя>]')
  process.exit(2)
}
const started = Date.now()
const report = await copySqliteToPostgres({ sqlitePath, postgres: { url, ...(args.get('schema') ? { schema: args.get('schema')! } : {}) }, log: (line) => console.log(line) })
const mismatched = Object.entries(report.tables).filter(([, t]) => t.sqlite !== t.postgres)
console.log(`\nготово за ${Math.round((Date.now() - started) / 1000)} с: таблиц ${Object.keys(report.tables).length}, расхождений ${mismatched.length}`)
for (const [name, t] of mismatched) console.log(`  ${name}: sqlite ${t.sqlite}, postgres ${t.postgres}`)
process.exit(mismatched.length ? 1 : 0)
