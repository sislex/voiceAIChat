import { lookup } from 'node:dns/promises'
import type { LookupAddress } from 'node:dns'
import { isIP } from 'node:net'
import { request as httpRequest } from 'node:http'
import { request as httpsRequest } from 'node:https'
import type { IncomingMessage } from 'node:http'
import type { FastifyInstance } from 'fastify'
import type { AgentHttpRequest, AgentHttpResponse } from '@voicechat/shared'
import { uid } from '../users/auth.js'

const MAX_REDIRECTS = 5
const MAX_BYTES = 5 * 1024 * 1024
const TIMEOUT_MS = 10_000

type StoredCookie = { name: string; value: string; domain: string; path: string; secure: boolean; expires?: number }
const cookiesByUser = new Map<string, StoredCookie[]>()

function parseCookie(line: string, url: URL): StoredCookie | null {
  const [pair, ...attributes] = line.split(';').map((part) => part.trim())
  const split = pair.indexOf('=')
  if (split < 1) return null
  const cookie: StoredCookie = { name: pair.slice(0, split), value: pair.slice(split + 1), domain: url.hostname, path: url.pathname.replace(/\/[^/]*$/, '/') || '/', secure: false }
  for (const attribute of attributes) {
    const [key, ...rest] = attribute.split('=')
    const value = rest.join('=').trim()
    switch (key.toLowerCase()) {
      case 'domain': if (value) cookie.domain = value.replace(/^\./, '').toLowerCase(); break
      case 'path': if (value.startsWith('/')) cookie.path = value; break
      case 'secure': cookie.secure = true; break
      case 'max-age': { const seconds = Number(value); if (Number.isFinite(seconds)) cookie.expires = Date.now() + seconds * 1000; break }
      case 'expires': { const expires = Date.parse(value); if (!Number.isNaN(expires)) cookie.expires = expires; break }
    }
  }
  if (url.hostname !== cookie.domain && !url.hostname.endsWith('.' + cookie.domain)) return null
  return cookie
}

export function storeResponseCookies(userId: string, url: URL, setCookie: string | string[] | undefined): void {
  const lines = setCookie === undefined ? [] : Array.isArray(setCookie) ? setCookie : [setCookie]
  const cookies = (cookiesByUser.get(userId) ?? []).filter((cookie) => !cookie.expires || cookie.expires > Date.now())
  for (const line of lines) {
    const cookie = parseCookie(line, url)
    if (!cookie) continue
    const index = cookies.findIndex((item) => item.name === cookie.name && item.domain === cookie.domain && item.path === cookie.path)
    if (cookie.expires !== undefined && cookie.expires <= Date.now()) { if (index >= 0) cookies.splice(index, 1) }
    else if (index >= 0) cookies[index] = cookie
    else cookies.push(cookie)
  }
  cookiesByUser.set(userId, cookies)
}

export function requestCookieHeader(userId: string, url: URL): string | undefined {
  const cookies = (cookiesByUser.get(userId) ?? []).filter((cookie) => !cookie.expires || cookie.expires > Date.now())
  cookiesByUser.set(userId, cookies)
  const value = cookies.filter((cookie) =>
    (url.protocol === 'https:' || !cookie.secure) &&
    (url.hostname === cookie.domain || url.hostname.endsWith('.' + cookie.domain)) &&
    url.pathname.startsWith(cookie.path)
  ).sort((a, b) => b.path.length - a.path.length).map((cookie) => `${cookie.name}=${cookie.value}`).join('; ')
  return value || undefined
}

export class PreviewProxyError extends Error {
  constructor(readonly status: number, message: string) { super(message) }
}

// ---- Loopback-мост машин: тестовые окружения Web Reader --------------------
// Виртуальный хост `<agentId>.machine.internal:<port>` доставляется не сетью, а
// компаньон-агентом машины (HTTP строго к его 127.0.0.1:<port>). Так модель и
// пользователь открывают в Reader dev-серверы и feature-preview репозиториев,
// не выставляя их наружу; SSRF-гейт публичных адресов эта ветка не ослабляет.
export const MACHINE_PREVIEW_SUFFIX = '.machine.internal'
/** Алиас «машина текущего разговора» — разворачивает previewMcp в open. */
export const MACHINE_PREVIEW_ALIAS_HOST = 'machine.internal'

/** agentId из виртуального hostname; null — не машинный адрес. */
export function machineAgentIdOf(hostname: string): string | null {
  if (!hostname.endsWith(MACHINE_PREVIEW_SUFFIX)) return null
  const id = hostname.slice(0, -MACHINE_PREVIEW_SUFFIX.length)
  return id && !id.includes('.') ? id : null
}

/** Мост к машинам для превью (реализует AgentRegistry). */
export interface PreviewMachineBridge {
  isOnline(agentId: string): boolean
  http(agentId: string, request: AgentHttpRequest): Promise<AgentHttpResponse>
}

export interface PreviewProxyDeps {
  machines?: {
    bridge: PreviewMachineBridge
    /** Доступ пользователя к машине (владелец или share проекта). */
    canUse(userId: string, agentId: string): boolean
  }
}

function headerValue(headers: Record<string, string | string[]>, name: string): string | undefined {
  const value = headers[name] ?? headers[name.toLowerCase()]
  return Array.isArray(value) ? value[0] : value
}

export function isPublicAddress(address: string): boolean {
  const v = address.toLowerCase().replace(/^::ffff:/, '')
  if (isIP(v) === 4) {
    const [a, b] = v.split('.').map(Number)
    return !(a === 0 || a === 10 || a === 127 || a === 169 && b === 254 || a === 172 && b >= 16 && b <= 31 || a === 192 && b === 168 || a >= 224)
  }
  if (isIP(v) === 6) return !(v === '::1' || v === '::' || v.startsWith('fe80:') || /^(fc|fd)[0-9a-f]{2}:/.test(v))
  return false
}

type ResolvedAddress = LookupAddress

export function publicLookupResult(addresses: ResolvedAddress[], all: boolean): ResolvedAddress | ResolvedAddress[] {
  const address = addresses[0]
  if (!address || addresses.some((candidate) => !isPublicAddress(candidate.address))) {
    throw new PreviewProxyError(403, 'Адрес сайта недоступен для превью')
  }
  return all ? addresses : address
}

async function assertPublicHost(hostname: string): Promise<void> {
  const literal = hostname.replace(/^\[|\]$/g, '')
  if (isIP(literal)) {
    if (!isPublicAddress(literal)) throw new PreviewProxyError(403, 'Адрес сайта недоступен для превью')
    return
  }
  const addresses = await lookup(hostname, { all: true, verbatim: true })
  if (!addresses.length || addresses.some(({ address }) => !isPublicAddress(address))) throw new PreviewProxyError(403, 'Адрес сайта недоступен для превью')
}

function proxyUrl(value: string, base: URL): string {
  try {
    const target = new URL(value, base)
    return target.protocol === 'http:' || target.protocol === 'https:' ? '/api/preview?url=' + encodeURIComponent(target.toString()) : value
  } catch { return value }
}

export const PREVIEW_INSPECTOR_SCRIPT_ID = 'voicechat-preview-inspector'

