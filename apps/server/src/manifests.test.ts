import { describe,expect,it } from 'vitest'
import { ManifestError,parseEnvironmentManifest,type EnvironmentManifest } from '@voicechat/shared'
import { publishRemoteManifest,type RemoteManifestFs } from './manifests.js'
const manifest:EnvironmentManifest={formatVersion:1,projectId:'p1',kind:'production',machineId:'m1',storageId:'s1',createdAt:'2026-08-22T10:20:30.000Z'}
class MemoryFs implements RemoteManifestFs{
  files=new Map<string,string>(); renamed:string[]=[]; failRename=false
  async read(_m:string,path:string){const value=this.files.get(path);if(value===undefined)throw new Error('ENOENT');return {dataBase64:Buffer.from(value).toString('base64')}}
  async write(_m:string,path:string,data:string){this.files.set(path,Buffer.from(data,'base64').toString())}
  async mkdir(){}
  async rename(_m:string,from:string,to:string){if(this.failRename)throw new Error('rename failed');const value=this.files.get(from);if(value===undefined)throw new Error('missing temp');this.files.set(to,value);this.files.delete(from);this.renamed.push(to)}
  async delete(_m:string,path:string){this.files.delete(path)}
}
describe('remote manifest publisher',()=>{
  it('publishes atomically in target directory and confirms identical content',async()=>{
    const fs=new MemoryFs();expect(await publishRemoteManifest(fs,'m1','/env/environment.json',manifest,parseEnvironmentManifest)).toBe('created')
    const bytes=fs.files.get('/env/environment.json');expect(bytes).toContain('"createdAt"');expect(fs.renamed).toEqual(['/env/environment.json'])
    expect(await publishRemoteManifest(fs,'m1','/env/environment.json',manifest,parseEnvironmentManifest)).toBe('confirmed');expect(fs.files.get('/env/environment.json')).toBe(bytes)
  })
  it('preserves corrupt, unsupported and conflicting targets',async()=>{
    for(const value of ['{',JSON.stringify({...manifest,formatVersion:999}),JSON.stringify({...manifest,projectId:'other'})]){
      const fs=new MemoryFs();fs.files.set('/env/environment.json',value)
      await expect(publishRemoteManifest(fs,'m1','/env/environment.json',manifest,parseEnvironmentManifest)).rejects.toBeInstanceOf(ManifestError)
      expect(fs.files.get('/env/environment.json')).toBe(value)
    }
  })
  it('does not expose a partial target when rename fails',async()=>{
    const fs=new MemoryFs();fs.failRename=true
    await expect(publishRemoteManifest(fs,'m1','/env/environment.json',manifest,parseEnvironmentManifest)).rejects.toThrow('rename failed')
    expect(fs.files.has('/env/environment.json')).toBe(false);expect([...fs.files.keys()]).toEqual([])
  })
})
