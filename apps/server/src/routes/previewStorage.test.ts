import { JSDOM } from 'jsdom'
import { describe, expect, it } from 'vitest'
import { previewStorageScript } from './previewStorage'
function fixture(blocked = false) {
  const dom = new JSDOM('<!doctype html>', { url: 'http://reader.test/api/preview?url=https%3A%2F%2Fsite.test%2F', runScripts: 'dangerously' })
  const w = dom.window, native = w.localStorage
  if (blocked) Object.defineProperty(w, 'localStorage', { configurable: true, get() { throw new w.DOMException('blocked', 'SecurityError') } })
  w.eval(previewStorageScript('site:'))
  return { w, native, close: () => w.close() }
}
describe('контекст Storage внутри Reader', () => {
  it('читает ключи через свойства', () => { const f=fixture();try { f.native.setItem('site:name','Аня'); expect(f.w.localStorage.name).toBe('Аня'); expect(f.w.localStorage.missing).toBeUndefined() }finally{f.close()} })
  it('присваивание свойств сохраняет namespaced значение', () => { const f=fixture();try { f.w.localStorage.name='Аня'; expect(f.native.getItem('site:name')).toBe('Аня'); expect(f.native.getItem('name')).toBeNull() }finally{f.close()} })
  it('delete удаляет только текущий origin', () => { const f=fixture();try { f.native.setItem('other:name','другой'); f.w.localStorage.name='Аня'; delete f.w.localStorage.name; expect(f.native.getItem('site:name')).toBeNull(); expect(f.native.getItem('other:name')).toBe('другой') }finally{f.close()} })
  it('enumeration и JSON видят только сохранённые ключи', () => { const f=fixture();try { f.native.setItem('other:token','private'); f.w.localStorage.setItem('one','1'); expect(Object.keys(f.w.localStorage)).toEqual(['one']); expect(JSON.parse(JSON.stringify(f.w.localStorage))).toEqual({one:'1'}); expect('one' in f.w.localStorage).toBe(true) }finally{f.close()} })
  it('сохраняет prototype, instanceof и identity методов', () => { const f=fixture();try { expect(f.w.localStorage instanceof f.w.Storage).toBe(true); expect(Object.getPrototypeOf(f.w.localStorage)).toBe(f.w.Storage.prototype); expect(Object.prototype.toString.call(f.w.localStorage)).toBe('[object Storage]'); expect(f.w.localStorage.getItem).toBe(f.w.localStorage.getItem) }finally{f.close()} })
  it('key приводит индекс, методы проверяют обязательные аргументы', () => { const f=fixture();try { f.w.localStorage.setItem('first','1'); expect(f.w.localStorage.key(Number.NaN)).toBe('first'); expect(f.w.localStorage.key(-1)).toBeNull(); expect(()=>f.w.eval('localStorage.setItem("x")')).toThrow(); expect(()=>f.w.eval('localStorage.getItem(Symbol())')).toThrow() }finally{f.close()} })
  it('clear сохраняет данные host и другого сайта', () => { const f=fixture();try { f.native.setItem('host','private'); f.native.setItem('other:name','other'); f.w.localStorage.setItem('name','mine'); f.w.localStorage.clear(); expect(f.w.localStorage.length).toBe(0); expect(f.native.length).toBe(2) }finally{f.close()} })
  it('StorageEvent скрывает чужие ключи и возвращает собственный API', () => { const f=fixture();try { const events: StorageEvent[]=[]; f.w.addEventListener('storage',e=>events.push(e as unknown as StorageEvent)); f.w.dispatchEvent(new f.w.StorageEvent('storage',{key:'other:token',storageArea:f.native})); f.w.dispatchEvent(new f.w.StorageEvent('storage',{key:'site:name',newValue:'value',storageArea:f.native,url:'http://reader.test/api/preview?url=https%3A%2F%2Fsite.test%2Fsettings'})); expect(events).toHaveLength(1); expect(events[0].key).toBe('name'); expect(events[0].url).toBe('https://site.test/settings'); expect(events[0].storageArea).toBe(f.w.localStorage) }finally{f.close()} })
  it('SecurityError localStorage не ломает остальные мосты и sessionStorage', () => { const f=fixture(true);try { f.w.localStorage.setItem('ephemeral','ok'); expect(f.w.localStorage.ephemeral).toBe('ok'); f.w.sessionStorage.value='session'; expect(f.w.sessionStorage.getItem('value')).toBe('session') }finally{f.close()} })
  it('defineProperty хранит значение без изменения прототипа', () => { const f=fixture();try { Object.defineProperty(f.w.localStorage,'name',{value:'one',configurable:true}); expect(f.w.localStorage.getItem('name')).toBe('one'); f.w.localStorage.setItem('__proto__','safe'); expect(Object.getPrototypeOf(f.w.localStorage)).toBe(f.w.Storage.prototype) }finally{f.close()} })
})
