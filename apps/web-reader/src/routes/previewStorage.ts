/** Браузерные хранилища используют логический origin, сохраняя привычный API Storage/IDB. */
export function previewStorageScript(prefix: string): string {
  return `const storagePrefix=${JSON.stringify(prefix)};
const rawStorages={};
const storageString=(value)=>{if(typeof value==='symbol')throw new TypeError('Cannot convert a Symbol value to a string');return String(value)};
const storageKeys=(native)=>{const keys=[];for(let i=0;i<native.length;i++){const key=native.key(i);if(key!==null&&key.startsWith(storagePrefix))keys.push(key.slice(storagePrefix.length))}return keys};
const fallbackStorage=()=>{const values=new Map();return {get length(){return values.size},key(i){return [...values.keys()][i]??null},getItem(k){return values.get(k)??null},setItem(k,v){values.set(k,v)},removeItem(k){values.delete(k)},clear(){values.clear()}}};
const makeStorage=(native)=>{
  const required=(args,count)=>{if(args.length<count)throw new TypeError('Not enough arguments for Storage')};
  const methods={
    key(...args){required(args,1);return storageKeys(native)[Number(args[0])>>>0]??null},
    getItem(...args){required(args,1);return native.getItem(storagePrefix+storageString(args[0]))},
    setItem(...args){required(args,2);native.setItem(storagePrefix+storageString(args[0]),storageString(args[1]))},
    removeItem(...args){required(args,1);native.removeItem(storagePrefix+storageString(args[0]))},
    clear(){for(const key of storageKeys(native))native.removeItem(storagePrefix+key)}
  };
  const target=Object.create(typeof Storage==='function'?Storage.prototype:Object.prototype);
  return new Proxy(target,{
    get(target,key,receiver){if(key==='length')return storageKeys(native).length;if(Object.hasOwn(methods,key))return methods[key];if(typeof key==='string'&&!(key in target)){const value=native.getItem(storagePrefix+key);return value===null?undefined:value}return Reflect.get(target,key,receiver)},
    set(_target,key,value){if(typeof key!=='string'||key==='length')return false;methods.setItem(key,value);return true},
    deleteProperty(_target,key){if(typeof key==='string')methods.removeItem(key);return true},
    has(target,key){return Reflect.has(target,key)||typeof key==='string'&&native.getItem(storagePrefix+key)!==null},
    ownKeys(){return storageKeys(native).filter(key=>key!=='length')},
    getOwnPropertyDescriptor(target,key){if(typeof key==='string'&&!(key in target)){const value=native.getItem(storagePrefix+key);if(value!==null)return {configurable:true,enumerable:true,writable:true,value}}},
    defineProperty(_target,key,descriptor){if(typeof key!=='string'||key==='length'||!('value' in descriptor))return false;methods.setItem(key,descriptor.value);return true}
  })
};
for(const name of ['localStorage','sessionStorage']){
  let native;try{native=window[name]}catch{native=fallbackStorage()}
  rawStorages[name]=native;
  try{Object.defineProperty(window,name,{configurable:true,value:makeStorage(native)})}catch{}
}
// Родительский origin может хранить свои токены: чужие storage events не должны
// попадать в сайт, а его собственные ключи и URL должны выглядеть привычно.
addEventListener('storage',event=>{
  const name=event.storageArea===rawStorages.localStorage?'localStorage':event.storageArea===rawStorages.sessionStorage?'sessionStorage':null;
  if(!name)return;
  if(event.key!==null&&!event.key.startsWith(storagePrefix)){event.stopImmediatePropagation();return}
  let url=event.url;try{const outer=new URL(url);if(outer.pathname==='/api/preview'&&outer.searchParams.has('url')){const logical=new URL(outer.searchParams.get('url'));if(outer.hash)logical.hash=outer.hash;url=logical.toString()}}catch{}
  try{Object.defineProperties(event,{key:{value:event.key===null?null:event.key.slice(storagePrefix.length)},storageArea:{value:window[name]},url:{value:url}})}catch{}
},true);
const nativeIdb=window.indexedDB;
if(nativeIdb)try{
  Object.defineProperty(window,'indexedDB',{configurable:true,value:new Proxy(nativeIdb,{get(target,key){const value=Reflect.get(target,key,target);
    if(key==='open'||key==='deleteDatabase')return (...args)=>{if(!args.length)throw new TypeError('A database name is required');return value.call(target,storagePrefix+storageString(args[0]),...args.slice(1))};
    if(key==='databases'&&typeof value==='function')return ()=>value.call(target).then(databases=>databases.filter(db=>typeof db.name==='string'&&db.name.startsWith(storagePrefix)).map(db=>({...db,name:db.name.slice(storagePrefix.length)})));
    return typeof value==='function'?value.bind(target):value
  }})});
  const name=typeof IDBDatabase==='function'?Object.getOwnPropertyDescriptor(IDBDatabase.prototype,'name'):null;
  if(name&&name.get&&name.configurable)Object.defineProperty(IDBDatabase.prototype,'name',{...name,get(){const value=name.get.call(this);return value.startsWith(storagePrefix)?value.slice(storagePrefix.length):value}})
}catch{}
`;
}