/** Emulates a browser origin while the rendered document safely stays on ChatAI origin. */
export function previewContextScript(base: string): string {
  const baseUrl = new URL(base)
  const key = JSON.stringify(`voicechat.preview.context.v1:${baseUrl.origin}:`)
  const fallbackBase = JSON.stringify(baseUrl.toString())
  return `<script>(()=>{const p=${key},nativeLocal=window.localStorage,nativeSession=window.sessionStorage;
const storage=(native)=>({get length(){return Object.keys(native).filter(k=>k.startsWith(p)).length},key(i){return Object.keys(native).filter(k=>k.startsWith(p))[i]?.slice(p.length)??null},getItem(k){return native.getItem(p+String(k))},setItem(k,v){native.setItem(p+String(k),String(v))},removeItem(k){native.removeItem(p+String(k))},clear(){Object.keys(native).filter(k=>k.startsWith(p)).forEach(k=>native.removeItem(k))}});
for(const [name,native] of [['localStorage',nativeLocal],['sessionStorage',nativeSession]])try{Object.defineProperty(window,name,{configurable:true,value:storage(native)})}catch{}
const nativeIdb=window.indexedDB;if(nativeIdb)try{Object.defineProperty(window,'indexedDB',{configurable:true,value:new Proxy(nativeIdb,{get(target,key){const value=Reflect.get(target,key,target);if(key==='open'||key==='deleteDatabase')return (name,...args)=>value.call(target,p+String(name),...args);return typeof value==='function'?value.bind(target):value}})})}catch{}
const fallbackBase=${fallbackBase};
const currentBase=()=>{try{const u=new URL(location.href);const t=u.searchParams.get('url');if(u.pathname==='/api/preview'&&t)return t}catch{}return fallbackBase};
const toProxy=(value)=>{const s=String(value);
try{const local=new URL(s,location.href);if(local.origin===location.origin&&local.pathname==='/api/preview'&&local.searchParams.has('url'))return s}catch{}
try{const u=new URL(s,currentBase());if(u.protocol==='http:'||u.protocol==='https:')return '/api/preview?url='+encodeURIComponent(u.toString())}catch{}
return s};
const cleanHeaders=(headers)=>{const h=new Headers(headers||undefined);const auth=h.get('authorization');if(auth!==null){h.delete('authorization');h.set('x-preview-authorization',auth)}return h};
const nativeFetch=typeof window.fetch==='function'?window.fetch.bind(window):null;
if(nativeFetch)window.fetch=function(input,init){
try{const isRequest=typeof Request==='function'&&input instanceof Request;
const raw=isRequest?input.url:String(input);
const target=toProxy(raw);
if(target===raw)return nativeFetch(input,init);
const options={};
if(isRequest){options.method=input.method;options.headers=input.headers;options.cache=input.cache;options.redirect=input.redirect;options.referrerPolicy=input.referrerPolicy;options.integrity=input.integrity;options.keepalive=input.keepalive;options.signal=input.signal}
if(init)Object.assign(options,init);
options.headers=cleanHeaders(options.headers);
options.credentials='same-origin';options.mode='cors';
if(isRequest&&!(init&&'body' in init)&&!/^(GET|HEAD)$/i.test(options.method||'GET'))return input.clone().arrayBuffer().then((body)=>nativeFetch(target,Object.assign(options,{body})));
return nativeFetch(target,options)}catch{return nativeFetch(input,init)}};
if(window.XMLHttpRequest&&window.XMLHttpRequest.prototype){const xhr=window.XMLHttpRequest.prototype,xhrOpen=xhr.open,xhrSetHeader=xhr.setRequestHeader;
xhr.open=function(method,url){const rest=Array.prototype.slice.call(arguments,2);return xhrOpen.apply(this,[method,toProxy(String(url))].concat(rest))};
xhr.setRequestHeader=function(name,value){return xhrSetHeader.call(this,/^authorization$/i.test(String(name))?'x-preview-authorization':String(name),value)}}
try{const nativeOpen=window.open?window.open.bind(window):null;window.open=function(url){if(url==null||url==='')return nativeOpen?nativeOpen():null;location.assign(toProxy(String(url)));return null}}catch{}
if(typeof navigator.sendBeacon==='function')try{const nativeBeacon=navigator.sendBeacon.bind(navigator);navigator.sendBeacon=function(url,data){return arguments.length>1?nativeBeacon(toProxy(String(url)),data):nativeBeacon(toProxy(String(url)))}}catch{}
try{const nativeAssign=location.assign.bind(location);Object.defineProperty(location,'assign',{configurable:true,value:(value)=>nativeAssign(toProxy(String(value)))})}catch{}
try{const nativeLocReplace=location.replace.bind(location);Object.defineProperty(location,'replace',{configurable:true,value:(value)=>nativeLocReplace(toProxy(String(value)))})}catch{}
try{const hrefDescriptor=Object.getOwnPropertyDescriptor(location,'href');if(hrefDescriptor&&hrefDescriptor.set&&hrefDescriptor.configurable){const setHref=hrefDescriptor.set.bind(location),getHref=hrefDescriptor.get?hrefDescriptor.get.bind(location):()=>String(location);Object.defineProperty(location,'href',{configurable:true,get:getHref,set:(value)=>setHref(toProxy(String(value)))})}}catch{}
if(window.history)try{const nativePush=history.pushState.bind(history),nativeReplaceState=history.replaceState.bind(history);
history.pushState=(state,title,url)=>nativePush(state,title,url==null?url:toProxy(String(url)));
history.replaceState=(state,title,url)=>nativeReplaceState(state,title,url==null?url:toProxy(String(url)))}catch{}
// Deep-link: фрагмент реального адреса (#/machines) не доезжает до iframe-документа
// (он живёт внутри query ?url=...) — восстанавливаем его для hash-роутеров SPA.
try{const target=new URL(currentBase());if(target.hash&&!location.hash)location.hash=target.hash}catch{}
})();<\/script>`
}

