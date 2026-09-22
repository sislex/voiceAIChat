import ts from 'typescript'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { expect, it } from 'vitest'

const src = join(__dirname, '..')
function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((file) => file.isDirectory() ? walk(join(dir, file.name)) : [join(dir, file.name)])
}

it('ядро не владеет хранилищем и роутами галереи, подключает реализацию только при сборке процесса', () => {
  for (const old of ['images/studio.ts', 'routes/imageStudio.ts', 'llm/imageStudioGenerator.ts']) {
    expect(existsSync(join(src, old)), old).toBe(false)
  }
  const forbidden: string[] = []
  for (const file of walk(src).filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts'))) {
    const rel = relative(src, file)
    if (rel === 'server.ts' || rel.startsWith('imageStudioBridge/')) continue
    const source=ts.createSourceFile(file,readFileSync(file,'utf8'),ts.ScriptTarget.Latest,true)
    const visit=(node:ts.Node):void=>{
      if(ts.isImportDeclaration(node)&&ts.isStringLiteral(node.moduleSpecifier)&&node.moduleSpecifier.text.startsWith('@sislexa/image-studio/image-studio/index')){
        const clause=node.importClause
        const named=clause?.namedBindings
        const typeOnly=clause?.isTypeOnly||(!clause?.name&&named&&ts.isNamedImports(named)&&named.elements.every(element=>element.isTypeOnly))
        if(!typeOnly)forbidden.push(rel)
      }
      if(ts.isCallExpression(node)&&node.expression.kind===ts.SyntaxKind.ImportKeyword&&node.arguments[0]&&ts.isStringLiteral(node.arguments[0])&&node.arguments[0].text.startsWith('@sislexa/image-studio/image-studio/index'))forbidden.push(rel)
      ts.forEachChild(node,visit)
    }
    visit(source)
  }
  expect(forbidden).toEqual([])
})
