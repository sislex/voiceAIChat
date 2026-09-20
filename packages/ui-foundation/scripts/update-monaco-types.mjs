// Bundle editor type declarations so installed UI Foundation never depends on a monorepo layout.
import {createRequire} from 'node:module'
import {dirname,join} from 'node:path'
import {mkdirSync,readFileSync,writeFileSync} from 'node:fs'
import {fileURLToPath} from 'node:url'
import {createHash} from 'node:crypto'
const require=createRequire(import.meta.url)
const target=fileURLToPath(new URL('../src/components/code/type-libs/',import.meta.url))
mkdirSync(target,{recursive:true})
const declarations={
 '@types/react':{'index.d.ts':'react-index.d.ts.txt','global.d.ts':'react-global.d.ts.txt','jsx-runtime.d.ts':'react-jsx-runtime.d.ts.txt'},
 '@types/react-dom':{'index.d.ts':'react-dom-index.d.ts.txt','client.d.ts':'react-dom-client.d.ts.txt'},
 csstype:{'index.d.ts':'csstype-index.d.ts.txt'}
}
const packages={}
for(const [name,files] of Object.entries(declarations)){
 const root=dirname(require.resolve(name+'/package.json'))
 const pkg=JSON.parse(readFileSync(join(root,'package.json'),'utf8'))
 const license=name.replaceAll('@','').replaceAll('/','-')+'.LICENSE.txt'
 writeFileSync(join(target,license),readFileSync(join(root,'LICENSE')))
 packages[name]={version:pkg.version,license,files:{}}
 for(const [source,output] of Object.entries(files)){
  const content=readFileSync(join(root,source))
  writeFileSync(join(target,output),content)
  packages[name].files[output]={source,sha256:createHash('sha256').update(content).digest('hex')}
 }
}
writeFileSync(join(target,'sources.json'),JSON.stringify({schemaVersion:1,packages},null,2)+'\n')