export function previewInspectorScript(): string {
  return `<script id="${PREVIEW_INSPECTOR_SCRIPT_ID}">(() => {
const COMMAND='voicechat.preview.inspector.v1', SELECTED='voicechat.preview.element-selected.v1', HTML_LIMIT=8000, TEXT_LIMIT=2000, ARRAY_LIMIT=64;
let active=false, selected=null, box=null, label=null;
const esc=(value)=>globalThis.CSS?.escape ? CSS.escape(value) : value.replace(/[^a-zA-Z0-9_-]/g,(c)=>'\\\\'+c.codePointAt(0).toString(16)+' ');
const part=(el)=>{let s=el.localName;if(el.id)s+='#'+esc(el.id);else{const cs=[...el.classList].slice(0,3);if(cs.length)s+='.'+cs.map(esc).join('.');}return s};
const uniqueSelector=(el)=>{
  if(el.id){const s='#'+esc(el.id);if(document.querySelectorAll(s).length===1)return s}
  const parts=[];let node=el;
  while(node&&node.nodeType===1&&parts.length<ARRAY_LIMIT){
    let s=part(node);
    if(!node.id&&node.parentElement){const same=[...node.parentElement.children].filter(x=>x.localName===node.localName);if(same.length>1)s+=':nth-of-type('+(same.indexOf(node)+1)+')'}
    parts.unshift(s);const candidate=parts.join(' > ');
    try{if(document.querySelectorAll(candidate).length===1)return candidate}catch{}
    node=node.parentElement
  }
  return parts.join(' > ')
};
const ancestors=(el)=>{const out=[];let n=el;while(n&&n.nodeType===1&&out.length<ARRAY_LIMIT){out.unshift(part(n));n=n.parentElement}return out};
const ensureOverlay=()=>{
  if(box)return;
  box=document.createElement('div');box.setAttribute('data-voicechat-inspector','overlay');
  Object.assign(box.style,{position:'fixed',zIndex:'2147483646',pointerEvents:'none',boxSizing:'border-box',border:'2px solid #4f8cff',background:'rgba(79,140,255,.12)'});
  label=document.createElement('div');label.setAttribute('data-voicechat-inspector','label');
  Object.assign(label.style,{position:'fixed',zIndex:'2147483647',pointerEvents:'none',maxWidth:'calc(100vw - 8px)',padding:'3px 6px',borderRadius:'4px',background:'#172033',color:'#fff',font:'12px/1.4 ui-monospace,monospace',whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'});
  document.documentElement.append(box,label)
};
const draw=(el)=>{
  ensureOverlay();const r=el.getBoundingClientRect();const name=part(el);
  Object.assign(box.style,{left:r.left+'px',top:r.top+'px',width:r.width+'px',height:r.height+'px'});
  label.textContent=name+'  '+Math.round(r.width)+' × '+Math.round(r.height)+' px';
  const top=r.top>=26?r.top-24:Math.min(innerHeight-24,r.bottom+2);
  Object.assign(label.style,{left:Math.max(4,Math.min(r.left,innerWidth-label.offsetWidth-4))+'px',top:Math.max(2,top)+'px'})
};
const hide=()=>{box?.remove();label?.remove();box=null;label=null};
const styles=(el)=>{const s=getComputedStyle(el);return {
  font:s.font,color:s.color,backgroundColor:s.backgroundColor,margin:s.margin,padding:s.padding,border:s.border,
  width:s.width,height:s.height,position:s.position,display:s.display,flex:s.flex,flexDirection:s.flexDirection,
  flexWrap:s.flexWrap,alignItems:s.alignItems,justifyContent:s.justifyContent,gap:s.gap,grid:s.grid,
  gridTemplateColumns:s.gridTemplateColumns,gridTemplateRows:s.gridTemplateRows,gridArea:s.gridArea
}};
const payload=(el)=>{const r=el.getBoundingClientRect(),data={};for(const a of [...el.attributes])if(a.name.startsWith('data-')&&Object.keys(data).length<ARRAY_LIMIT)data[a.name]=a.value.slice(0,TEXT_LIMIT);return {
  tag:el.localName,id:el.id,classes:[...el.classList].slice(0,ARRAY_LIMIT),dataAttributes:data,selector:uniqueSelector(el),ancestors:ancestors(el),
  rect:{x:r.x,y:r.y,top:r.top,right:r.right,bottom:r.bottom,left:r.left,width:r.width,height:r.height},
  pageUrl:location.href,viewport:{width:innerWidth,height:innerHeight},outerHTML:el.outerHTML.slice(0,HTML_LIMIT),
  text:(el.innerText||el.textContent||'').trim().slice(0,TEXT_LIMIT),styles:styles(el)
}};
const move=(e)=>{if(!active)return;const el=e.target;if(el instanceof Element&&!el.closest('[data-voicechat-inspector]'))draw(el)};
const click=(e)=>{if(!active)return;const el=e.target;if(!(el instanceof Element)||el.closest('[data-voicechat-inspector]'))return;e.preventDefault();e.stopPropagation();e.stopImmediatePropagation();selected=el;draw(el);parent.postMessage({type:SELECTED,payload:payload(el)},location.origin)};
const key=(e)=>{if(active&&e.key==='Escape'){e.preventDefault();disable();parent.postMessage({type:COMMAND,enabled:false},location.origin)}};
const enable=()=>{if(active)return;active=true;document.addEventListener('pointerover',move,true);document.addEventListener('click',click,true);document.addEventListener('keydown',key,true)};
const disable=()=>{active=false;selected=null;document.removeEventListener('pointerover',move,true);document.removeEventListener('click',click,true);document.removeEventListener('keydown',key,true);hide()};
const ACTION='voicechat.preview.action.v1', RESULT='voicechat.preview.action-result.v1', READY='voicechat.preview.page-ready.v1', LOADING='voicechat.preview.page-loading.v1', RECORD='voicechat.preview.record.v1';
parent.postMessage({type:READY,url:location.href},location.origin);
addEventListener('beforeunload',()=>parent.postMessage({type:LOADING,url:location.href},location.origin));
// ---- Буфер ошибок страницы: модель проверяет их действием errors ----
const pageErrors=[];const ERRORS_CAP=100;
const pushError=(entry)=>{entry.message=String(entry.message||'').slice(0,500);entry.at=Math.round(performance.now());pageErrors.push(entry);if(pageErrors.length>ERRORS_CAP)pageErrors.shift()};
addEventListener('error',(e)=>{if(e instanceof ErrorEvent)pushError({kind:'error',message:e.message||'Ошибка скрипта'})},true);
addEventListener('unhandledrejection',(e)=>pushError({kind:'unhandledrejection',message:e&&e.reason&&(e.reason.message||String(e.reason))||'unhandledrejection'}));
try{const nativeConsoleError=console.error.bind(console);console.error=function(){try{pushError({kind:'console.error',message:Array.prototype.map.call(arguments,(a)=>a&&a.message||(typeof a==='object'?JSON.stringify(a):String(a))).join(' ')})}catch{}return nativeConsoleError.apply(null,arguments)}}catch{}
// fetch уже переписан context-шимом на прокси — оборачиваем поверх для статусов.
try{const shimFetch=window.fetch.bind(window);window.fetch=function(input,init){return shimFetch(input,init).then((res)=>{if(res&&res.status>=400)pushError({kind:'network',message:'HTTP '+res.status,url:(()=>{try{return unproxyLazy(res.url)}catch{return String(res.url).slice(0,300)}})(),status:res.status});return res},(err)=>{pushError({kind:'network',message:err&&err.message||'network error'});throw err})}}catch{}
try{const xhrSend=XMLHttpRequest.prototype.send;XMLHttpRequest.prototype.send=function(){this.addEventListener('loadend',()=>{if(this.status>=400)pushError({kind:'network',message:'HTTP '+this.status,url:(()=>{try{return unproxyLazy(this.responseURL)}catch{return ''}})(),status:this.status})});return xhrSend.apply(this,arguments)}}catch{}
// unproxy объявлен ниже — ленивое обращение (ошибки случаются после инициализации).
function unproxyLazy(value){return typeof unproxy==='function'?unproxy(value):String(value)}
const EL_TEXT=200, SNIPPET=4000, FIND_MAX=30, HEADINGS=64, LINKS=100, BUTTONS=50, INPUTS=50;
const CLICKABLE='a,button,[role=button],[role=link],[role=tab],[role=menuitem],input,select,textarea,label,summary,[onclick]';
const unproxy=(value)=>{try{const u=new URL(value,location.href);if(u.pathname==='/api/preview'){const t=u.searchParams.get('url');if(t)return t}return u.toString()}catch{return value}};
const pageInfo=()=>({url:unproxy(location.href),title:document.title||''});
const textOf=(el)=>(el.innerText||el.textContent||'').replace(/\\s+/g,' ').trim();
const describe=(el)=>{
  const d={selector:uniqueSelector(el),tag:el.localName,text:textOf(el).slice(0,EL_TEXT)};
  const href=el.localName==='a'&&el.getAttribute('href');if(href)d.href=unproxy(href);
  const role=el.getAttribute('role')||(el.localName==='input'?(el.type||'text'):'');if(role)d.role=role;
  if(el.disabled===true)d.disabled=true;
  return d
};
const bySelector=(selector)=>{let list;try{list=document.querySelectorAll(selector)}catch{throw new Error('Некорректный CSS-селектор: '+selector)}return [...list].filter(el=>!el.closest('[data-voicechat-inspector]'))};
const byText=(text)=>{
  const q=text.replace(/\\s+/g,' ').trim().toLowerCase();
  if(!q)return[];
  const all=[];
  for(const el of document.querySelectorAll('body *')){
    if(el.closest('[data-voicechat-inspector]')||el.id==='${PREVIEW_INSPECTOR_SCRIPT_ID}')continue;
    const t=textOf(el);
    if(!t||t.length>300||!t.toLowerCase().includes(q))continue;
    all.push(el)
  }
  const deepest=all.filter(el=>!all.some(other=>other!==el&&el.contains(other)));
  const exact=(el)=>textOf(el).toLowerCase()===q?0:1;
  const clickable=(el)=>el.matches(CLICKABLE)||el.closest(CLICKABLE)?0:1;
  return deepest.sort((a,b)=>(exact(a)-exact(b))||(clickable(a)-clickable(b)))
};
const findTargets=(action)=>action.selector?bySelector(action.selector):byText(action.text||'');
const clickTarget=(el)=>{const host=el.matches(CLICKABLE)?el:(el.closest(CLICKABLE)||el);return host};
const setNativeValue=(el,value)=>{
  const proto=el.localName==='textarea'?HTMLTextAreaElement.prototype:HTMLInputElement.prototype;
  const desc=Object.getOwnPropertyDescriptor(proto,'value');
  if(desc&&desc.set)desc.set.call(el,value);else el.value=value
};
const run=(action)=>{
  if(action.kind==='find'){
    const found=findTargets(action);
    const limit=Math.max(1,Math.min(FIND_MAX,typeof action.limit==='number'?Math.floor(action.limit):10));
    return {page:pageInfo(),elements:found.slice(0,limit).map(describe),total:found.length}
  }
  if(action.kind==='click'){
    const found=findTargets(action);
    if(!found.length)throw new Error('Элемент не найден: '+(action.selector||action.text));
    const el=clickTarget(found[0]);
    el.scrollIntoView&&el.scrollIntoView({block:'center'});
    const info=describe(el);
    typeof el.click==='function'?el.click():el.dispatchEvent(new MouseEvent('click',{bubbles:true,cancelable:true}));
    return {page:pageInfo(),clicked:info}
  }
  if(action.kind==='type'){
    const found=bySelector(action.selector);
    if(!found.length)throw new Error('Поле не найдено: '+action.selector);
    const el=found[0];
    const editable=el.isContentEditable;
    if(!editable&&el.localName!=='input'&&el.localName!=='textarea'&&el.localName!=='select')throw new Error('Элемент не является полем ввода: '+action.selector);
    el.focus&&el.focus();
    if(editable){el.textContent=action.text}
    else if(el.localName==='select'){el.value=action.text}
    else setNativeValue(el,action.text);
    el.dispatchEvent(new Event('input',{bubbles:true}));
    el.dispatchEvent(new Event('change',{bubbles:true}));
    let submitted=false;
    if(action.submit){
      const form=el.form||el.closest('form');
      if(form){form.requestSubmit?form.requestSubmit():form.submit();submitted=true}
      else{el.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true}));el.dispatchEvent(new KeyboardEvent('keyup',{key:'Enter',bubbles:true}))}
    }
    return {page:pageInfo(),typed:describe(el),submitted}
  }
  if(action.kind==='styles'){
    const found=bySelector(action.selector);if(!found.length)throw new Error('Элемент не найден: '+action.selector);
    const computed=getComputedStyle(found[0]);const names=Array.isArray(action.properties)&&action.properties.length?action.properties:['display','color','font-size','visibility'];const values={};for(const name of names.slice(0,32))values[name]=computed.getPropertyValue(name)||computed[name]||'';
    return {page:pageInfo(),selector:uniqueSelector(found[0]),styles:values}
  }
  if(action.kind==='hover'){
    const found=findTargets(action);
    if(!found.length)throw new Error('Элемент не найден: '+(action.selector||action.text));
    // mouseenter не всплывает: как и click, поднимаемся до интерактивного предка.
    const el=clickTarget(found[0]);
    el.scrollIntoView&&el.scrollIntoView({block:'center'});
    const r=el.getBoundingClientRect();
    const opts={bubbles:true,cancelable:true,clientX:r.left+r.width/2,clientY:r.top+r.height/2};
    for(const type of ['pointerover','pointerenter','pointermove'])el.dispatchEvent(new (window.PointerEvent||MouseEvent)(type,opts));
    for(const type of ['mouseover','mouseenter','mousemove'])el.dispatchEvent(new MouseEvent(type,opts));
    return {page:pageInfo(),hovered:describe(el)}
  }
  if(action.kind==='scroll'){
    let el=document.scrollingElement||document.documentElement,target='window';
    if(action.selector){const found=bySelector(action.selector);if(!found.length)throw new Error('Элемент не найден: '+action.selector);el=found[0];target=uniqueSelector(el)}
    if(action.to==='top')el.scrollTop=0;
    else if(action.to==='bottom')el.scrollTop=el.scrollHeight;
    else if(typeof action.dy==='number')el.scrollTop=el.scrollTop+action.dy;
    el.dispatchEvent(new Event('scroll',{bubbles:true}));
    return {page:pageInfo(),target,scrolled:{top:el.scrollTop,left:el.scrollLeft,maxTop:Math.max(0,el.scrollHeight-el.clientHeight)}}
  }
  if(action.kind==='errors'){
    const errors=pageErrors.slice(-50).map((e)=>({kind:e.kind,message:e.message,at:e.at,...(e.url?{url:String(e.url).slice(0,300)}:{}),...(typeof e.status==='number'?{status:e.status}:{})}));
    const total=pageErrors.length;
    if(action.clear)pageErrors.length=0;
    return {page:pageInfo(),errors,total}
  }
  if(action.kind==='wait'){
    const timeoutMs=Math.min(8000,typeof action.timeoutMs==='number'&&action.timeoutMs>0?action.timeoutMs:5000);
    const started=performance.now();
    return new Promise((ok,fail)=>{
      const attempt=()=>{
        let found=[];
        try{found=findTargets(action)}catch(err){fail(err);return}
        if(found.length){ok({page:pageInfo(),found:describe(found[0]),waitedMs:Math.round(performance.now()-started)});return}
        if(performance.now()-started>=timeoutMs){fail(new Error('Элемент не появился за '+timeoutMs+' мс: '+(action.selector||action.text)));return}
        setTimeout(attempt,120)
      };
      attempt()
    })
  }
  if(action.kind==='back'){
    const info=pageInfo();
    history.back();
    return {page:info,navigating:true}
  }
  if(action.kind==='edits'){
    const edits=loadEdits();
    return {page:pageInfo(),edits:Object.keys(edits).map((selector)=>{const entry=edits[selector];return {selector,...(entry.style?{style:entry.style}:{}),...(typeof entry.text==='string'?{text:entry.text}:{}),...(entry.deleted?{deleted:true}:{})}})}
  }
  if(action.kind==='screenshot'){
    const scroller=document.scrollingElement||document.documentElement;
    let rect;
    if(action.selector){
      const found=bySelector(action.selector);
      if(!found.length)throw new Error('Элемент не найден: '+action.selector);
      found[0].scrollIntoView&&found[0].scrollIntoView({block:'center'});
      const r=found[0].getBoundingClientRect();
      rect={x:Math.round(r.left+scroller.scrollLeft),y:Math.round(r.top+scroller.scrollTop),width:Math.max(1,Math.round(r.width)),height:Math.max(1,Math.round(r.height))}
    }else if(action.rect){
      rect={x:Math.round(action.rect.x),y:Math.round(action.rect.y),width:Math.max(1,Math.round(action.rect.width)),height:Math.max(1,Math.round(action.rect.height))}
    }else{
      rect={x:scroller.scrollLeft,y:scroller.scrollTop,width:innerWidth,height:innerHeight}
    }
    // Масштаб до 1400px по большей стороне: снимок агента идёт в контекст модели.
    return captureArea(rect,1400).then((dataUrl)=>({page:pageInfo(),rect,dataUrl}))
  }
  if(action.kind==='press'){
    let el=document.activeElement&&document.activeElement!==document.body?document.activeElement:document.body;
    if(action.selector){const found=bySelector(action.selector);if(!found.length)throw new Error('Элемент не найден: '+action.selector);el=found[0];el.focus&&el.focus()}
    const opts={key:action.key,bubbles:true,cancelable:true};
    el.dispatchEvent(new KeyboardEvent('keydown',opts));
    el.dispatchEvent(new KeyboardEvent('keyup',opts));
    return {page:pageInfo(),pressed:{key:action.key,selector:el===document.body?'body':uniqueSelector(el)}}
  }
  if(action.kind==='read'){
    let scope=document.body||document.documentElement;
    if(action.selector){const found=bySelector(action.selector);if(!found.length)throw new Error('Элемент не найден: '+action.selector);scope=found[0]}
    const headings=[...scope.querySelectorAll('h1,h2,h3,h4,h5,h6')].slice(0,HEADINGS).map(h=>({level:Number(h.localName[1]),text:textOf(h).slice(0,EL_TEXT)}));
    const links=[];const seen=new Set();
    for(const a of scope.querySelectorAll('a[href]')){
      if(links.length>=LINKS)break;
      const t=textOf(a).slice(0,EL_TEXT);const href=unproxy(a.getAttribute('href'));
      if(!t||seen.has(t+'|'+href))continue;seen.add(t+'|'+href);links.push({text:t,href})
    }
    const buttons=[...scope.querySelectorAll('button,[role=button],input[type=submit],input[type=button]')].map(b=>textOf(b).slice(0,EL_TEXT)||(b.value||'').slice(0,EL_TEXT)).filter(Boolean).slice(0,BUTTONS);
    const inputs=[...scope.querySelectorAll('input,textarea,select')].slice(0,INPUTS).map(i=>({
      selector:uniqueSelector(i),
      type:i.localName==='input'?(i.type||'text'):i.localName,
      name:i.name||'',
      placeholder:i.getAttribute('placeholder')||'',
      value:i.type==='password'?'':String(i.value||'').slice(0,EL_TEXT)
    }));
    return {page:pageInfo(),headings,links,buttons,inputs,text:textOf(scope).slice(0,SNIPPET)}
  }
  throw new Error('Неизвестное действие')
};
const reply=(requestId,ok,payload)=>parent.postMessage(ok?{type:RESULT,requestId,ok:true,result:payload}:{type:RESULT,requestId,ok:false,error:String(payload).slice(0,2000)},location.origin);
let recording=false,diagnosticRunning=false,lastRecordedClickAt=0;
const sensitive=(el)=>el.localName==='input'&&(el.type==='password'||el.autocomplete==='current-password'||el.autocomplete==='new-password'||/pass|secret|token|card|cvv/i.test((el.name||'')+' '+(el.id||'')));
const record=(step)=>{if(recording&&!diagnosticRunning&&!editActive)parent.postMessage({type:RECORD,step},location.origin)};
const recordClick=(e)=>{const el=e.target instanceof Element?clickTarget(e.target):null;if(el&&!el.closest('[data-voicechat-inspector]')){lastRecordedClickAt=Date.now();record({kind:'click',selector:uniqueSelector(el),text:textOf(el).slice(0,EL_TEXT)})}};
const recordInput=(e)=>{const el=e.target instanceof Element?e.target:null;if(!el||el.closest('[data-voicechat-inspector]')||!el.matches('input,textarea,select,[contenteditable=true]'))return;record({kind:'type',selector:uniqueSelector(el),text:sensitive(el)?'':String(el.value===undefined?el.textContent||'':el.value).slice(0,2000),sensitive:sensitive(el)})};
// Enter-сабмит без клика (авторизация) иначе терялся: кнопки-сабмиттеры пишутся
// кликом, а «тихий» submit — как type с submit по активному полю формы.
const recordSubmit=(e)=>{
  if(Date.now()-lastRecordedClickAt<300)return;
  const form=e.target instanceof Element?e.target:null;
  if(!form||form.closest('[data-voicechat-inspector]'))return;
  const submitter=e.submitter instanceof Element?e.submitter:null;
  if(submitter){record({kind:'click',selector:uniqueSelector(submitter),text:textOf(submitter).slice(0,EL_TEXT)});return}
  const field=document.activeElement;
  if(field instanceof Element&&field.matches('input,textarea')&&form.contains(field))record({kind:'type',selector:uniqueSelector(field),text:sensitive(field)?'':String(field.value||'').slice(0,2000),sensitive:sensitive(field),submit:true})
};
const setRecording=(enabled)=>{if(recording===enabled)return;recording=enabled;if(enabled){document.addEventListener('click',recordClick,true);document.addEventListener('input',recordInput,true);document.addEventListener('submit',recordSubmit,true)}else{document.removeEventListener('click',recordClick,true);document.removeEventListener('input',recordInput,true);document.removeEventListener('submit',recordSubmit,true)}};
// ---- Edit-режим: правки страницы сохраняются в браузере клиента ----
// localStorage здесь уже подменён context-шимом, поэтому правки автоматически
// разделены по внешнему origin; ключ добавляет pathname реальной страницы.
const EDIT='voicechat.preview.edit.v1', EDITS_KEY='voicechat.preview.edits.v1';
let editActive=false, editEl=null, editPanel=null;
const pageKey=()=>{try{const u=new URL(unproxy(location.href));return EDITS_KEY+':'+u.origin+u.pathname}catch{return EDITS_KEY+':'+location.pathname}};
const loadEdits=()=>{try{return JSON.parse(localStorage.getItem(pageKey())||'{}')||{}}catch{return {}}};
const saveEdits=(edits)=>{try{Object.keys(edits).length?localStorage.setItem(pageKey(),JSON.stringify(edits)):localStorage.removeItem(pageKey())}catch{}};
const applyEditEntry=(el,entry)=>{
  if(entry.deleted){el.style.setProperty('display','none','important');return}
  for(const key of Object.keys(entry.style||{}))el.style[key]=entry.style[key];
  if(typeof entry.text==='string')el.textContent=entry.text
};
const restoreEdits=()=>{const edits=loadEdits();for(const selector of Object.keys(edits)){try{const el=document.querySelector(selector);if(el&&!el.closest('[data-voicechat-inspector]'))applyEditEntry(el,edits[selector])}catch{}}};
const commitEdit=(el,patch)=>{
  const edits=loadEdits(),selector=uniqueSelector(el);
  const entry=edits[selector]||(edits[selector]={original:{cssText:el.style.cssText,text:null}});
  if(patch.style){entry.style=Object.assign(entry.style||{},patch.style);for(const key of Object.keys(patch.style))el.style[key]=patch.style[key]}
  if(patch.text!==undefined){if(entry.original.text===null)entry.original.text=el.textContent;entry.text=patch.text}
  if(patch.deleted){entry.deleted=true;el.style.setProperty('display','none','important')}
  edits[selector]=entry;saveEdits(edits)
};
const resetEdit=(el)=>{
  const edits=loadEdits(),selector=uniqueSelector(el),entry=edits[selector];
  if(!entry)return;
  el.style.cssText=entry.original&&entry.original.cssText||'';
  if(entry.original&&entry.original.text!==null)el.textContent=entry.original.text;
  delete edits[selector];saveEdits(edits)
};
const stopTextEdit=()=>{if(editEl&&editEl.isContentEditable){editEl.removeAttribute('contenteditable');editEl.removeEventListener('input',editTextInput)}};
const editTextInput=()=>{if(editEl)commitEdit(editEl,{text:editEl.textContent})};
const closeEditPanel=()=>{stopTextEdit();editPanel?.remove();editPanel=null;editEl=null;hide()};
const panelButton=(label,title,onClick)=>{
  const b=document.createElement('button');b.type='button';b.textContent=label;b.title=title;b.setAttribute('aria-label',title);
  Object.assign(b.style,{background:'transparent',color:'#fff',border:'0',borderRadius:'6px',padding:'4px 8px',font:'13px/1.2 system-ui,sans-serif',cursor:'pointer'});
  b.addEventListener('click',(e)=>{e.preventDefault();e.stopPropagation();onClick(b)});
  return b
};
const panelSelect=(title,options,value,onChange)=>{
  const s=document.createElement('select');s.title=title;s.setAttribute('aria-label',title);
  Object.assign(s.style,{background:'#2c2c2e',color:'#fff',border:'0',borderRadius:'6px',padding:'4px 6px',font:'12px/1.2 system-ui,sans-serif'});
  for(const [v,label] of options){const o=document.createElement('option');o.value=v;o.textContent=label;s.append(o)}
  s.value=value;s.addEventListener('change',()=>onChange(s.value));
  s.addEventListener('click',(e)=>e.stopPropagation());
  return s
};
const openEditPanel=(el)=>{
  closeEditPanel();editEl=el;draw(el);
  editPanel=document.createElement('div');editPanel.setAttribute('data-voicechat-inspector','edit-panel');
  Object.assign(editPanel.style,{position:'fixed',zIndex:'2147483647',display:'flex',alignItems:'center',gap:'2px',padding:'6px',borderRadius:'10px',background:'#1c1c1e',boxShadow:'0 8px 24px rgba(0,0,0,.45)'});
  const computed=getComputedStyle(el);
  editPanel.append(panelSelect('Шрифт',[['','Шрифт'],['system-ui, sans-serif','System'],['Arial, sans-serif','Arial'],['Georgia, serif','Georgia'],['"Times New Roman", serif','Times'],['ui-monospace, monospace','Mono']],'',(value)=>{if(value)commitEdit(el,{style:{fontFamily:value}})}));
  let size=Math.round(parseFloat(computed.fontSize)||14);
  const sizeLabel=document.createElement('span');sizeLabel.textContent=String(size);sizeLabel.setAttribute('data-voicechat-edit','font-size');
  Object.assign(sizeLabel.style,{color:'#fff',font:'13px/1.2 system-ui,sans-serif',minWidth:'22px',textAlign:'center'});
  const resize=(delta)=>{size=Math.max(6,Math.min(200,size+delta));sizeLabel.textContent=String(size);commitEdit(el,{style:{fontSize:size+'px'}})};
  editPanel.append(panelButton('−','Уменьшить шрифт',()=>resize(-1)),sizeLabel,panelButton('+','Увеличить шрифт',()=>resize(1)));
  const boldButton=panelButton('B','Жирный',()=>{const bold=parseInt(getComputedStyle(el).fontWeight,10)>=600;commitEdit(el,{style:{fontWeight:bold?'400':'700'}});boldButton.style.background=bold?'transparent':'#3a3a3c'});
  boldButton.style.fontWeight='700';
  const italicButton=panelButton('I','Курсив',()=>{const italic=getComputedStyle(el).fontStyle==='italic';commitEdit(el,{style:{fontStyle:italic?'normal':'italic'}});italicButton.style.background=italic?'transparent':'#3a3a3c'});
  italicButton.style.fontStyle='italic';
  editPanel.append(boldButton,italicButton);
  editPanel.append(panelSelect('Выравнивание',[['','Выравн.'],['left','Слева'],['center','По центру'],['right','Справа']],'',(value)=>{if(value)commitEdit(el,{style:{textAlign:value}})}));
  editPanel.append(panelButton('✎','Редактировать текст',()=>{
    if(el.isContentEditable){stopTextEdit();return}
    // Исходный текст фиксируется до первой правки — иначе сброс вернёт правленый.
    const edits=loadEdits(),selector=uniqueSelector(el);
    const entry=edits[selector]||(edits[selector]={original:{cssText:el.style.cssText,text:null}});
    if(entry.original.text===null){entry.original.text=el.textContent;edits[selector]=entry;saveEdits(edits)}
    el.setAttribute('contenteditable','true');el.addEventListener('input',editTextInput);el.focus()
  }));
  editPanel.append(panelButton('⟲','Сбросить правки элемента',()=>{resetEdit(el);closeEditPanel()}));
  editPanel.append(panelButton('🗑','Удалить элемент',()=>{commitEdit(el,{deleted:true});closeEditPanel()}));
  editPanel.append(panelButton('✕','Закрыть',()=>closeEditPanel()));
  document.documentElement.append(editPanel);
  const r=el.getBoundingClientRect(),w=editPanel.offsetWidth,h=editPanel.offsetHeight;
  Object.assign(editPanel.style,{left:Math.max(4,Math.min(r.left,innerWidth-w-4))+'px',top:Math.min(innerHeight-h-4,Math.max(4,r.bottom+6))+'px'})
};
const editMove=(e)=>{if(!editActive||editEl)return;const el=e.target;if(el instanceof Element&&!el.closest('[data-voicechat-inspector]'))draw(el)};
const editClick=(e)=>{
  if(!editActive)return;
  const el=e.target;
  if(!(el instanceof Element)||el.closest('[data-voicechat-inspector]'))return;
  // Клики внутри редактируемого текста двигают каретку, а не переоткрывают панель.
  if(editEl&&editEl.isContentEditable&&(el===editEl||editEl.contains(el)))return;
  e.preventDefault();e.stopPropagation();e.stopImmediatePropagation();openEditPanel(el)
};
const editKey=(e)=>{
  if(!editActive||e.key!=='Escape')return;
  e.preventDefault();
  if(editEl){closeEditPanel();return}
  disableEdit();parent.postMessage({type:EDIT,enabled:false},location.origin)
};
const enableEdit=()=>{if(editActive)return;disable();editActive=true;document.addEventListener('pointerover',editMove,true);document.addEventListener('click',editClick,true);document.addEventListener('keydown',editKey,true)};
const disableEdit=()=>{if(!editActive)return;editActive=false;closeEditPanel();document.removeEventListener('pointerover',editMove,true);document.removeEventListener('click',editClick,true);document.removeEventListener('keydown',editKey,true)};
// ---- Скриншот области: выделение прямоугольника и снимок DOM → PNG ----
// Снимок собирается без пикселей экрана: клон body с инлайн-стилями рисуется
// через SVG foreignObject в canvas и кадрируется областью. Все ресурсы страницы
// same-origin (прокси), поэтому canvas не «портится», а <img> инлайнятся в data-URL.
const CAPTURE='voicechat.preview.capture.v1';
let captureActive=false,captureBox=null,captureStart=null,captureOverlay=null;
const captureCleanup=()=>{captureOverlay?.remove();captureOverlay=null;captureBox=null;captureStart=null};
const captureKey=(e)=>{if(captureActive&&e.key==='Escape'){e.preventDefault();disableCapture();parent.postMessage({type:CAPTURE,enabled:false},location.origin)}};
const captureRect=(e)=>({left:Math.min(captureStart.x,e.clientX),top:Math.min(captureStart.y,e.clientY),width:Math.abs(e.clientX-captureStart.x),height:Math.abs(e.clientY-captureStart.y)});
const captureDown=(e)=>{if(!captureActive)return;e.preventDefault();e.stopPropagation();captureStart={x:e.clientX,y:e.clientY};Object.assign(captureBox.style,{display:'block',left:e.clientX+'px',top:e.clientY+'px',width:'0px',height:'0px'})};
const captureMove=(e)=>{if(!captureActive||!captureStart)return;const r=captureRect(e);Object.assign(captureBox.style,{left:r.left+'px',top:r.top+'px',width:r.width+'px',height:r.height+'px'})};
const captureUp=(e)=>{
  if(!captureActive||!captureStart)return;
  e.preventDefault();e.stopPropagation();
  const view=captureRect(e);
  disableCapture();
  parent.postMessage({type:CAPTURE,enabled:false},location.origin);
  if(view.width<8||view.height<8)return;
  const scroller=document.scrollingElement||document.documentElement;
  const rect={x:Math.round(view.left+scroller.scrollLeft),y:Math.round(view.top+scroller.scrollTop),width:Math.round(view.width),height:Math.round(view.height)};
  void captureArea(rect).then(
    (dataUrl)=>parent.postMessage({type:CAPTURE,shot:{dataUrl,rect,pageUrl:unproxy(location.href)}},location.origin),
    (err)=>parent.postMessage({type:CAPTURE,error:String(err&&err.message||err).slice(0,500),rect},location.origin)
  )
};
const enableCapture=()=>{
  if(captureActive)return;
  disable();disableEdit();
  captureActive=true;
  captureOverlay=document.createElement('div');captureOverlay.setAttribute('data-voicechat-inspector','capture');
  Object.assign(captureOverlay.style,{position:'fixed',inset:'0',zIndex:'2147483647',cursor:'crosshair',background:'rgba(23,32,51,.15)'});
  captureBox=document.createElement('div');
  Object.assign(captureBox.style,{position:'fixed',border:'2px dashed #4f8cff',background:'rgba(79,140,255,.15)',display:'none',pointerEvents:'none'});
  captureOverlay.append(captureBox);document.documentElement.append(captureOverlay);
  document.addEventListener('pointerdown',captureDown,true);document.addEventListener('pointermove',captureMove,true);document.addEventListener('pointerup',captureUp,true);document.addEventListener('keydown',captureKey,true)
};
const disableCapture=()=>{
  if(!captureActive)return;
  captureActive=false;captureCleanup();
  document.removeEventListener('pointerdown',captureDown,true);document.removeEventListener('pointermove',captureMove,true);document.removeEventListener('pointerup',captureUp,true);document.removeEventListener('keydown',captureKey,true)
};
const inlineImages=(root)=>Promise.all([...root.querySelectorAll('img')].map(async(img)=>{
  try{
    const src=img.getAttribute('src');
    if(!src||src.startsWith('data:'))return;
    const res=await fetch(src);const blob=await res.blob();
    img.setAttribute('src',await new Promise((ok,fail)=>{const reader=new FileReader();reader.onload=()=>ok(String(reader.result));reader.onerror=fail;reader.readAsDataURL(blob)}))
  }catch{img.removeAttribute('src')}
}));
const captureArea=async(rect,maxSide)=>{
  // Canvas проверяем до тяжёлой работы: без него снимок невозможен в принципе.
  const scale=maxSide?Math.min(1,maxSide/Math.max(rect.width,rect.height)):1;
  const canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.round(rect.width*scale));canvas.height=Math.max(1,Math.round(rect.height*scale));
  const ctx=canvas.getContext&&canvas.getContext('2d');
  if(!ctx)throw new Error('Canvas недоступен в этом окружении');
  const source=document.body;
  const all=source.querySelectorAll('*');
  if(all.length>4000)throw new Error('Страница слишком сложная для снимка области');
  const clone=source.cloneNode(true);
  const srcEls=[source,...all],dstEls=[clone,...clone.querySelectorAll('*')];
  for(let i=0;i<srcEls.length&&i<dstEls.length;i++){
    const cs=getComputedStyle(srcEls[i]);let css='';
    for(let j=0;j<cs.length;j++){const prop=cs[j];css+=prop+':'+cs.getPropertyValue(prop).replace(/"/g,"'")+';'}
    dstEls[i].setAttribute('style',css)
  }
  for(const el of clone.querySelectorAll('[data-voicechat-inspector]'))el.remove();
  await inlineImages(clone);
  const scroller=document.scrollingElement||document.documentElement;
  const width=Math.max(scroller.scrollWidth,innerWidth),height=Math.max(scroller.scrollHeight,innerHeight);
  const svg='<svg xmlns="http://www.w3.org/2000/svg" width="'+width+'" height="'+height+'"><foreignObject width="100%" height="100%">'+new XMLSerializer().serializeToString(clone)+'</foreignObject></svg>';
  const image=new Image();
  await new Promise((ok,fail)=>{
    const guard=setTimeout(()=>fail(new Error('Снимок страницы не отрисовался вовремя')),7000);
    image.onload=()=>{clearTimeout(guard);ok()};
    image.onerror=()=>{clearTimeout(guard);fail(new Error('Не удалось отрисовать снимок страницы'))};
    image.src='data:image/svg+xml;charset=utf-8,'+encodeURIComponent(svg)
  });
  ctx.fillStyle='#ffffff';ctx.fillRect(0,0,canvas.width,canvas.height);
  if(scale!==1)ctx.scale(scale,scale);
  ctx.drawImage(image,-rect.x,-rect.y);
  let dataUrl=canvas.toDataURL('image/png');
  if(dataUrl.length>1800000)dataUrl=canvas.toDataURL('image/jpeg',0.85);
  if(dataUrl.length>1800000)throw new Error('Снимок области слишком большой — выделите меньшую область');
  return dataUrl
};
restoreEdits();
const message=(e)=>{
  if(e.source!==parent||e.origin!==location.origin||!e.data)return;
  if(e.data.type===COMMAND&&typeof e.data.enabled==='boolean'){if(e.data.enabled){disableEdit();disableCapture();enable()}else disable();return}
  if(e.data.type===EDIT&&typeof e.data.enabled==='boolean'){if(e.data.enabled){disableCapture();enableEdit()}else disableEdit();return}
  if(e.data.type===CAPTURE&&typeof e.data.enabled==='boolean'){e.data.enabled?enableCapture():disableCapture();return}
  if(e.data.type===RECORD&&typeof e.data.enabled==='boolean'){setRecording(e.data.enabled);return}
  if(e.data.type===ACTION&&typeof e.data.requestId==='string'&&e.data.action&&typeof e.data.action.kind==='string'){
    diagnosticRunning=e.data.action.diagnostic===true;
    const requestId=e.data.requestId;
    try{
      const value=run(e.data.action);
      // Снимок собирается асинхронно — ответ уходит по завершении промиса.
      if(value&&typeof value.then==='function')value.then((r)=>reply(requestId,true,r),(err)=>reply(requestId,false,err&&err.message||err));
      else reply(requestId,true,value)
    }
    catch(err){reply(requestId,false,err&&err.message||err)}
    finally{diagnosticRunning=false}
  }
};
addEventListener('message',message);addEventListener('pagehide',()=>{disable();disableEdit();disableCapture();setRecording(false);removeEventListener('message',message)},{once:true});
})();<\/script>`
}

