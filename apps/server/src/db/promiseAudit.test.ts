// Гейт слоя данных: каждый вызов с типом Promise в репозиториях стоит под await. Компилятор этого
// не ловит: параметр запроса — `unknown`, и промис молча уехал бы в базу строкой «[object Promise]»;
// висящий вызов `insert.run(...)` без await — потерянная запись без единой ошибки. Тест строит
// программу через TypeScript API и обходит все вызовы в apps/server/src/db (кроме тестов, адаптера и
// обвязки портов в repos/base.ts — та промисы возвращает намеренно).
import { join, relative } from 'node:path'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'

const serverDir = join(__dirname, '..', '..')
const root = join(serverDir, '..', '..')

describe('слой данных: промисы под await', () => {
  it('в db/repos и database.ts нет вызовов с типом Promise вне await/return/Promise.all', () => {
    const cfg = ts.getParsedCommandLineOfConfigFile(join(serverDir, 'tsconfig.json'), {}, { ...ts.sys, onUnRecoverableConfigFileDiagnostic: (d) => { throw new Error(String(d.messageText)) } })!
    const program = ts.createProgram(cfg.fileNames, { ...cfg.options, incremental: false, noEmit: true })
    const checker = program.getTypeChecker()
    const isPromise = (t: ts.Type): boolean => t.isUnion() ? t.types.some(isPromise) : t.getSymbol()?.getName() === 'Promise'
    const files = program.getSourceFiles().filter((sf) => sf.fileName.includes('/apps/server/src/db/') && !sf.fileName.endsWith('.test.ts') && !sf.fileName.includes('/db/sql/') && !sf.fileName.endsWith('/repos/base.ts'))
    expect(files.length).toBeGreaterThan(10)
    const offenders: string[] = []
    for (const sf of files) {
      const visit = (node: ts.Node): void => {
        if ((ts.isCallExpression(node) || ts.isNewExpression(node)) && isPromise(checker.getTypeAtLocation(node))) {
          const p = node.parent
          const ok = ts.isAwaitExpression(p)
            || (ts.isParenthesizedExpression(p) && ts.isAwaitExpression(p.parent))
            || ts.isReturnStatement(p) || ts.isArrowFunction(p)
            || (ts.isPropertyAccessExpression(p) && ['then', 'catch', 'finally'].includes(p.name.text))
            || ts.isVoidExpression(p)
            || (ts.isArrayLiteralExpression(p) && ts.isCallExpression(p.parent) && p.parent.expression.getText(sf) === 'Promise.all')
            || (ts.isCallExpression(p) && ['Promise.all', 'Promise.allSettled', 'Promise.race'].includes(p.expression.getText(sf)))
            || (ts.isVariableDeclaration(p) && !!p.type && /Promise</.test(p.type.getText(sf)))
            // `this.ready = this.init()` — промис хранится намеренно.
            || (ts.isBinaryExpression(p) && p.operatorToken.kind === ts.SyntaxKind.EqualsToken && isPromise(checker.getTypeAtLocation(p.left)))
          if (!ok) offenders.push(`${relative(root, sf.fileName)}:${sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1}: ${node.getText(sf).replace(/\s+/g, ' ').slice(0, 80)}`)
        }
        ts.forEachChild(node, visit)
      }
      visit(sf)
    }
    expect(offenders).toEqual([])
  }, 120_000)
})