export function rewritePreviewBody(body: Buffer, type: string, base: URL): Buffer {
  let text = body.toString('utf8')
  const rewriteCssUrls = (css: string): string => css.replace(/url\(\s*(['"]?)(.*?)\1\s*\)/gi, (_m, quote, value) => 'url(' + quote + proxyUrl(value, base) + quote + ')')
  if (/text\/html|application\/xhtml\+xml/i.test(type)) {
    text = text.replace(/<meta\b[^>]*http-equiv\s*=\s*(['"]?)content-security-policy\1[^>]*>/gi, '')
      // target=_blank выпрыгивал бы из iframe в голую вкладку прокси.
      .replace(/\starget\s*=\s*(["'])_blank\1/gi, '')
      .replace(/\b(href|src|action|poster)\s*=\s*(["'])(.*?)\2/gi, (_m, name, quote, value) => name + '=' + quote + proxyUrl(value, base) + quote)
      .replace(/\bsrcset\s*=\s*(["'])(.*?)\1/gi, (_m, quote, value) => 'srcset=' + quote + value.split(',').map((part: string) => {
        const [url, ...descriptor] = part.trim().split(/\s+/)
        return proxyUrl(url, base) + (descriptor.length ? ' ' + descriptor.join(' ') : '')
      }).join(', ') + quote)
      .replace(/(<style\b[^>]*>)([\s\S]*?)(<\/style\s*>)/gi, (_m, open, css, close) => open + rewriteCssUrls(css) + close)
      .replace(/\bstyle\s*=\s*(["'])(.*?)\1/gi, (_m, quote, value) => 'style=' + quote + rewriteCssUrls(value) + quote)
    const context = previewContextScript(base.toString())
    const inspector = previewInspectorScript()
    text = /<head\b[^>]*>/i.test(text) ? text.replace(/<head\b[^>]*>/i, (head) => head + context) : context + text
    text = /<\/body\s*>/i.test(text) ? text.replace(/<\/body\s*>/i, inspector + '</body>') : text + inspector
  }
  if (/text\/css/i.test(type)) text = rewriteCssUrls(text)
  return Buffer.from(text)
}

/**
 * Заголовки запроса страницы, которые уходят апстриму: hop-by-hop, адресация и
 * авторизация/сессия ChatAI (cookie, authorization) отбрасываются; заголовок
 * x-preview-authorization — так context shim передаёт Authorization самой
 * страницы, не задевая Bearer-гейт ChatAI, — возвращается апстриму как authorization.
 * Conditional-заголовки (if-none-match и т.п.) тоже: браузер шлёт валидаторы
 * переписанного тела, апстрим отвечал бы 304 по своему неизменному телу, и
 * старый инъецированный HTML залипал бы в кэше браузера после обновления шимов.
 */
const DROPPED_REQUEST_HEADERS = new Set(['host', 'connection', 'content-length', 'transfer-encoding', 'keep-alive', 'upgrade', 'te', 'trailer', 'expect', 'cookie', 'authorization', 'proxy-authorization', 'accept-encoding', 'origin', 'referer', 'via', 'priority', 'if-none-match', 'if-modified-since', 'if-match', 'if-unmodified-since', 'if-range'])

export function upstreamRequestHeaders(incoming: NodeJS.Dict<string | string[]>): Record<string, string | string[]> {
  const headers: Record<string, string | string[]> = {}
  for (const [name, value] of Object.entries(incoming)) {
    if (value === undefined) continue
    const lower = name.toLowerCase()
    if (DROPPED_REQUEST_HEADERS.has(lower) || lower.startsWith('sec-') || lower.startsWith('x-forwarded-')) continue
    headers[lower === 'x-preview-authorization' ? 'authorization' : lower] = value
  }
  return headers
}

async function get(url: URL, userId: string, method = 'GET', body?: string | Buffer, headers: Record<string, string | string[]> = {}): Promise<{ response: IncomingMessage; finalUrl: URL }> {
  await assertPublicHost(url.hostname)
  return new Promise((resolve, reject) => {
    const transport = url.protocol === 'https:' ? httpsRequest : httpRequest
    const request = transport(url, {
      method,
      headers: { 'user-agent': 'voiceAIChat-preview/1.0', accept: '*/*', ...headers, ...(requestCookieHeader(userId, url) ? { cookie: requestCookieHeader(userId, url) } : {}), ...(body === undefined ? {} : { 'content-length': String(Buffer.byteLength(body)) }) },
      timeout: TIMEOUT_MS,
      lookup(hostname, options, callback) {
        void lookup(hostname, { all: true, verbatim: true }).then((addresses) => {
          let result: ResolvedAddress | ResolvedAddress[]
          try {
            result = publicLookupResult(addresses, options.all === true)
          } catch (err) {
            return callback(err as Error, options.all ? [] : '', 4)
          }
          if (Array.isArray(result)) return callback(null, result)
          callback(null, result.address, result.family)
        }, (err) => callback(err, options.all ? [] : '', 4))
      }
    }, (response) => resolve({ response, finalUrl: url }))
    request.once('timeout', () => request.destroy(new PreviewProxyError(504, 'Сайт не ответил вовремя')))
    request.once('error', reject)
    request.end(body)
  })
}

async function load(url: URL, userId: string, method = 'GET', body?: string | Buffer, headers: Record<string, string | string[]> = {}): Promise<{ response: IncomingMessage; finalUrl: URL }> {
  let current = url
  let currentMethod = method
  let currentBody = body
  let currentHeaders = headers
  for (let redirects = 0; redirects <= MAX_REDIRECTS; redirects++) {
    const result = await get(current, userId, currentMethod, currentBody, currentHeaders)
    const location = result.response.headers.location
    if (!location || ![301, 302, 303, 307, 308].includes(result.response.statusCode ?? 0)) return result
    result.response.resume()
    if (redirects === MAX_REDIRECTS) throw new PreviewProxyError(502, 'Слишком много перенаправлений')
    if ([301, 302, 303].includes(result.response.statusCode ?? 0) && currentMethod !== 'GET' && currentMethod !== 'HEAD') {
      currentMethod = 'GET'
      currentBody = undefined
      currentHeaders = { ...currentHeaders }
      delete currentHeaders['content-type']
    }
    current = new URL(location, current)
    if (current.protocol !== 'http:' && current.protocol !== 'https:') throw new PreviewProxyError(400, 'Разрешены только HTTP и HTTPS')
  }
  throw new PreviewProxyError(502, 'Не удалось загрузить сайт')
}

async function readLimited(response: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of response) {
    const data = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    size += data.length
    if (size > MAX_BYTES) {
      response.destroy()
      throw new PreviewProxyError(413, 'Ответ сайта слишком большой')
    }
    chunks.push(data)
  }
  return Buffer.concat(chunks)
}

export function previewDiagnosticsHtml(destination = false): string {
  if (destination) return '<!doctype html><html><head><title>Diagnostics destination</title></head><body><h1>Diagnostics destination</h1><p id="destination-status">navigation:ready</p></body></html>'
  return `<!doctype html><html><head><title>VoiceChat Web Reader Diagnostics</title><style>#diagnostic-style{display:block;color:rgb(12, 34, 56)}</style></head><body>
<h1>VoiceChat Web Reader Diagnostics</h1><p id="diagnostic-style">Diagnostic action surface</p>
<form id="diagnostic-form"><input id="diagnostic-input" name="diagnostic-input" autocomplete="off"><button type="submit">Submit diagnostic form</button></form>
<p id="event-status">input:0 change:0</p><p id="submit-status">not-submitted</p>
<p id="hover-target">Diagnostic hover target</p><p id="hover-status">hover:0</p>
<p id="key-status">key:none</p>
<a id="diagnostic-nav" href="/api/preview/diagnostics?page=destination">Diagnostic action navigation</a>
<div id="diagnostic-tall" style="height:3000px"></div><p id="page-bottom">page bottom</p>
<script>(()=>{let input=0,change=0,hover=0;const field=document.querySelector('#diagnostic-input'),events=document.querySelector('#event-status');field.addEventListener('input',()=>{input++;events.textContent='input:'+input+' change:'+change});field.addEventListener('change',()=>{change++;events.textContent='input:'+input+' change:'+change});document.querySelector('#diagnostic-form').addEventListener('submit',(event)=>{event.preventDefault();document.querySelector('#submit-status').textContent='submitted:'+field.value});document.querySelector('#hover-target').addEventListener('mouseover',()=>{hover++;document.querySelector('#hover-status').textContent='hover:'+hover});document.addEventListener('keydown',(event)=>{document.querySelector('#key-status').textContent='key:'+event.key})})()<\/script>
</body></html>`
}

/**
 * Проксирует запрос в loopback машины через компаньон-агента, следуя внутренним
 * редиректам окружения. Ответ проходит тот же rewrite и cookie-контейнер, что и
 * публичные сайты, поэтому логин тестовых пользователей и относительные ссылки
 * работают как обычно.
 */
async function loadViaMachine(
  deps: NonNullable<PreviewProxyDeps['machines']>,
  userId: string,
  url: URL,
  method: string,
  body: string | Buffer | undefined,
  incomingHeaders: Record<string, string | string[]>
): Promise<{ status: number; headers: Record<string, string | string[]>; body: Buffer; finalUrl: URL }> {
  let current = url
  let currentMethod = method
  let currentBody = body
  const headers = { ...incomingHeaders }
  for (let redirects = 0; redirects <= MAX_REDIRECTS; redirects++) {
    const agentId = machineAgentIdOf(current.hostname)
    if (!agentId) throw new PreviewProxyError(502, 'Тестовое окружение перенаправило наружу — открой внешний адрес напрямую')
    if (!deps.canUse(userId, agentId)) throw new PreviewProxyError(403, 'Машина недоступна этому пользователю')
    if (!deps.bridge.isOnline(agentId)) throw new PreviewProxyError(502, 'Машина тестового окружения не в сети')
    const secure = current.protocol === 'https:'
    const port = current.port ? Number(current.port) : secure ? 443 : 80
    const cookie = requestCookieHeader(userId, current)
    let response: AgentHttpResponse
    try {
      response = await deps.bridge.http(agentId, {
        method: currentMethod,
        ...(secure ? { protocol: 'https' as const } : {}),
        port,
        path: current.pathname + current.search,
        headers: { ...headers, ...(cookie ? { cookie } : {}) },
        ...(currentBody === undefined ? {} : { bodyBase64: Buffer.from(currentBody).toString('base64') })
      })
    } catch (err) {
      throw new PreviewProxyError(502, err instanceof Error ? err.message : 'Тестовое окружение недоступно')
    }
    storeResponseCookies(userId, current, response.headers['set-cookie'])
    const location = headerValue(response.headers, 'location')
    if (location && [301, 302, 303, 307, 308].includes(response.status)) {
      const next = new URL(location, current)
      // Окружение знает себя как 127.0.0.1/localhost — возвращаем редирект на мост той же машины.
      if (next.hostname === '127.0.0.1' || next.hostname === 'localhost') next.hostname = agentId + MACHINE_PREVIEW_SUFFIX
      if ([301, 302, 303].includes(response.status) && currentMethod !== 'GET' && currentMethod !== 'HEAD') {
        currentMethod = 'GET'
        currentBody = undefined
        delete headers['content-type']
      }
      current = next
      continue
    }
    return { status: response.status, headers: response.headers, body: Buffer.from(response.bodyBase64, 'base64'), finalUrl: current }
  }
  throw new PreviewProxyError(502, 'Слишком много перенаправлений')
}

/** Сколько cookie снято; host сужает сброс до одного сайта (домен + поддомены). */
export function clearPreviewCookies(userId: string, host?: string): number {
  const cookies = cookiesByUser.get(userId) ?? []
  if (!host) {
    cookiesByUser.delete(userId)
    return cookies.length
  }
  const target = host.toLowerCase()
  const kept = cookies.filter((cookie) => cookie.domain !== target && !target.endsWith('.' + cookie.domain) && !cookie.domain.endsWith('.' + target))
  cookiesByUser.set(userId, kept)
  return cookies.length - kept.length
}

/**
 * Заголовки ответа апстрима, которые не возвращаются браузеру: фрейм-политики
 * мешают iframe, cookie живут в серверном контейнере, а валидаторы кэша
 * (etag/last-modified) описывают апстримное тело — после инъекций оно другое,
 * и ревалидация по ним оставляла бы в кэше браузера устаревшие шимы.
 */
const DROPPED_RESPONSE_HEADERS = new Set(['x-frame-options', 'content-security-policy', 'set-cookie', 'content-length', 'connection', 'transfer-encoding', 'etag', 'last-modified'])

export function registerPreviewProxy(app: FastifyInstance, deps: PreviewProxyDeps = {}): void {
  // Сброс сессий окружений: удобно перелогиниться под другим тестовым
  // пользователем. Авторизуется preview-cookie (кнопка «Сессия» в Reader) или Bearer.
  app.post<{ Body: { host?: string } }>('/api/preview/reset-cookies', async (req) => {
    const host = typeof req.body?.host === 'string' && req.body.host.length <= 255 ? req.body.host : undefined
    return { cleared: clearPreviewCookies(uid(req), host) }
  })
  app.get<{ Querystring: { page?: string } }>('/api/preview/diagnostics', async (req, reply) =>
    reply.type('text/html; charset=utf-8').send(previewDiagnosticsHtml(req.query.page === 'destination'))
  )
  // Отдельный scope: тело любого content-type (JSON, multipart, бинарь) уходит
  // апстриму сырым буфером и не попадает в парсеры остального API.
  void app.register(async (scope) => {
    scope.removeAllContentTypeParsers()
    scope.addContentTypeParser('*', { parseAs: 'buffer' }, (_req, body, done) => done(null, body))
    scope.all<{ Querystring: { url?: string }; Body: string | Buffer }>('/api/preview', async (req, reply) => {
      let url: URL
      try {
        url = new URL(req.query.url ?? '')
        if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error()
      } catch {
        return reply.code(400).send({ error: 'invalid_url', message: 'Разрешены только HTTP и HTTPS адреса' })
      }
      try {
        // Самодиагностика не выполняет сетевой запрос: принимается только точный
        // same-origin внутренний маршрут и проходит через тот же rewrite/DOM bridge.
        if (url.pathname === '/api/preview/diagnostics' && url.host === req.headers.host) {
          const source = Buffer.from(previewDiagnosticsHtml(url.searchParams.get('page') === 'destination'))
          const rewritten = rewritePreviewBody(source, 'text/html; charset=utf-8', url)
          return reply.type('text/html; charset=utf-8').send(rewritten)
        }
        const userId = uid(req)
        const body = (typeof req.body === 'string' || Buffer.isBuffer(req.body)) && req.method !== 'GET' && req.method !== 'HEAD' ? req.body : undefined
        // Тестовые окружения машин: доставка через компаньон-агента, не сетью.
        if (machineAgentIdOf(url.hostname)) {
          if (!deps.machines) throw new PreviewProxyError(502, 'Мост машин недоступен на этом сервере')
          const machine = await loadViaMachine(deps.machines, userId, url, req.method, body, upstreamRequestHeaders(req.headers))
          const machineType = headerValue(machine.headers, 'content-type') ?? 'application/octet-stream'
          const machineBody = /text\/(html|css)|application\/xhtml\+xml/i.test(machineType)
            ? rewritePreviewBody(machine.body, machineType, machine.finalUrl)
            : machine.body
          reply.code(machine.status)
          for (const [name, value] of Object.entries(machine.headers)) {
            if (value === undefined || DROPPED_RESPONSE_HEADERS.has(name.toLowerCase()) || name.toLowerCase() === 'location') continue
            reply.header(name, value)
          }
          reply.header('content-type', machineType)
          reply.header('content-length', String(machineBody.length))
          return reply.send(machineBody)
        }
        const { response, finalUrl } = await load(url, userId, req.method, body, upstreamRequestHeaders(req.headers))
        storeResponseCookies(userId, finalUrl, response.headers['set-cookie'])
        const responseType = response.headers['content-type'] ?? 'application/octet-stream'
        const responseBody = await readLimited(response)
        const rewritten = /text\/(html|css)|application\/xhtml\+xml/i.test(responseType) ? rewritePreviewBody(responseBody, responseType, finalUrl) : responseBody
        reply.code(response.statusCode ?? 502)
        for (const [name, value] of Object.entries(response.headers)) {
          if (value === undefined || DROPPED_RESPONSE_HEADERS.has(name.toLowerCase())) continue
          reply.header(name, value)
        }
        reply.header('content-type', responseType)
        reply.header('content-length', String(rewritten.length))
        return reply.send(rewritten)
      } catch (err) {
        const known = err instanceof PreviewProxyError ? err : new PreviewProxyError(502, 'Сайт недоступен')
        return reply.code(known.status).send({ error: 'preview_unavailable', message: known.message })
      }
    })
  })
}
