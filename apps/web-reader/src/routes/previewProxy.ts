import { decodePreviewText, decodePreviewResponse, isPreviewText, previewContentType, previewRedirect, PreviewResponseError } from './previewResponse.js'
import { previewKeyboardHelpers } from './previewKeyboard.js'
import { previewReadingHelpers } from './previewReading.js'
import { previewAuditHelpers } from './audit/runtime.js'
import { previewProbeHelpers } from '@voicechat/browser-contracts/audit'
import { previewResourceScript } from './previewResources.js'
import { READER_PROJECT_ORIGIN, readerProjectUrl, type ReaderProjectRequest, type ReaderProjectResponse } from '@voicechat/shared'
import { loadPreviewProject, ProjectPreviewError } from './previewProjectLoader.js'
import { previewInteractionHelpers } from './previewInteractions.js'
import { previewStorageScript } from './previewStorage.js'
import { PreviewCookieStore, responseSetCookies } from './previewCookies.js'
import { rewritePreviewCss } from './previewStyles.js'
import { previewNavigationScript } from './previewNavigation.js'
import { lookup } from 'node:dns/promises'
import type { LookupAddress } from 'node:dns'
import { request as httpRequest } from 'node:http'
import { request as httpsRequest } from 'node:https'
import type { IncomingMessage } from 'node:http'
import type { FastifyInstance } from 'fastify'
import type { AgentHttpRequest, AgentHttpResponse } from '@voicechat/shared'
import { createHash } from 'node:crypto'
import type { FastifyRequest } from 'fastify'
const uid = (req: FastifyRequest): string => (req as unknown as { user: { name: string } }).user.name
import { applyHostAlias, type HostAliases } from '@voicechat/browser-contracts/security'
import { assertPublicHost as assertPublicHostUtil, isPublicAddress, PublicHostError } from '../publicHost.js'
import { rewritePreviewModules, rewritePreviewImportMap } from './previewModules.js'
import { rewritePreviewHtml } from './previewHtml.js'
import { canReadPreviewCache, canStorePreviewCache } from './previewCachePolicy.js'
import { MachineResponseCache, isCacheableMachineResponse } from './machineCache.js'

const MAX_REDIRECTS = 5
const MAX_BYTES = 5 * 1024 * 1024
const TIMEOUT_MS = 10_000

// Экспорт совместимости для чистых тестов; живые маршруты получают свой контейнер.
const legacyCookies = new PreviewCookieStore()
export const storeResponseCookies = legacyCookies.store.bind(legacyCookies)
export const requestCookieHeader = legacyCookies.header.bind(legacyCookies)
export const clearPreviewCookies = legacyCookies.clear.bind(legacyCookies)

export class PreviewProxyError extends Error {
  constructor(readonly status: number, message: string) { super(message) }
}

// ---- Loopback-мост машин: тестовые окружения Web Reader --------------------
// Виртуальный хост `<agentId>.machine.internal:<port>` доставляется не сетью, а
// компаньон-агентом машины (HTTP строго к его 127.0.0.1:<port>). Так модель и
// пользователь открывают в Reader dev-серверы и feature-preview репозиториев,
// не выставляя их наружу; SSRF-гейт публичных адресов эта ветка не ослабляет.
import { MACHINE_PREVIEW_SUFFIX } from '@voicechat/shared'
export { MACHINE_PREVIEW_SUFFIX } from '@voicechat/shared'
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
  isOnline(agentId: string): boolean | Promise<boolean>
  http(agentId: string, request: AgentHttpRequest, userId: string): Promise<AgentHttpResponse>
}

export interface PreviewProxyDeps {
  projectResource?: (request: ReaderProjectRequest) => Promise<ReaderProjectResponse>
  /** Изолированный контейнер; тесты могут передать его явно. */
  cookies?: PreviewCookieStore
  /** Разрешённые оператором пары VC_BROWSER_HOST_ALIASES; пользователь их не задаёт. */
  hostAliases?: HostAliases
  machines?: {
    bridge: PreviewMachineBridge
    /** Доступ пользователя к машине (владелец или share проекта). */
    canUse(userId: string, agentId: string): Promise<boolean>
  }
}

function headerValue(headers: Record<string, string | string[]>, name: string): string | undefined {
  const key = Object.keys(headers).find(key => key.toLowerCase() === name.toLowerCase())
  const value = key === undefined ? undefined : headers[key]
  return Array.isArray(value) ? value[0] : value
}

/** Гард публичных адресов общий с импортом Make (`util/publicHost.ts`); здесь — только перевод в ответ 403. */
export { isPublicAddress } from '../publicHost.js'

type ResolvedAddress = LookupAddress

export function publicLookupResult(addresses: ResolvedAddress[], all: boolean): ResolvedAddress | ResolvedAddress[] {
  const address = addresses[0]
  if (!address || addresses.some((candidate) => !isPublicAddress(candidate.address))) {
    throw new PreviewProxyError(403, 'Адрес сайта недоступен для превью')
  }
  return all ? addresses : address
}

export async function assertPublicHost(hostname: string): Promise<void> {
  try { await assertPublicHostUtil(hostname) } catch (error) {
    if (error instanceof PublicHostError) throw new PreviewProxyError(403, error.message)
    throw error
  }
}

function proxyUrl(value: string, base: URL): string {
  try {
    const target = new URL(value, base)
    return target.protocol === 'http:' || target.protocol === 'https:' ? '/api/preview?url=' + encodeURIComponent(target.toString()) : value
  } catch { return value }
}

export const PREVIEW_INSPECTOR_SCRIPT_ID = 'voicechat-preview-inspector'

/** Emulates a browser origin while the rendered document safely stays on ChatAI origin. */
export function previewContextScript(base: string, documentBase = base): string {
  const baseUrl = new URL(base)
  const key = `voicechat.preview.context.v1:${baseUrl.origin}:`
  const fallbackBase = JSON.stringify(baseUrl.toString())
  return `<script>(()=>{${previewStorageScript(key)}
const fallbackBase=${fallbackBase};
// URL ответа может отличаться после redirect; runtime должен видеть ту же базу,
// что и переписанные HTML-ресурсы. replaceState не добавляет пустой шаг назад.
try{const outer=new URL(location.href);if(outer.pathname==='/api/preview'&&outer.searchParams.has('url')){const final=new URL(fallbackBase);if(outer.hash)final.hash=outer.hash;outer.searchParams.set('url',final.toString());outer.hash=final.hash;history.replaceState(history.state,'',outer.toString())}}catch{}
const currentBase=()=>{try{const u=new URL(location.href);const t=u.searchParams.get('url');if(u.pathname==='/api/preview'&&t)return t}catch{}return fallbackBase};
const documentBase=${JSON.stringify(documentBase)};
const toProxy=(value)=>{const s=String(value);
try{const local=new URL(s,location.href);if(local.origin===location.origin&&local.pathname==='/api/preview'&&local.searchParams.has('url'))return s}catch{}
try{const u=new URL(s,documentBase===fallbackBase?currentBase():documentBase);if(u.protocol==='http:'||u.protocol==='https:')return '/api/preview?url='+encodeURIComponent(u.toString())+u.hash}catch{}
return s};
${previewResourceScript()}
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
history.pushState=(state,title,url)=>{nativePush(state,title,url==null?url:toProxy(String(url)));dispatchEvent(new Event('voicechat.preview.navigation'))};
history.replaceState=(state,title,url)=>{nativeReplaceState(state,title,url==null?url:toProxy(String(url)));dispatchEvent(new Event('voicechat.preview.navigation'))}}catch{}
${previewNavigationScript()}
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
    if(node.parentElement){const same=[...node.parentElement.children].filter(x=>x.localName===node.localName);if(same.length>1)s+=':nth-of-type('+(same.indexOf(node)+1)+')'}
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
  pageUrl:pageInfo().url,viewport:{width:innerWidth,height:innerHeight},outerHTML:el.outerHTML.slice(0,HTML_LIMIT),
  text:(el.innerText||el.textContent||'').trim().slice(0,TEXT_LIMIT),styles:styles(el)
}};
const move=(e)=>{if(!active)return;const el=e.target;if(el instanceof Element&&!el.closest('[data-voicechat-inspector]'))draw(el)};
const click=(e)=>{if(!active)return;const el=e.target;if(!(el instanceof Element)||el.closest('[data-voicechat-inspector]'))return;e.preventDefault();e.stopPropagation();e.stopImmediatePropagation();selected=el;draw(el);parent.postMessage({type:SELECTED,payload:payload(el)},location.origin)};
const key=(e)=>{if(active&&e.key==='Escape'){e.preventDefault();disable();parent.postMessage({type:COMMAND,enabled:false},location.origin)}};
const enable=()=>{if(active)return;active=true;document.addEventListener('pointerover',move,true);document.addEventListener('click',click,true);document.addEventListener('keydown',key,true)};
const disable=()=>{active=false;selected=null;document.removeEventListener('pointerover',move,true);document.removeEventListener('click',click,true);document.removeEventListener('keydown',key,true);hide()};
const ACTION='voicechat.preview.action.v1', RESULT='voicechat.preview.action-result.v1', READY='voicechat.preview.page-ready.v1', LOADING='voicechat.preview.page-loading.v1', RECORD='voicechat.preview.record.v1';
addEventListener('beforeunload',()=>parent.postMessage({type:LOADING,url:location.href},location.origin));
// ---- Буферы страницы: ошибки (errors), сеть (network) и консоль (console) ----
const pageErrors=[];const ERRORS_CAP=100;
const pushError=(entry)=>{entry.message=String(entry.message||'').slice(0,500);entry.at=Math.round(performance.now());pageErrors.push(entry);if(pageErrors.length>ERRORS_CAP)pageErrors.shift()};
const pageNetwork=[];const NETWORK_CAP=200;
const pushNetwork=(entry)=>{pageNetwork.push(entry);if(pageNetwork.length>NETWORK_CAP)pageNetwork.shift()};
const pageConsole=[];const CONSOLE_CAP=300;
const pushConsole=(level,args)=>{try{const message=Array.prototype.map.call(args,(a)=>a&&a.message||(typeof a==='object'?JSON.stringify(a):String(a))).join(' ').slice(0,500);pageConsole.push({level,message,at:Math.round(performance.now())});if(pageConsole.length>CONSOLE_CAP)pageConsole.shift()}catch{}};
addEventListener('error',(e)=>{if(e instanceof ErrorEvent)pushError({kind:'error',message:e.message||'Ошибка скрипта'})},true);
addEventListener('unhandledrejection',(e)=>pushError({kind:'unhandledrejection',message:e&&e.reason&&(e.reason.message||String(e.reason))||'unhandledrejection'}));
for(const level of ['log','info','warn','error'])try{const nativeLog=console[level].bind(console);console[level]=function(){pushConsole(level,arguments);if(level==='error')try{pushError({kind:'console.error',message:Array.prototype.map.call(arguments,(a)=>a&&a.message||(typeof a==='object'?JSON.stringify(a):String(a))).join(' ')})}catch{}return nativeLog.apply(null,arguments)}}catch{}
// fetch уже переписан context-шимом на прокси — оборачиваем поверх для журнала и статусов.
// Сколько запросов в полёте: wait {idle} ждёт, когда страница затихнет, как человек ждёт спиннер.
let inFlight=0,lastNetworkAt=0;const netStart=()=>{inFlight++;lastNetworkAt=performance.now()},netEnd=()=>{inFlight=Math.max(0,inFlight-1);lastNetworkAt=performance.now()};
try{const shimFetch=window.fetch.bind(window);window.fetch=function(input,init){
  const started=performance.now();netStart();
  const url=(()=>{try{return String(unproxyLazy(typeof input==='string'?input:(input&&input.url)||String(input))).slice(0,300)}catch{return String(input).slice(0,300)}})();
  const method=String((init&&init.method)||(input&&typeof input==='object'&&input.method)||'GET').toUpperCase();
  const entry={via:'fetch',method,url,at:Math.round(started)};pushNetwork(entry);
  return shimFetch(input,init).then((res)=>{netEnd();entry.ms=Math.round(performance.now()-started);if(res)entry.status=res.status;if(res&&res.status>=400)pushError({kind:'network',message:'HTTP '+res.status,url:(()=>{try{return unproxyLazy(res.url)}catch{return url}})(),status:res.status});return res},(err)=>{netEnd();entry.ms=Math.round(performance.now()-started);entry.error=String(err&&err.message||'network error').slice(0,200);pushError({kind:'network',message:entry.error});throw err})
}}catch{}
try{const xhrOpen=XMLHttpRequest.prototype.open,xhrSend=XMLHttpRequest.prototype.send;
XMLHttpRequest.prototype.open=function(method,url){this.__vcNet={method:String(method||'GET').toUpperCase(),url:(()=>{try{return String(unproxyLazy(String(url))).slice(0,300)}catch{return String(url).slice(0,300)}})()};return xhrOpen.apply(this,arguments)};
XMLHttpRequest.prototype.send=function(){const started=performance.now();netStart();const meta=this.__vcNet||{method:'GET',url:''};const entry={via:'xhr',method:meta.method,url:meta.url,at:Math.round(started)};pushNetwork(entry);this.addEventListener('loadend',()=>{netEnd();entry.ms=Math.round(performance.now()-started);entry.status=this.status;if(this.status>=400)pushError({kind:'network',message:'HTTP '+this.status,url:(()=>{try{return unproxyLazy(this.responseURL)}catch{return ''}})(),status:this.status})});return xhrSend.apply(this,arguments)}}catch{}
if(typeof navigator.sendBeacon==='function')try{const shimBeacon=navigator.sendBeacon.bind(navigator);navigator.sendBeacon=function(url,data){pushNetwork({via:'beacon',method:'POST',url:(()=>{try{return String(unproxyLazy(String(url))).slice(0,300)}catch{return String(url).slice(0,300)}})(),at:Math.round(performance.now())});return arguments.length>1?shimBeacon(url,data):shimBeacon(url)}}catch{}
// unproxy объявлен ниже — ленивое обращение (ошибки случаются после инициализации).
function unproxyLazy(value){return typeof unproxy==='function'?unproxy(value):String(value)}
const EL_TEXT=200, SNIPPET=4000, FIND_MAX=30, HEADINGS=64, LINKS=100, BUTTONS=50, INPUTS=50;
const CLICKABLE='a,button,[role=button],[role=link],[role=tab],[role=menuitem],input,select,textarea,label,summary,[onclick]';
const unproxy=(value)=>{try{const u=new URL(value,location.href);if(u.pathname==='/api/preview'){const t=u.searchParams.get('url');if(t)return t}return u.toString()}catch{return value}};
const pageInfo=()=>{let url=unproxy(location.href);try{const target=new URL(url);target.hash=location.hash;url=target.toString()}catch{}
  const info={url,title:document.title||''};
  // Язык, описание и иконка — то, что человек видит во вкладке браузера и по чему узнаёт сайт.
  const lang=(document.documentElement.getAttribute('lang')||'').trim();if(lang)info.lang=lang.slice(0,16);
  const meta=document.querySelector('meta[name="description"],meta[property="og:description"]');const description=meta&&meta.getAttribute('content');if(description&&description.trim())info.description=description.trim().slice(0,200);
  const icon=document.querySelector('link[rel~="icon"]');const href=icon&&icon.getAttribute('href');if(href){try{info.icon=unproxy(new URL(href,location.href).toString()).slice(0,500)}catch{}}
  // Без <link rel=icon> браузеры пробуют /favicon.ico — делаем так же.
  if(!info.icon){try{info.icon=new URL('/favicon.ico',url).toString()}catch{}}
  return info};
const textOf=(el)=>(el.innerText||el.textContent||'').replace(/\\s+/g,' ').trim();
// Человек не различает «ёлочки» и "кавычки", тире и дефис, обычный и неразрывный пробел — поиск текста тоже не должен.
const normText=(value)=>String(value||'').replace(/[\u00a0\u202f]/g,' ').replace(/[«»“”„"]/g,'"').replace(/[’‘\u0060´]/g,"'").replace(/[–—‑]/g,'-').replace(/\\s+/g,' ').trim().toLowerCase();
${previewInteractionHelpers()}
${previewReadingHelpers()}
${previewAuditHelpers()}
${previewProbeHelpers()}
${previewKeyboardHelpers()}
const visibleText=(scope)=>{
  const walker=document.createTreeWalker(scope,NodeFilter.SHOW_TEXT),parts=[];let node;
  while((node=walker.nextNode())){const parent=node.parentElement;if(!parent||parent.closest('script,style,template,noscript,[data-voicechat-inspector]')||!readingVisible(parent)||!onScreen(parent))continue;if(parent.closest('textarea')&&sensitive(parent.closest('textarea')))continue;const text=(node.nodeValue||'').replace(/\\s+/g,' ').trim();if(text)parts.push(text)}
  return parts.join(' ')
};
const onScreen=(el)=>{const r=el.getBoundingClientRect();return r.width>0&&r.height>0&&r.bottom>0&&r.right>0&&r.top<innerHeight&&r.left<innerWidth};
// Короткая подсветка элемента, с которым работает модель: человек видит, куда именно «нажали».
const FLASH_ATTR='data-voicechat-flash';
const flash=(el)=>{try{const prev=el.style.outline,prevOffset=el.style.outlineOffset;el.setAttribute(FLASH_ATTR,'');el.style.outline='2px solid #4f8cff';el.style.outlineOffset='2px';const prevShadow=el.style.boxShadow;el.style.boxShadow='0 0 0 4px rgba(255,255,255,.9)';setTimeout(()=>{if(!el.hasAttribute(FLASH_ATTR))return;el.removeAttribute(FLASH_ATTR);el.style.outline=prev;el.style.outlineOffset=prevOffset;el.style.boxShadow=prevShadow},900)}catch{}};
const showLabel=(el,label)=>{try{
  const prev=el.style.outline,prevOffset=el.style.outlineOffset;el.setAttribute(FLASH_ATTR,'show');el.style.outline='3px solid #ff9f1c';el.style.outlineOffset='3px';
  const tag=document.createElement('div');tag.setAttribute('data-voicechat-inspector','show-label');tag.textContent=String(label).slice(0,120);
  Object.assign(tag.style,{position:'fixed',zIndex:'2147483647',pointerEvents:'none',padding:'3px 8px',borderRadius:'6px',background:'#ff9f1c',color:'#1b1b1b',font:'12px/1.4 system-ui,sans-serif',maxWidth:'60vw',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'});
  const r=el.getBoundingClientRect();tag.style.left=Math.max(4,r.left)+'px';tag.style.top=(r.top>=28?r.top-26:Math.min(innerHeight-24,r.bottom+4))+'px';
  document.documentElement.appendChild(tag);
  setTimeout(()=>{tag.remove();if(el.getAttribute(FLASH_ATTR)!=='show')return;el.removeAttribute(FLASH_ATTR);el.style.outline=prev;el.style.outlineOffset=prevOffset},3000)
}catch{}};
// Снимок видимых текстов: по нему считается, что появилось и исчезло — так человек замечает изменения.
let textSnapshot=null,scopedSnapshots=null;
const visibleTexts=()=>{const set=new Set();let count=0;for(const el of document.querySelectorAll('body *')){if(count>6000)break;count++;if(el.children.length>0&&!el.matches(CLICKABLE))continue;if(!readingVisible(el))continue;const t=textOf(el).slice(0,120);if(t)set.add(t)}return set};
const diffTexts=(before,after)=>{const added=[],removed=[];for(const t of after)if(!before.has(t))added.push(t);for(const t of before)if(!after.has(t))removed.push(t);return {added:added.slice(0,8),removed:removed.slice(0,8),addedTotal:added.length,removedTotal:removed.length}};
const openDialogs=()=>[...document.querySelectorAll('dialog[open],[role=dialog],[role=alertdialog],[aria-modal="true"]')].filter(el=>readingVisible(el)&&!el.closest('[data-voicechat-inspector]')).slice(0,5).map(uniqueSelector);
const describe=(el)=>{
  const d={selector:uniqueSelector(el),tag:el.localName,text:accessibleName(el),onScreen:onScreen(el)};
  const context=contextOf(el);if(context)d.context=context;
  if(el.matches('input:not([type=hidden]),textarea,select')){const placeholder=el.getAttribute('placeholder');if(placeholder)d.placeholder=placeholder.slice(0,EL_TEXT);if(!sensitive(el)){const value=el.localName==='select'?(el.selectedOptions[0]?textOf(el.selectedOptions[0]):''):String(el.value||'');if(value)d.value=value.slice(0,EL_TEXT)}}
  const href=el.localName==='a'&&el.getAttribute('href');if(href)d.href=unproxy(href);
  const role=el.getAttribute('role')||(el.localName==='input'?(el.type||'text'):'');if(role)d.role=role;
  Object.assign(d,controlState(el));
  return d
};
const bySelector=(selector)=>{let list;try{list=document.querySelectorAll(selector)}catch{throw new Error('Некорректный CSS-селектор: '+selector)}return [...list].filter(el=>!el.closest('[data-voicechat-inspector]'))};
const byText=(text,hidden=false,exactOnly=false)=>{
  const q=normText(text);
  if(!q)return[];
  const all=[];
  for(const el of document.querySelectorAll('body *')){
    if(el.closest('[data-voicechat-inspector]')||el.id==='${PREVIEW_INSPECTOR_SCRIPT_ID}'||!hidden&&!actionVisible(el))continue;
    const t=accessibleName(el)||textOf(el);
    if(!t||t.length>300)continue;
    const n=normText(t);
    if(exactOnly?n!==q:!n.includes(q))continue;
    all.push(el)
  }
  const deepest=all.filter(el=>!all.some(other=>other!==el&&el.contains(other)));
  const exact=(el)=>normText(textOf(el))===q?0:1;
  const clickable=(el)=>el.matches(CLICKABLE)||el.closest(CLICKABLE)?0:1;
  return deepest.sort((a,b)=>(exact(a)-exact(b))||(clickable(a)-clickable(b)))
};
// role сужает совпадения так, как их называет пользователь («кнопка Войти»); без text/selector — все элементы роли.
// Человек говорит «кнопка», «ссылка», «поле» — принимаем и русские слова, и ARIA-роли.
const ROLE_WORDS={'кнопка':'button','кнопки':'button','ссылка':'link','ссылки':'link','поле':'textbox','поля':'textbox','ввод':'textbox','заголовок':'heading','заголовки':'heading','флажок':'checkbox','галочка':'checkbox','переключатель':'radio','список':'combobox','вкладка':'tab','меню':'menuitem','картинка':'img','изображение':'img','таблица':'table','строка':'row'};
const byRole=(action)=>{
  const role=ROLE_WORDS[String(action.role||'').toLowerCase()]||String(action.role||'').toLowerCase();
  const base=action.selector?bySelector(action.selector):action.text?byText(action.text):[...document.querySelectorAll('body *')].filter(el=>!el.closest('[data-voicechat-inspector]'));
  return base.map(el=>action.text&&!action.selector?clickTarget(el):el).filter((el,i,all)=>all.indexOf(el)===i&&accessibleRole(el)===role).filter(el=>action.level===undefined||(/^h[1-6]$/.test(el.localName)?Number(el.localName[1]):Number(el.getAttribute('aria-level')||0))===action.level)
};
// near — как человек различает одинаковые кнопки: по тексту строки, карточки или секции, где стоит цель.
const CONTEXT_CONTAINERS='tr,li,article,section,fieldset,form,dialog,nav,header,footer,aside,[role=row],[role=listitem],[role=group],[role=dialog],[role=region],[role=tabpanel]';
const nearFilter=(candidates,near)=>{
  const q=normText(near);
  if(!q)return candidates;
  const scored=candidates.map(el=>{let node=el.parentElement,depth=0;while(node&&node!==document.body&&depth<10){const t=textOf(node);if(t.length<=4000&&normText(t).includes(q))return {el,size:t.length};node=node.parentElement;depth++}return null}).filter(Boolean);
  if(!scored.length)return[];
  const best=Math.min(...scored.map(item=>item.size));
  return scored.filter(item=>item.size===best).map(item=>item.el)
};
// below/above/leftOf/rightOf — как человек показывает место: «под ценой», «справа от подписи»; ближайшее с той стороны — первым.
const SIDES=['below','above','leftOf','rightOf'];
const spatialSide=(action)=>SIDES.find(side=>typeof action[side]==='string'&&action[side].trim());
const spatialFilter=(candidates,action)=>{
  const side=spatialSide(action);
  if(!side)return candidates;
  const anchor=byText(action[side],true).filter(readingVisible)[0];
  if(!anchor)throw new Error('Ориентир не найден: '+action[side]);
  const a=anchor.getBoundingClientRect(),ax=a.left+a.width/2,ay=a.top+a.height/2;
  return candidates.filter(el=>el!==anchor&&!anchor.contains(el)&&!el.contains(anchor)).map(el=>{
    const r=el.getBoundingClientRect();
    const ok=side==='below'?r.top>=a.bottom-2:side==='above'?r.bottom<=a.top+2:side==='leftOf'?r.right<=a.left+2:r.left>=a.right-2;
    if(!ok)return null;
    // Пересечение по другой оси — «прямо под», а не «где-то ниже»: такие ближе для человека.
    const overlap=side==='below'||side==='above'?Math.min(r.right,a.right)-Math.max(r.left,a.left):Math.min(r.bottom,a.bottom)-Math.max(r.top,a.top);
    return {el,dist:Math.hypot(r.left+r.width/2-ax,r.top+r.height/2-ay)+(overlap>0?0:400)}
  }).filter(Boolean).sort((x,y)=>x.dist-y.dist).map(item=>item.el)
};
// Подробности элемента по запросу: атрибуты, размер и путь по ориентирам — когда описания мало.
const detailsOf=(el)=>{
  const r=el.getBoundingClientRect(),attributes={};
  for(const attr of el.attributes){if(Object.keys(attributes).length>=12)break;if(/^(type|name|href|src|alt|title|placeholder|value|for|action|method|target|rel|aria-[\\w-]+|data-[\\w-]+)$/.test(attr.name)&&!/^data-voicechat/.test(attr.name))attributes[attr.name]=String(attr.value).slice(0,120)}
  const crumbs=[];let node=el.parentElement;
  while(node&&node!==document.body&&crumbs.length<4){
    const role=(node.getAttribute('role')||'').toLowerCase();
    if(/^(main|navigation|banner|contentinfo|complementary|form|dialog|region|table|list|article|section|tabpanel)$/.test(role)||/^(main|nav|header|footer|aside|form|dialog|table|ul|ol|article|section|fieldset)$/.test(node.localName)){
      const heading=node.querySelector('legend,caption,h1,h2,h3');
      const name=(node.getAttribute('aria-label')||(heading?textOf(heading):'')).slice(0,40);
      crumbs.unshift((role||node.localName)+(name?' «'+name+'»':''))
    }
    node=node.parentElement
  }
  return {...(el.id?{id:el.id}:{}),classes:[...el.classList].slice(0,5),attributes,box:{x:Math.round(r.left),y:Math.round(r.top),width:Math.round(r.width),height:Math.round(r.height)},path:crumbs.join(' › ')}
};
// Что лежит поверх страницы — баннер cookie, окно, липкая панель: человек убирает это первым делом.
const OVERLAY_SEL='dialog[open],[role=dialog],[role=alertdialog],[aria-modal="true"]';
const overlayKind=(el)=>/cookie|куки|файлы cookie|согласие на обработку|персональных данных/i.test(textOf(el).slice(0,600))?'cookies':el.matches(OVERLAY_SEL)?'dialog':'sticky';
const findOverlays=(what)=>{
  const list=[];let count=0;const area=(innerWidth||1)*(innerHeight||1);
  for(const el of document.querySelectorAll('body *')){
    if(count++>4000||list.length>=5)break;
    if(el.closest('[data-voicechat-inspector]')||!readingVisible(el))continue;
    const isDialog=el.matches(OVERLAY_SEL);
    if(!isDialog){const pos=getComputedStyle(el).position;if(pos!=='fixed'&&pos!=='sticky')continue}
    if(list.some(o=>o.contains(el)))continue;
    const kind=overlayKind(el);
    if(what==='cookies'&&kind!=='cookies'||what==='dialog'&&kind!=='dialog'||what==='any'&&kind==='sticky')continue;
    if(kind==='sticky'){const r=el.getBoundingClientRect();if(r.width*r.height/area<0.06)continue}
    list.push(el)
  }
  return list
};
const REJECT_WORDS=/(?<![\\p{L}])(отклонить|отказаться|только необходимые|только обязательные|не принимать|запретить|reject|decline|necessary only|only necessary|essential only|refuse)(?![\\p{L}])/iu;
const CLOSE_WORDS=/^(закрыть|понятно|ок|ok|хорошо|got it|close|dismiss|later|позже|не сейчас|×|✕|✖|x)$/iu;
const ACCEPT_WORDS=/(?<![\\p{L}])(принять|принимаю|согласен|согласиться|accept|agree|allow all|разрешить все)(?![\\p{L}])/iu;

// Поле поиска самого сайта: человек первым делом ищет лупу и строку «Поиск».
const SEARCH_FIELD='input[type=search],input[name*=search i],input[name=q],input[id*=search i],input[placeholder*=поиск i],input[placeholder*=search i],input[aria-label*=поиск i],input[aria-label*=search i],[role=searchbox]';
const searchField=(scope)=>{
  const root=scope||document;
  const forms=[...root.querySelectorAll('form[role=search],[role=search] form,form[action*=search i],form[id*=search i],form[class*=search i]')].filter(readingVisible);
  for(const form of forms){const field=[...form.querySelectorAll('input:not([type=hidden]),textarea')].find(el=>actionVisible(el)&&el.type!=='checkbox'&&el.type!=='radio');if(field)return field}
  return [...root.querySelectorAll(SEARCH_FIELD)].filter(actionVisible)[0]||null
};
// Хлебные крошки: где страница лежит в сайте — человек читает их первой строкой.
const breadcrumbsOf=()=>{
  const nav=[...document.querySelectorAll('nav[aria-label*=хлеб i],nav[aria-label*=bread i],[class*=breadcrumb i],[id*=breadcrumb i],ol[itemtype*=BreadcrumbList]')].filter(readingVisible)[0];
  if(!nav)return [];
  const items=[...nav.querySelectorAll('li,a,span')].filter(el=>readingVisible(el)&&!el.querySelector('li,a'));
  const out=[];
  for(const el of items){
    const text=textOf(el).replace(/^[\\s>\\/·|—-]+|[\\s>\\/·|—-]+$/g,'').slice(0,EL_TEXT);
    if(!text||out.some(item=>item.text===text))continue;
    const link=el.localName==='a'?el:el.querySelector('a');
    out.push({text,...(link&&link.getAttribute('href')?{href:unproxy(link.getAttribute('href'))}:{})});
    if(out.length>=10)break
  }
  return out
};
// Листалка: rel=next/prev и подписи, которыми её называет человек.
const NEXT_WORDS=/^(дальше|далее|следующая|следующие|вперёд|вперед|next|older|more|ещё|еще)(?![\\p{L}])/iu;
const PREV_WORDS=/^(назад|предыдущая|предыдущие|раньше|previous|prev|newer|back)(?![\\p{L}])/iu;
const paginationOf=()=>{
  const out={};
  const rel=(value)=>[...document.querySelectorAll('a[rel~="'+value+'"]')].filter(readingVisible)[0];
  let next=rel('next'),prev=rel('prev');
  if(!next||!prev)for(const a of document.querySelectorAll('a[href],button')){
    if(!readingVisible(a))continue;
    const label=normText(accessibleName(a)||textOf(a));
    if(!label||label.length>30)continue;
    if(!next&&NEXT_WORDS.test(label))next=a;
    if(!prev&&PREV_WORDS.test(label))prev=a
  }
  if(next)out.next=next.localName==='a'&&next.getAttribute('href')?unproxy(next.getAttribute('href')):uniqueSelector(next);
  if(prev)out.prev=prev.localName==='a'&&prev.getAttribute('href')?unproxy(prev.getAttribute('href')):uniqueSelector(prev);
  const current=[...document.querySelectorAll('[aria-current=page],[class*=pagination i] [class*=active i],[class*=pager i] [aria-current]')].filter(readingVisible)[0];
  if(current){const label=textOf(current).slice(0,40);if(label)out.label=label}
  return out.next||out.prev||out.label?out:null
};
// Дата и автор материала: то, по чему человек понимает, свежая ли страница.
const publishedOf=()=>{
  const meta=(name)=>{const el=document.querySelector('meta[property="'+name+'"],meta[name="'+name+'"]');return el?String(el.getAttribute('content')||'').slice(0,80):''};
  const timeEl=[...document.querySelectorAll('time[datetime],time')].filter(readingVisible)[0];
  const date=meta('article:published_time')||meta('datePublished')||(timeEl?(timeEl.getAttribute('datetime')||textOf(timeEl)).slice(0,80):'');
  const authorEl=[...document.querySelectorAll('[rel=author],[itemprop=author],[class*=author i]')].filter(readingVisible)[0];
  const author=meta('article:author')||meta('author')||(authorEl?textOf(authorEl).slice(0,80):'');
  return date||author?{...(date?{date}:{}),...(author?{author}:{})}:null
};
// Основное содержимое: article/main, иначе самый «текстовый» блок — как режим чтения у браузера.
const mainScope=()=>{
  const explicit=[...document.querySelectorAll('main,[role=main],article')].filter(readingVisible)[0];
  if(explicit)return explicit;
  let best=null,bestScore=0,count=0;
  for(const el of document.querySelectorAll('div,section')){
    if(count++>2000)break;
    if(!readingVisible(el)||el.closest('nav,header,footer,aside'))continue;
    const text=textOf(el);
    if(text.length<200)continue;
    const links=el.querySelectorAll('a').length;
    const score=text.length/(1+links*40);
    if(score>bestScore){bestScore=score;best=el}
  }
  return best||document.body||document.documentElement
};

// Где остановилось чтение этой страницы: read {next: true} продолжает с этого места, как человек — с закладки.
let readCursor={url:'',end:0};
// Однотипные карточки списка: человек оценивает выдачу по числу элементов и первым из них.
const listsOf=(scope)=>{
  const groups=new Map();
  const candidates=[...scope.querySelectorAll('ul,ol,[role=list],[class*=list i],[class*=grid i],[class*=results i]')].filter(readingVisible);
  for(const group of candidates){
    const items=[...group.children].filter(readingVisible);
    if(items.length<3)continue;
    const shape=items[0].localName+'|'+items.length;
    if(groups.has(shape))continue;
    const texts=items.slice(0,5).map(el=>(accessibleName(el)||textOf(el)).slice(0,80)).filter(Boolean);
    if(texts.length<3)continue;
    groups.set(shape,{selector:uniqueSelector(group),count:items.length,items:texts});
    if(groups.size>=5)break
  }
  return [...groups.values()]
};
// Живые узлы раздела: от заголовка до следующего заголовка того же или старшего уровня.
// sectionScope отдаёт клон для чтения, а find {in} должен спрашивать про настоящие элементы страницы.
const sectionRange=(title)=>{
  const q=normText(title);
  const headings=[...document.querySelectorAll('h1,h2,h3,h4,h5,h6')].filter(readingVisible);
  const heading=headings.find(h=>normText(readableText(h,EL_TEXT))===q)||headings.find(h=>normText(readableText(h,EL_TEXT)).includes(q));
  if(!heading)throw new Error('Раздел не найден: '+title);
  const level=Number(heading.localName[1]),nodes=[heading];
  let node=heading.nextElementSibling,count=0;
  while(node&&count<500){if(/^h[1-6]$/.test(node.localName)&&Number(node.localName[1])<=level)break;nodes.push(node);node=node.nextElementSibling;count++}
  // Заголовок один в своей обёртке (карточка): разделом считаем родителя.
  if(nodes.length===1&&heading.parentElement&&heading.parentElement!==document.body)nodes.push(heading.parentElement);
  return nodes
};
// Оглавление: заголовки с уровнями и селекторами — человек смотрит содержание и прыгает в нужную главу.
const tocOf=(scope)=>[...scope.querySelectorAll('h1,h2,h3,h4')].filter(readingVisible).slice(0,60).map(h=>({level:Number(h.localName[1]),text:readableText(h,EL_TEXT),selector:uniqueSelector(h)})).filter(item=>item.text);
// Одна таблица по подписи, заголовку колонки или селектору — и её строки постранично.
const tableByName=(name)=>{
  const tables=[...document.querySelectorAll('table')].filter(readingVisible);
  if(!tables.length)throw new Error('На странице нет таблиц');
  if(/^[.#\[]|[>:]/.test(name)){const found=bySelector(name)[0];if(!found)throw new Error('Таблица не найдена: '+name);return found.localName==='table'?found:found.closest('table')||found}
  const needle=normText(name);
  const match=tables.find(table=>{const caption=table.querySelector('caption');const label=normText((caption?textOf(caption):'')+' '+(table.getAttribute('aria-label')||''));const heads=[...table.querySelectorAll('th')].map(th=>normText(textOf(th))).join(' ');const near=contextOf(table);return label.includes(needle)||heads.includes(needle)||normText(near).includes(needle)});
  if(!match)throw new Error('Таблица «'+name+'» не найдена: на странице '+tables.length+' таблиц');
  return match
};
const suggestTexts=(query)=>{
  const words=normText(query).split(' ').filter(w=>w.length>=3);
  if(!words.length)return [];
  const seen=new Set(),out=[];
  for(const el of document.querySelectorAll(CLICKABLE+',h1,h2,h3,label,td,th,li')){
    if(!readingVisible(el))continue;
    const t=(accessibleName(el)||textOf(el)).slice(0,80);const n=normText(t);
    if(!t||t.length>80||seen.has(n))continue;
    const score=words.filter(w=>n.includes(w)||w.length>=5&&n.includes(w.slice(0,Math.max(4,w.length-2)))).length;
    if(score>0){seen.add(n);out.push({t,score})}
    if(out.length>=40)break
  }
  return out.sort((a,b)=>b.score-a.score).slice(0,5).map(item=>item.t)
};
const findTargets=(action)=>{
  const base=action.role?byRole(action):action.selector?bySelector(action.selector):byText(action.text||'',false,action.exact===true);
  // in — «в разделе Доставка»: человек смотрит только нужную главу, а не всю страницу.
  const within=action.in?sectionRange(action.in):null;
  const limited=within?base.filter(el=>within.some(node=>node===el||node.contains(el))):base;
  const scoped=spatialFilter(action.near?nearFilter(limited,action.near):limited,action);
  const visible=scoped.filter(action.kind==='find'?readingVisible:actionVisible);
  // nth — «второй такой»: человек считает одинаковые элементы сверху вниз.
  if(typeof action.nth==='number'&&action.nth>=1){const picked=(action.kind==='find'?visible:[...new Set(visible.map(clickTarget))])[action.nth-1];if(!picked)throw new Error('Совпадение №'+action.nth+' не найдено: всего '+visible.length);return [picked]}
  return visible
};
const contextOf=(el)=>{
  const container=el.parentElement&&el.parentElement.closest(CONTEXT_CONTAINERS);
  if(!container||container===document.body)return '';
  const own=textOf(el).toLowerCase(),text=(accessibleName(container)||readableText(container,120)).replace(/\\s+/g,' ').trim();
  return text&&text.toLowerCase()!==own?text.slice(0,120):''
};
const clickTarget=(el)=>{const host=el.matches(CLICKABLE)?el:(el.closest(CLICKABLE)||el);return host};
const setNativeValue=(el,value)=>{
  const proto=el.localName==='textarea'?HTMLTextAreaElement.prototype:HTMLInputElement.prototype;
  const desc=Object.getOwnPropertyDescriptor(proto,'value');
  if(desc&&desc.set)desc.set.call(el,value);else el.value=value
};
// Подсказки автодополнения, показавшиеся после ввода: то, из чего человек выбирает дальше.
const suggestionsFor=(el)=>{
  const items=[];
  const listId=el.getAttribute('list');if(listId){const list=document.getElementById(listId);if(list)for(const option of list.querySelectorAll('option'))items.push(option.label||option.value)}
  const owns=(el.getAttribute('aria-controls')||el.getAttribute('aria-owns')||'').split(/\s+/).filter(Boolean).map(id=>document.getElementById(id)).filter(Boolean);
  const boxes=owns.length?owns:[...document.querySelectorAll('[role=listbox],[role=menu]')].filter(readingVisible);
  for(const box of boxes)for(const option of box.querySelectorAll('[role=option],[role=menuitem],li'))if(readingVisible(option)){const t=textOf(option);if(t)items.push(t.slice(0,EL_TEXT))}
  return [...new Set(items)].slice(0,10)
};
// Сообщения валидации, которые пользователь увидел бы после отправки.
const validationMessages=(scope)=>{
  const out=[];
  for(const el of scope.querySelectorAll('input,textarea,select')){
    if(out.length>=10)break;
    const invalid=(typeof el.checkValidity==='function'&&!el.checkValidity())||el.getAttribute('aria-invalid')==='true';
    if(!invalid)continue;
    const described=(el.getAttribute('aria-describedby')||el.getAttribute('aria-errormessage')||'').split(/\s+/).filter(Boolean).map(id=>document.getElementById(id)).filter(Boolean).map(node=>readableText(node,EL_TEXT,true)).filter(Boolean).join(' ');
    out.push({field:accessibleName(el)||el.name||uniqueSelector(el),message:(el.validationMessage||described||'Поле заполнено неверно').slice(0,EL_TEXT)})
  }
  for(const alert of scope.querySelectorAll('[role=alert]'))if(out.length<10&&readingVisible(alert)){const t=readableText(alert,EL_TEXT);if(t)out.push({field:'',message:t})}
  return out
};
const typeInto=(el,text,append,submit)=>{
    const editable=el.isContentEditable;
    if(!editable&&el.localName!=='input'&&el.localName!=='textarea'&&el.localName!=='select')throw new Error('Элемент не является полем ввода: '+(uniqueSelector(el)));
    // append дописывает к тому, что уже введено, — как пользователь, продолжающий печатать.
    const current=editable?(el.textContent||''):el.localName==='select'?'':String(el.value||'');
    const nextText=append&&el.localName!=='select'?current+text:text;
    validateInput(el,nextText);
    const option=el.localName==='select'?selectOption(el,text):null;
    el.focus&&el.focus();
    if(!el.dispatchEvent(inputEvent('beforeinput',text,true)))throw new Error('Страница отклонила ввод');
    if(editable){el.textContent=nextText}
    else if(option){el.value=option.value}
    else setNativeValue(el,nextText);
    el.dispatchEvent(inputEvent('input',text));
    el.dispatchEvent(new Event('change',{bubbles:true}));
    let submitted=false;
    if(submit){
      const form=el.form||el.closest('form');
      if(form){form.requestSubmit?form.requestSubmit():form.submit();submitted=true}
      else{el.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true}));el.dispatchEvent(new KeyboardEvent('keyup',{key:'Enter',bubbles:true}))}
    }
    const value=sensitive(el)?'':editable?String(el.textContent||'').slice(0,EL_TEXT):String(el.value||'').slice(0,EL_TEXT);
    return {page:pageInfo(),typed:describe(el),submitted,value}
};
// Посимвольный ввод: keydown/keypress/input/keyup на каждую букву — как печатает человек; маски и автодополнение это слышат.
const typePerKey=(el,text,append,submit)=>{
  if(!keyboardEditable(el)&&!el.isContentEditable)return typeInto(el,text,append,submit);
  el.focus&&el.focus();
  if(!append){if(el.isContentEditable)el.textContent='';else{setNativeValue(el,'');el.dispatchEvent(inputEvent('input',''))}}
  for(const ch of Array.from(text))performKey(el,ch==='\\n'?'Enter':ch===' '?'Space':ch);
  el.dispatchEvent(new Event('change',{bubbles:true}));
  let submitted=false;
  if(submit){const form=el.form||el.closest('form');if(form){form.requestSubmit?form.requestSubmit():form.submit();submitted=true}else performKey(el,'Enter')}
  const value=sensitive(el)?'':el.isContentEditable?String(el.textContent||'').slice(0,EL_TEXT):String(el.value||'').slice(0,EL_TEXT);
  return {page:pageInfo(),typed:describe(el),submitted,value}
};
// Раздел под заголовком: от заголовка до следующего того же или более высокого уровня — так человек читает «Цены».
const sectionScope=(title)=>{
  const q=normText(title);
  const heading=[...document.querySelectorAll('h1,h2,h3,h4,h5,h6')].filter(readingVisible).find(h=>normText(readableText(h,EL_TEXT))===q)||[...document.querySelectorAll('h1,h2,h3,h4,h5,h6')].filter(readingVisible).find(h=>normText(readableText(h,EL_TEXT)).includes(q));
  if(!heading)throw new Error('Раздел не найден: '+title);
  const level=Number(heading.localName[1]);
  const wrapper=document.createElement('section');wrapper.setAttribute('data-voicechat-section','');
  const parent=heading.parentElement;
  let node=heading.nextElementSibling,count=0;
  while(node&&count<500){if(/^h[1-6]$/.test(node.localName)&&Number(node.localName[1])<=level)break;wrapper.appendChild(node.cloneNode(true));node=node.nextElementSibling;count++}
  // Заголовок — единственный ребёнок родителя-обёртки (карточка): читаем родителя целиком.
  if(!wrapper.childElementCount&&parent&&parent!==document.body)return {scope:parent,title:readableText(heading,EL_TEXT)};
  wrapper.prepend(heading.cloneNode(true));
  return {scope:wrapper,title:readableText(heading,EL_TEXT),detached:true}
};
// Цель по тексту может прорисоваться чуть позже клика по предыдущей кнопке: ждём до 1,5 с, как ждёт человек.
const AUTO_WAIT_MS=1500;
const withAutoWait=(resolve,retryable)=>{
  try{return {el:resolve(),waitedMs:0}}catch(first){
    if(!retryable||!/не найден|не появился|не найдено/i.test(String(first&&first.message||first)))throw first;
    const started=performance.now();
    return new Promise((ok,fail)=>{const attempt=()=>{try{ok({el:resolve(),waitedMs:Math.round(performance.now()-started)})}catch(err){if(performance.now()-started>=AUTO_WAIT_MS){fail(first);return}setTimeout(attempt,150)}};setTimeout(attempt,150)})
  }
};
// Опасные действия — оплата, удаление, отправка денег, скачивание — панель останавливает: человек бы переспросил.
// \\b знает только латиницу: для русских слов границы задаём Unicode-классами.
const DANGER=/(?<![\\p{L}\\p{N}])(оплатить|оплата|купить|заплатить|перевести|перевод|подтвердить (?:оплату|покупку|заказ|перевод)|удалить|удаление|стереть|очистить (?:всё|все)|отписаться|закрыть аккаунт|удалить аккаунт|pay|purchase|buy now|checkout|place order|confirm (?:payment|purchase|order)|delete|remove|erase|unsubscribe|cancel subscription|transfer|send money|withdraw)(?![\\p{L}\\p{N}])/iu;
const dangerReason=(el)=>{
  const text=normText(accessibleName(el)||textOf(el));
  if(el.localName==='a'&&(el.hasAttribute('download')||/\\.(pdf|zip|rar|7z|exe|dmg|pkg|msi|apk|csv|xlsx?|docx?)(\\?|#|$)/i.test(el.getAttribute('href')||'')))return 'скачивание файла';
  if(DANGER.test(text))return /оплат|купить|заплат|перевод|перевест|pay|purchase|buy|checkout|order|transfer|money|withdraw/i.test(text)?'оплата или перевод':/удал|стереть|очистить|delete|remove|erase/i.test(text)?'удаление':'необратимое действие';
  return null
};
const runClick=(action,el)=>{
    actionable(el);
    if(!action.confirm){const reason=dangerReason(el);if(reason)return {page:pageInfo(),needsConfirmation:true,reason,target:describe(el)}}
    if(el.localName==='select')throw new Error('Это выпадающий список: выбери значение через set {selector, value} или choose, клик его не раскроет.');
    el.scrollIntoView&&el.scrollIntoView({block:'center'});
    const dialogsBefore=new Set(openDialogs()),errorsBefore=pageErrors.length,textsBefore=visibleTexts();
    flash(el);
    const info=describe(el),mods=Array.isArray(action.modifiers)?action.modifiers:[];
    const r=el.getBoundingClientRect(),right=action.button==='right';
    const base={bubbles:true,cancelable:true,composed:true,clientX:r.left+r.width/2,clientY:r.top+r.height/2,shiftKey:mods.includes('shift'),ctrlKey:mods.includes('ctrl'),altKey:mods.includes('alt'),metaKey:mods.includes('meta'),button:right?2:0};
    const count=action.dblclick&&!right?2:1;
    for(let index=1;index<=count;index++){
      const down=el.dispatchEvent(new (window.PointerEvent||MouseEvent)('pointerdown',Object.assign({pointerId:1,isPrimary:true,buttons:right?2:1,detail:index},base)));
      const mouse=down&&el.dispatchEvent(new MouseEvent('mousedown',Object.assign({buttons:right?2:1,detail:index},base)));
      if(mouse)el.focus&&el.focus({preventScroll:true});
      el.dispatchEvent(new (window.PointerEvent||MouseEvent)('pointerup',Object.assign({pointerId:1,isPrimary:true,buttons:0,detail:index},base)));
      if(down)el.dispatchEvent(new MouseEvent('mouseup',Object.assign({buttons:0,detail:index},base)));
      el.dispatchEvent(new MouseEvent(right?'contextmenu':'click',Object.assign({buttons:0,detail:index},base)))
    }
    if(count===2)el.dispatchEvent(new MouseEvent('dblclick',Object.assign({buttons:0,detail:2},base)));
    const dialogs=openDialogs().filter(sel=>!dialogsBefore.has(sel));
    // Что лежит в точке клика: оверлей поверх кнопки означает, что человек бы в неё не попал.
    let obscuredBy=null;try{const hit=document.elementFromPoint?document.elementFromPoint(base.clientX,base.clientY):null;if(hit&&hit!==el&&!el.contains(hit)&&!hit.contains(el)&&!hit.closest('[data-voicechat-inspector]'))obscuredBy=uniqueSelector(hit)}catch{}
    const active=document.activeElement&&document.activeElement!==document.body&&document.activeElement!==el?uniqueSelector(document.activeElement):null;
    const newErrors=pageErrors.slice(errorsBefore).slice(0,3).map((e)=>({kind:e.kind,message:e.message,at:e.at}));
    const textsAfter=visibleTexts();textSnapshot=textsAfter;const changes=diffTexts(textsBefore,textsAfter);
    return {page:pageInfo(),clicked:info,...(dialogs.length?{dialogs}:{}),...(active?{focus:active}:{}),...(newErrors.length?{newErrors}:{}),...(obscuredBy?{obscuredBy}:{}),...(changes.addedTotal||changes.removedTotal?{changes}:{})}
};
const run=(action)=>{
  if(action.kind==='audit')return runAudit(action);
  if(action.kind==='accessibility')throw new Error('Native accessibility requires Chromium mode.');
  if(action.kind==='probe')return runProbe(action);
  if(action.kind==='find'){
    const hrefNeedle=typeof action.href==='string'?action.href.toLowerCase():'';
    const base=action.href&&!action.text&&!action.selector&&!action.role?bySelector('a[href]'):findTargets(action);
    // Что на экране — сначала: человек видит ближайшее, а не первое в DOM.
    const found=base.filter(el=>!action.visibleOnly||(typeof el.checkVisibility==='function'?el.checkVisibility({visibilityProperty:true}):getComputedStyle(el).display!=='none'&&getComputedStyle(el).visibility!=='hidden')).filter(el=>!action.onScreen||onScreen(el))
      .filter(el=>!hrefNeedle||(el.localName==='a'&&unproxy(el.getAttribute('href')||'').toLowerCase().includes(hrefNeedle)))
      .filter(el=>action.enabled===undefined||(!el.matches(':disabled')&&!el.closest('[aria-disabled="true"],[inert]'))===action.enabled)
      .filter(el=>action.checked===undefined||(el.checked===true||el.getAttribute('aria-checked')==='true')===action.checked)
      .map((el,i)=>({el,i,on:onScreen(el)?0:1})).sort((a,b)=>a.on-b.on||a.i-b.i).map(item=>item.el);
    const limit=Math.max(1,Math.min(FIND_MAX,typeof action.limit==='number'?Math.floor(action.limit):10));
    // Ничего не нашлось — подсказать похожие тексты, как человек оглядывается вокруг искомого слова.
    const suggestions=!found.length&&action.text?suggestTexts(action.text):[];
    if(action.reveal&&found[0]){found[0].scrollIntoView&&found[0].scrollIntoView({block:'center',inline:'nearest'});showLabel(found[0],'Найдено')}
    return {page:pageInfo(),elements:found.slice(0,limit).map(el=>action.details?Object.assign(describe(el),{details:detailsOf(el)}):describe(el)),total:found.length,...(found.length>limit?{truncated:true}:{}),...(suggestions.length?{suggestions}:{})}
  }
  if(action.kind==='search'){
    // Поиск по самому сайту: найти его поле, ввести запрос и отправить — как человек.
    const scope=action.in?bySelector(action.in)[0]:null;
    if(action.in&&!scope)throw new Error('Область поиска не найдена: '+action.in);
    const field=searchField(scope);
    if(!field)throw new Error('На странице нет поля поиска: попробуй найти ссылку «Поиск» и нажать её');
    actionable(field,true);
    const result=typeInto(field,action.text,false,true);
    const suggestions=suggestionsFor(field);
    return {page:pageInfo(),field:describe(field),query:action.text,submitted:result.submitted,...(suggestions.length?{suggestions}:{})}
  }
  if(action.kind==='focus'){
    const el=action.selector?chooseTarget({kind:'focus',selector:action.selector,near:action.near}):fieldTarget(action.field||'',action.near);
    actionable(el);
    el.scrollIntoView&&el.scrollIntoView({block:'center'});
    el.focus&&el.focus();
    if(document.activeElement!==el)throw new Error('Элемент не принимает фокус: '+uniqueSelector(el));
    return {page:pageInfo(),focused:describe(el)}
  }
  if(action.kind==='select'){
    // Выделение — «вот это место»: человек видит его глазами, без подсветки-подписи.
    const el=chooseTarget({kind:'select',...(action.selector?{selector:action.selector}:{}),...(action.text?{text:action.text}:{}),...(action.near?{near:action.near}:{})});
    el.scrollIntoView&&el.scrollIntoView({block:'center'});
    const range=document.createRange();range.selectNodeContents(el);
    // Помечаем выделение как сделанное ассистентом: панель подпишет его иначе, чем выделение человека.
    selectionByAssistant=true;
    const selection=getSelection();selection.removeAllRanges();selection.addRange(range);
    return {page:pageInfo(),selected:String(selection||'').replace(/\\s+/g,' ').trim().slice(0,2000),target:describe(el)}
  }
  if(action.kind==='click'&&action.peek){
    // «Куда ведёт?» — человек читает адрес в строке состояния, не нажимая.
    const el=chooseTarget(action,true),link=el.closest('a[href]')||el,raw=link.getAttribute?link.getAttribute('href'):null;
    if(!raw)return {page:pageInfo(),clicked:describe(el),peeked:true};
    const href=unproxy(raw);let external=false;try{external=new URL(href).host!==new URL(pageInfo().url).host}catch{}
    return {page:pageInfo(),clicked:describe(el),peeked:true,href,external,newTab:link.getAttribute('target')==='_blank'}
  }
  if(action.kind==='dismiss'){
    const what=action.what||'any',targets=findOverlays(what);
    if(!targets.length)return {page:pageInfo(),dismissed:false,remaining:0};
    const el=targets[0],kind=overlayKind(el);
    const buttons=[...el.querySelectorAll(CLICKABLE)].filter(b=>actionVisible(b)&&!b.matches('input:not([type=button]):not([type=submit]),select,textarea,label'));
    const label=(b)=>normText(accessibleName(b)||textOf(b));
    let button=null,how=null;
    // Порядок как у осторожного человека: отклонить cookie, иначе закрыть, и только потом принять.
    if(kind==='cookies'){button=buttons.find(b=>REJECT_WORDS.test(label(b)));if(button)how='rejected'}
    if(!button){button=buttons.find(b=>CLOSE_WORDS.test(label(b))||/close|закрыть|dismiss/i.test(b.getAttribute('aria-label')||'')||/\\bclose\\b|dismiss/i.test(String(b.className||'')));if(button)how='closed'}
    if(!button&&kind==='cookies'){button=buttons.find(b=>ACCEPT_WORDS.test(label(b)));if(button)how='accepted'}
    if(button)runClick({kind:'click',confirm:true},button);
    else{el.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));document.dispatchEvent(new KeyboardEvent('keyup',{key:'Escape',bubbles:true}));if(el.localName==='dialog'&&typeof el.close==='function')el.close();how='escape'}
    return new Promise(ok=>setTimeout(()=>{
      const stillThere=el.isConnected&&readingVisible(el),remaining=findOverlays(what).length;
      ok({page:pageInfo(),dismissed:!stillThere||remaining<targets.length,how,...(button?{target:describe(button)}:{}),remaining})
    },120))
  }
  if(action.kind==='click'){
    // Клик по точке: там, где у цели нет ни текста, ни селектора (карта, canvas), человек просто тыкает пальцем.
    const resolved=withAutoWait(()=>typeof action.x==='number'&&!action.selector&&!action.text?(()=>{const hit=document.elementFromPoint?document.elementFromPoint(action.x,action.y):null;if(!hit)throw new Error('В точке ('+action.x+', '+action.y+') нет элемента: она вне видимой области');return hit})():chooseTarget(action,true),Boolean(action.text||action.role));
    if(resolved&&typeof resolved.then==='function')return resolved.then(({el,waitedMs})=>Object.assign(runClick(action,el),waitedMs?{waitedMs}:{}));
    return runClick(action,resolved.el)
  }

  if(action.kind==='changes'){
    if(action.selector){
      // Область: сравнение внутри контейнера, снимок области хранится отдельно от общего.
      const scope=bySelector(action.selector)[0];if(!scope)throw new Error('Элемент не найден: '+action.selector);
      const texts=new Set();for(const el of scope.querySelectorAll('*')){if(el.children.length>0&&!el.matches(CLICKABLE))continue;if(!readingVisible(el))continue;const t=textOf(el).slice(0,120);if(t)texts.add(t)}
      scopedSnapshots=scopedSnapshots||new Map();const prev=scopedSnapshots.get(action.selector);scopedSnapshots.set(action.selector,texts);
      if(!prev)return {page:pageInfo(),changes:{added:[],removed:[],addedTotal:0,removedTotal:0},baseline:true};
      return {page:pageInfo(),changes:diffTexts(prev,texts)}
    }
    const now=visibleTexts();
    if(!textSnapshot){textSnapshot=now;return {page:pageInfo(),changes:{added:[],removed:[],addedTotal:0,removedTotal:0},baseline:true}}
    const changes=diffTexts(textSnapshot,now);textSnapshot=now;
    return {page:pageInfo(),changes}
  }
  if(action.kind==='show'){
    // «Вот эта кнопка»: прокрутить и подсветить с подписью на 3 с — модель указывает пользователю пальцем.
    const found=findTargets({kind:'click',...(action.selector?{selector:action.selector}:{}),...(action.text?{text:action.text}:{}),...(action.near?{near:action.near}:{})});
    if(!found.length)throw new Error('Элемент не найден: '+(action.selector||action.text));
    const targets=(action.all?found.slice(0,10):[found[0]]).map(node=>action.selector?node:clickTarget(node)).filter((node,i,all)=>all.indexOf(node)===i);
    const el=targets[0];
    el.scrollIntoView&&el.scrollIntoView({block:'center',inline:'nearest'});
    targets.forEach((node,i)=>showLabel(node,action.all?(action.label||'Ассистент показывает')+' '+(i+1):(action.label||'Ассистент показывает')));
    return {page:pageInfo(),shown:describe(el),...(action.all?{shownCount:targets.length}:{})}
  }
  if(action.kind==='check'){
    // Проверка ожидания: человек смотрит, есть ли на экране «Войти», и говорит «есть»/«нет» — без исключений.
    const state=action.state||(typeof action.count==='number'?'present':'visible');
    const raw=action.selector?bySelector(action.selector):byText(action.text||'',true);
    const scoped=action.near?nearFilter(raw,action.near):raw;
    const visible=scoped.filter(readingVisible);
    const first=visible[0]||scoped[0];
    const actualValue=first&&(first.value!==undefined?String(first.value):textOf(first));
    let pass;
    if(typeof action.count==='number')pass=scoped.length===action.count;
    else if(state==='present')pass=scoped.length>0;
    else if(state==='absent')pass=scoped.length===0;
    else if(state==='hidden')pass=visible.length===0;
    else pass=visible.length>0;
    if(pass&&action.value!==undefined)pass=normText(actualValue||'')===normText(action.value);
    if(pass&&action.contains!==undefined)pass=normText(actualValue||'').includes(normText(action.contains));
    const isEnabled=first&&!first.matches(':disabled')&&!first.closest('[aria-disabled="true"],[inert]'),isChecked=first&&(first.checked===true||first.getAttribute('aria-checked')==='true');
    if(pass&&action.enabled!==undefined)pass=Boolean(isEnabled)===action.enabled;
    if(pass&&action.checked!==undefined)pass=Boolean(isChecked)===action.checked;
    const what=action.text?'«'+action.text+'»':action.selector;
    const summary=typeof action.count==='number'?what+': '+scoped.length+' из '+action.count+(pass?' — совпало':' — не совпало')
      :action.value!==undefined?what+(pass?' содержит «'+action.value+'»':' содержит «'+String(actualValue||'').slice(0,60)+'», ожидалось «'+action.value+'»')
      :action.contains!==undefined?what+(pass?' содержит «'+action.contains+'»':' не содержит «'+action.contains+'»: сейчас «'+String(actualValue||'').slice(0,60)+'»')
      :action.enabled!==undefined?what+(pass?(action.enabled?' доступно':' отключено'):(action.enabled?' отключено, ожидалось доступное':' доступно, ожидалось отключённое'))
      :action.checked!==undefined?what+(pass?(action.checked?' отмечено':' не отмечено'):(action.checked?' не отмечено, ожидалось отмеченное':' отмечено, ожидалось снятое'))
      :what+(state==='absent'?(pass?' отсутствует':' присутствует, хотя не должно'):state==='hidden'?(pass?' скрыто':' видно, хотя должно быть скрыто'):state==='present'?(pass?' есть на странице':' нет на странице'):(pass?' видно':' не видно'));
    return {page:pageInfo(),pass,expected:{...(action.text?{text:action.text}:{}),...(action.selector?{selector:action.selector}:{}),state,...(action.value!==undefined?{value:action.value}:{}),...(action.contains!==undefined?{contains:action.contains}:{}),...(action.enabled!==undefined?{enabled:action.enabled}:{}),...(action.checked!==undefined?{checked:action.checked}:{}),...(typeof action.count==='number'?{count:action.count}:{})},actual:{count:scoped.length,visible:visible.length,...(actualValue!==undefined?{value:String(actualValue).slice(0,EL_TEXT)}:{}),...(first?{element:describe(first)}:{})},summary}
  }
  if(action.kind==='fill'){
    // Форма целиком, как её заполняет человек: поле за полем, затем отправка первой формы.
    const filled=[],missing=[];let form=null;
    for(const item of action.fields){
      // Не нашлось одно поле — остальные всё равно заполняем и перечисляем пропуски, как сделал бы человек.
      let el;try{el=item.selector?chooseTarget({kind:'type',selector:item.selector,near:item.near}):fieldTarget(item.field||'',item.near);actionable(el,true)}catch(err){missing.push({field:item.field||item.selector||'',error:String(err&&err.message||err).slice(0,200)});continue}
      flash(el);
      if(item.secret)el.setAttribute('data-voicechat-secret','');
      const outcome=action.perKey?typePerKey(el,item.value,false,false):typeInto(el,item.value,false,false);
      filled.push({field:item.field||accessibleName(el)||item.selector||'',selector:outcome.typed.selector,value:item.secret?'':outcome.value});
      if(!form)form=el.form||el.closest('form')
    }
    if(!filled.length)throw new Error('Ни одно поле не найдено: '+missing.map(m=>m.field+' ('+m.error+')').join('; '));
    let submitted=false;
    if(action.submit&&form){form.requestSubmit?form.requestSubmit():form.submit();submitted=true}
    const validation=validationMessages(form||document);
    return {page:pageInfo(),filled,...(missing.length?{missing}:{}),submitted,...(validation.length?{validation}:{})}
  }
  if(action.kind==='choose'){
    // Пункт меню: открыть триггер, дождаться пункта, нажать — три жеста человека одним действием.
    let opened;
    if(action.in){
      const trigger=chooseTarget({kind:'click',...( /^[.#\[]|[>:]/.test(action.in)?{selector:action.in}:{text:action.in})},true);
      // Нативный select не раскрывается кликом: выбираем option напрямую, как set.
      if(trigger.localName==='select'){actionable(trigger,true);const option=selectOption(trigger,action.text);trigger.value=option.value;trigger.dispatchEvent(new Event('input',{bubbles:true}));trigger.dispatchEvent(new Event('change',{bubbles:true}));flash(trigger);return {page:pageInfo(),chosen:describe(option),opened:describe(trigger)}}
      actionable(trigger);flash(trigger);opened=describe(trigger);
      const r=trigger.getBoundingClientRect(),base={bubbles:true,cancelable:true,composed:true,clientX:r.left+r.width/2,clientY:r.top+r.height/2,button:0};
      trigger.dispatchEvent(new (window.PointerEvent||MouseEvent)('pointerdown',Object.assign({pointerId:1,isPrimary:true,buttons:1},base)));
      trigger.dispatchEvent(new MouseEvent('mousedown',Object.assign({buttons:1},base)));trigger.focus&&trigger.focus({preventScroll:true});
      trigger.dispatchEvent(new (window.PointerEvent||MouseEvent)('pointerup',Object.assign({pointerId:1,isPrimary:true,buttons:0},base)));
      trigger.dispatchEvent(new MouseEvent('mouseup',Object.assign({buttons:0},base)));trigger.dispatchEvent(new MouseEvent('click',Object.assign({buttons:0},base)))
    }
    const started=performance.now();
    return new Promise((ok,fail)=>{
      const attempt=()=>{
        let found=[];
        try{found=findTargets({kind:'click',text:action.text,near:action.near}).map(clickTarget).filter(actionVisible)}catch(err){fail(err);return}
        const options=found.filter(el=>el.matches('[role=option],[role=menuitem],[role=menuitemradio],[role=menuitemcheckbox],[role=treeitem],li,option'));
        const pick=options.length?options:found;
        const exact=pick.filter(el=>textOf(el).toLowerCase()===String(action.text).trim().toLowerCase());
        const target=(exact.length?exact:pick)[0];
        if(target){
          flash(target);
          const r=target.getBoundingClientRect(),base={bubbles:true,cancelable:true,composed:true,clientX:r.left+r.width/2,clientY:r.top+r.height/2,button:0};
          target.dispatchEvent(new (window.PointerEvent||MouseEvent)('pointerdown',Object.assign({pointerId:1,isPrimary:true,buttons:1},base)));
          target.dispatchEvent(new MouseEvent('mousedown',Object.assign({buttons:1},base)));
          target.dispatchEvent(new (window.PointerEvent||MouseEvent)('pointerup',Object.assign({pointerId:1,isPrimary:true,buttons:0},base)));
          target.dispatchEvent(new MouseEvent('mouseup',Object.assign({buttons:0},base)));target.dispatchEvent(new MouseEvent('click',Object.assign({buttons:0},base)));
          ok({page:pageInfo(),chosen:describe(target),...(opened?{opened}:{})});return
        }
        if(performance.now()-started>=3000){const visibleOptions=[...document.querySelectorAll('[role=option],[role=menuitem],[role=menuitemradio],[role=menuitemcheckbox],li')].filter(actionVisible).map(el=>textOf(el).slice(0,60)).filter(Boolean).slice(0,10);fail(new Error('Пункт не появился: '+action.text+(action.in?' (после '+action.in+')':'')+(visibleOptions.length?'. Видны пункты: '+visibleOptions.join(' | '):'')));return}
        setTimeout(attempt,120)
      };
      attempt()
    })
  }
  if(action.kind==='type'){
    const finish=({el,waitedMs})=>{
      actionable(el,true);flash(el);
      const before=visibleTexts();
      if(action.secret)el.setAttribute('data-voicechat-secret','');
      const outcome=action.perKey?typePerKey(el,action.text,action.append===true,action.submit===true):typeInto(el,action.text,action.append===true,action.submit===true);
      if(action.secret)outcome.value='';
      if(action.blur&&el.blur){el.blur();el.dispatchEvent(new FocusEvent('blur',{bubbles:false}));el.dispatchEvent(new FocusEvent('focusout',{bubbles:true}))}
      const options=suggestionsFor(el);
      const validation=action.submit?validationMessages(el.form||el.closest('form')||document):[];
      const after=visibleTexts();textSnapshot=after;const changes=diffTexts(before,after);
      return {...outcome,...(options.length?{options}:{}),...(validation.length?{validation}:{}),...(changes.addedTotal||changes.removedTotal?{changes}:{}),...(waitedMs?{waitedMs}:{})}
    };
    const resolved=withAutoWait(()=>action.selector?chooseTarget(action):fieldTarget(action.field||'',action.near),Boolean(action.field));
    return resolved&&typeof resolved.then==='function'?resolved.then(finish):finish(resolved)
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
    const visibleBefore=new Set([...document.querySelectorAll(CLICKABLE)].filter(actionVisible));
    el.scrollIntoView&&el.scrollIntoView({block:'center'});
    const r=el.getBoundingClientRect();
    const opts={bubbles:true,cancelable:true,clientX:r.left+r.width/2,clientY:r.top+r.height/2};
    for(const type of ['pointerover','pointerenter','pointermove'])el.dispatchEvent(new (window.PointerEvent||MouseEvent)(type,opts));
    for(const type of ['mouseover','mouseenter','mousemove'])el.dispatchEvent(new MouseEvent(type,opts));
    flash(el);
    // Подсказка, которую увидел бы человек: title, описание по aria-describedby или всплывший tooltip.
    const described=(el.getAttribute('aria-describedby')||'').split(/\s+/).filter(Boolean).map(id=>document.getElementById(id)).filter(Boolean).map(node=>readableText(node,EL_TEXT,true)).filter(Boolean).join(' ');
    const shown=[...document.querySelectorAll('[role=tooltip]')].filter(readingVisible).map(node=>readableText(node,EL_TEXT)).filter(Boolean).join(' ');
    const tooltip=(el.getAttribute('title')||el.closest('[title]')?.getAttribute('title')||described||shown||'').slice(0,EL_TEXT);
    // Что раскрылось при наведении — пункты меню, которые человек нажмёт следующими; меню с анимацией ждём waitMs.
    const cursor=(()=>{try{return getComputedStyle(el).cursor||''}catch{return ''}})();
    const collect=()=>{const revealed=[...document.querySelectorAll(CLICKABLE)].filter(node=>node!==el&&!el.contains(node)&&!visibleBefore.has(node)&&actionVisible(node)).slice(0,10).map(describe);return {page:pageInfo(),hovered:describe(el),...(tooltip?{tooltip}:{}),...(cursor&&cursor!=='auto'?{cursor}:{}),...(revealed.length?{revealed}:{})}};
    if(typeof action.waitMs==='number'&&action.waitMs>0)return new Promise(ok=>setTimeout(()=>ok(collect()),Math.min(2000,action.waitMs)));
    return collect()
  }
  if(action.kind==='scroll'&&action.until){
    // Лента с ленивой подгрузкой: человек листает экран за экраном, пока не увидит нужное.
    const container=action.selector?(bySelector(action.selector)[0]||null):null;
    if(action.selector&&!container)throw new Error('Элемент не найден: '+action.selector);
    const el=container||document.scrollingElement||document.documentElement;
    const maxScreens=Math.max(1,Math.min(50,action.maxScreens??10));
    const step=()=>Math.max(1,Math.round((container?el.clientHeight:innerHeight)*0.9));
    return new Promise((ok,fail)=>{
      let screens=0,lastHeight=-1,idle=0;
      const attempt=()=>{
        const hit=byText(action.until).filter(readingVisible)[0];
        if(hit){hit.scrollIntoView&&hit.scrollIntoView({block:'center'});const maxTop=Math.max(0,el.scrollHeight-el.clientHeight);ok({page:pageInfo(),target:container?uniqueSelector(el):'window',scrolled:{top:el.scrollTop,left:el.scrollLeft,maxTop,maxLeft:Math.max(0,el.scrollWidth-el.clientWidth)},atTop:el.scrollTop<=0,atBottom:el.scrollTop>=maxTop-1,percent:maxTop>0?Math.round(Math.min(1,el.scrollTop/maxTop)*100):100,found:describe(hit),screens});return}
        if(screens>=maxScreens){fail(new Error('«'+action.until+'» не появилось за '+screens+' экранов прокрутки'));return}
        // Конец ленты без подгрузки: два круга без роста высоты — дальше ничего не будет.
        if(el.scrollHeight===lastHeight&&el.scrollTop>=el.scrollHeight-el.clientHeight-1){idle++;if(idle>=2){fail(new Error('Лента закончилась, «'+action.until+'» на ней нет'));return}}else idle=0;
        lastHeight=el.scrollHeight;
        el.scrollTop=el.scrollTop+step();screens++;
        el.dispatchEvent(new Event('scroll',{bubbles:true}));
        setTimeout(attempt,220)
      };
      attempt()
    })
  }
  if(action.kind==='scroll'){
    let el=document.scrollingElement||document.documentElement,target='window';
    if(action.selector){const found=bySelector(action.selector);if(!found.length)throw new Error('Элемент не найден: '+action.selector);el=found[0];target=uniqueSelector(el)}
    else if(action.text){const found=byText(action.text);if(!found.length)throw new Error('Текст не найден: '+action.text);el=found[0];target=uniqueSelector(el)}
    let shownEl=null;
    if(action.to==='element'){shownEl=el;el.scrollIntoView&&el.scrollIntoView({block:'center',inline:'nearest'});el=document.scrollingElement||document.documentElement}
    else if(action.to==='top')el.scrollTop=0;
    else if(action.to==='bottom')el.scrollTop=el.scrollHeight;
    else if(typeof action.percent==='number'){el.scrollTop=Math.round(Math.max(0,el.scrollHeight-el.clientHeight)*Math.min(100,Math.max(0,action.percent))/100)}
    else if(action.to==='nextPage'||action.to==='prevPage'){const step=Math.max(1,Math.round((el===document.scrollingElement||el===document.documentElement?innerHeight:el.clientHeight)*0.9));el.scrollTop=el.scrollTop+(action.to==='nextPage'?step:-step)}
    else if(typeof action.dy==='number')el.scrollTop=el.scrollTop+action.dy;
    if(typeof action.dx==='number')el.scrollLeft=el.scrollLeft+action.dx;
    el.dispatchEvent(new Event('scroll',{bubbles:true}));
    const maxTop=Math.max(0,el.scrollHeight-el.clientHeight);
    return {page:pageInfo(),target,scrolled:{top:el.scrollTop,left:el.scrollLeft,maxTop,maxLeft:Math.max(0,el.scrollWidth-el.clientWidth)},atTop:el.scrollTop<=0,atBottom:el.scrollTop>=maxTop-1,percent:maxTop>0?Math.round(Math.min(1,el.scrollTop/maxTop)*100):100,...(action.to==='element'&&shownEl?{element:describe(shownEl)}:{})}
  }
  if(action.kind==='errors'){
    const kinds=Array.isArray(action.kinds)&&action.kinds.length?new Set(action.kinds):null;
    const fresh=pageErrors.filter((e)=>(typeof action.since!=='number'||e.at>action.since)&&(!kinds||kinds.has(e.kind)));
    // Повторы одной ошибки схлопываются с count: сто одинаковых строк не помогают ни человеку, ни модели.
    const grouped=new Map();
    for(const e of fresh){const key=e.kind+'|'+e.message+'|'+(e.url||'');const prev=grouped.get(key);if(prev){prev.count++;prev.at=e.at}else grouped.set(key,{kind:e.kind,message:e.message,at:e.at,...(e.url?{url:String(e.url).slice(0,300)}:{}),...(typeof e.status==='number'?{status:e.status}:{}),count:1})}
    const errors=[...grouped.values()].slice(-50).map((e)=>e.count>1?e:(delete e.count,e));
    const total=fresh.length;
    if(action.clear)pageErrors.length=0;
    return {page:pageInfo(),errors,total}
  }
  if(action.kind==='wait'&&action.changed&&!action.selector&&!action.text){
    // «Что-то должно произойти»: ждём любого изменения видимого текста относительно текущего состояния.
    const timeoutMs=Math.min(8000,typeof action.timeoutMs==='number'&&action.timeoutMs>0?action.timeoutMs:5000),started=performance.now(),before=textSnapshot||visibleTexts();
    return new Promise((ok,fail)=>{const attempt=()=>{const now=visibleTexts();const changes=diffTexts(before,now);if(changes.addedTotal||changes.removedTotal){textSnapshot=now;ok({page:pageInfo(),waitedMs:Math.round(performance.now()-started),state:'changed',changes});return}if(performance.now()-started>=timeoutMs){fail(new Error('Страница не изменилась за '+timeoutMs+' мс'));return}setTimeout(attempt,150)};attempt()})
  }
  if(action.kind==='wait'&&action.stable&&!action.selector&&!action.text){
    // «Пусть всё дорисуется»: полсекунды без правок DOM — так человек ждёт, пока страница успокоится.
    const timeoutMs=Math.min(8000,typeof action.timeoutMs==='number'&&action.timeoutMs>0?action.timeoutMs:5000),started=performance.now();
    return new Promise((ok,fail)=>{
      let last=performance.now(),mutations=0;
      const observer=new MutationObserver(records=>{mutations+=records.length;last=performance.now()});
      observer.observe(document.documentElement,{childList:true,subtree:true,characterData:true,attributes:true});
      const attempt=()=>{
        const now=performance.now();
        if(now-last>=500){observer.disconnect();ok({page:pageInfo(),waitedMs:Math.round(now-started),state:'stable'});return}
        if(now-started>=timeoutMs){observer.disconnect();fail(new Error('Страница продолжала меняться '+timeoutMs+' мс ('+mutations+' правок)'));return}
        setTimeout(attempt,120)
      };
      setTimeout(attempt,120)
    })
  }
  if(action.kind==='wait'&&action.idle&&!action.selector&&!action.text){
    const timeoutMs=Math.min(8000,typeof action.timeoutMs==='number'&&action.timeoutMs>0?action.timeoutMs:5000),started=performance.now();
    return new Promise((ok,fail)=>{const attempt=()=>{const quiet=inFlight===0&&performance.now()-lastNetworkAt>=500;if(quiet){ok({page:pageInfo(),waitedMs:Math.round(performance.now()-started),state:'idle'});return}if(performance.now()-started>=timeoutMs){fail(new Error('Сеть страницы не затихла за '+timeoutMs+' мс: в полёте '+inFlight));return}setTimeout(attempt,120)};attempt()})
  }
  if(action.kind==='wait'){
    const timeoutMs=Math.min(8000,typeof action.timeoutMs==='number'&&action.timeoutMs>0?action.timeoutMs:5000);
    const state=action.state||'visible';
    const started=performance.now();
    // attached/detached считают и скрытые узлы; visible/hidden — только то, что видит пользователь.
    // enabled/checked/value — состояние контрола, которого ждёт человек («кнопка стала активной»).
    const stateOk=(el)=>(action.enabled===undefined||(!el.matches(':disabled')&&!el.closest('[aria-disabled="true"],[inert]'))===action.enabled)
      &&(action.checked===undefined||Boolean(el.checked)===action.checked)
      &&(action.value===undefined||String(el.value===undefined?textOf(el):el.value)===action.value);
    const matches=()=>(state==='attached'||state==='detached'?(action.selector?bySelector(action.selector):byText(action.text||'',true)):findTargets(action)).filter(stateOk);
    return new Promise((ok,fail)=>{
      const attempt=()=>{
        let found=[];
        try{found=matches()}catch(err){fail(err);return}
        const gone=state==='hidden'||state==='detached';
        if(gone?!found.length:found.length){ok({page:pageInfo(),...(gone?{}:{found:describe(found[0])}),waitedMs:Math.round(performance.now()-started),state});return}
        if(performance.now()-started>=timeoutMs){fail(new Error((gone?'Элемент не исчез за ':'Элемент не появился за ')+timeoutMs+' мс: '+(action.selector||action.text)));return}
        setTimeout(attempt,120)
      };
      attempt()
    })
  }
  if(action.kind==='back'||action.kind==='forward'){
    const info=pageInfo(),steps=Math.min(20,Math.max(1,Math.floor(action.steps||1)));
    history.go(action.kind==='back'?-steps:steps);
    return {page:info,navigating:true}
  }
  if(action.kind==='network'){
    const filter=typeof action.filter==='string'?action.filter.toLowerCase():'';
    const recent=typeof action.since==='number'?pageNetwork.filter((e)=>e.at>action.since):pageNetwork;
    const matched=filter?recent.filter((e)=>e.url.toLowerCase().includes(filter)):recent;
    const all=action.failedOnly?matched.filter((e)=>e.error||typeof e.status==='number'&&e.status>=400):matched;
    const limit=Math.max(1,Math.min(100,typeof action.limit==='number'?Math.floor(action.limit):50));
    const requests=all.slice(-limit).map((e)=>Object.assign({},e));
    const total=all.length;
    if(action.clear)pageNetwork.length=0;
    return {page:pageInfo(),requests,total}
  }
  if(action.kind==='console'){
    const pattern=typeof action.pattern==='string'?action.pattern.toLowerCase():'';
    const all=pageConsole.filter((e)=>(!action.level||e.level===action.level)&&(!pattern||e.message.toLowerCase().includes(pattern)));
    const limit=Math.max(1,Math.min(100,typeof action.limit==='number'?Math.floor(action.limit):50));
    const messages=all.slice(-limit).map((e)=>Object.assign({},e));
    const total=all.length;
    if(action.clear)pageConsole.length=0;
    return {page:pageInfo(),messages,total}
  }
  if(action.kind==='evaluate'){
    const finish=(v)=>{let s;try{s=v===undefined?'undefined':JSON.stringify(v)}catch{s=String(v)}if(s===undefined)s=String(v);return {page:pageInfo(),value:String(s).slice(0,8000)}};
    const value=(0,eval)(action.code);
    return value&&typeof value.then==='function'?value.then(finish):finish(value)
  }
  if(action.kind==='drag'){
    // jsdom не реализует elementFromPoint — защищаемся, чтобы тесты и headless-страницы не падали.
    const elAt=(x,y)=>{try{return document.elementFromPoint(x,y)||null}catch{return null}};
    const pointOf=(p)=>{
      if(p.selector){const found=bySelector(p.selector);if(!found.length)throw new Error('Элемент не найден: '+p.selector);const el=found[0];el.scrollIntoView&&el.scrollIntoView({block:'center'});const r=el.getBoundingClientRect();return {el,x:r.left+r.width/2,y:r.top+r.height/2}}
      return {el:elAt(p.x,p.y),x:p.x,y:p.y}
    };
    const src=pointOf(action.from),dst=pointOf(action.to);
    if(!src.el)throw new Error('Источник перетаскивания не найден');
    const to={x:Math.round(dst.x),y:Math.round(dst.y)};
    const html5=src.el.closest('[draggable=true]');
    if(html5&&window.DragEvent&&window.DataTransfer){
      // HTML5 DnD: у элемента draggable — события dragstart/over/drop с общим DataTransfer.
      const dt=new DataTransfer();
      const fire=(type,tgt,x,y)=>tgt.dispatchEvent(new DragEvent(type,{bubbles:true,cancelable:true,clientX:x,clientY:y,dataTransfer:dt}));
      fire('dragstart',html5,src.x,src.y);
      const drop=elAt(dst.x,dst.y)||document.body;
      fire('dragenter',drop,dst.x,dst.y);fire('dragover',drop,dst.x,dst.y);fire('drop',drop,dst.x,dst.y);fire('dragend',html5,dst.x,dst.y);
      return {page:pageInfo(),dragged:describe(html5),to,via:'html5'}
    }
    // Pointer-механика (наш lib/dnd и большинство SPA): down → серия move → up.
    // Паузы между шагами дают обработчикам сработать по порогу расстояния.
    const firePointer=(type,tgt,x,y,buttons)=>{tgt.dispatchEvent(new (window.PointerEvent||MouseEvent)(type,{bubbles:true,cancelable:true,clientX:x,clientY:y,pointerId:1,isPrimary:true,button:0,buttons}));tgt.dispatchEvent(new MouseEvent(type.replace('pointer','mouse'),{bubbles:true,cancelable:true,clientX:x,clientY:y,button:0,buttons}))};
    firePointer('pointerdown',src.el,src.x,src.y,1);
    const el=src.el,steps=8;
    return new Promise((ok)=>{
      let i=0;
      const tick=()=>{
        i++;
        const x=src.x+(dst.x-src.x)*i/steps,y=src.y+(dst.y-src.y)*i/steps;
        const over=elAt(x,y)||document.body;
        firePointer('pointermove',over,x,y,1);
        if(i<steps){setTimeout(tick,30);return}
        const drop=elAt(dst.x,dst.y)||document.body;
        firePointer('pointerup',drop,dst.x,dst.y,0);
        ok({page:pageInfo(),dragged:describe(el),to,via:'pointer'})
      };
      setTimeout(tick,30)
    })
  }
  if(action.kind==='set'){
    const el=chooseTarget(action);actionable(el);
    el.scrollIntoView&&el.scrollIntoView({block:'center'});
    if(el.localName==='select'){
      const target=selectOption(el,action.value??'');
      el.value=target.value;
      el.dispatchEvent(new Event('input',{bubbles:true}));el.dispatchEvent(new Event('change',{bubbles:true}));
      return {page:pageInfo(),set:describe(el),value:el.value}
    }
    if(el.localName==='input'&&(el.type==='checkbox'||el.type==='radio')){
      const want=action.checked!==undefined?action.checked:true;
      // Нативный клик сам обновляет checked и шлёт input/change/click.
      if(el.type==='radio'&&el.checked&&!want)throw new Error('Radio нельзя снять кликом — выберите другую опцию группы');
      if(el.checked!==want)el.click();
      if(el.checked!==want)throw new Error('Страница отклонила изменение переключателя');
      return {page:pageInfo(),set:describe(el),value:String(el.checked)}
    }
    if(el.localName==='input'||el.localName==='textarea'){
      actionable(el,true);validateInput(el,String(action.value??''));
      setNativeValue(el,String(action.value??''));
      el.dispatchEvent(new Event('input',{bubbles:true}));el.dispatchEvent(new Event('change',{bubbles:true}));
      return {page:pageInfo(),set:describe(el),value:String(el.value).slice(0,EL_TEXT)}
    }
    throw new Error('Элемент не является контролом формы: '+action.selector)
  }
  if(action.kind==='upload'){
    const found=bySelector(action.selector);
    if(!found.length)throw new Error('Поле не найдено: '+action.selector);
    const el=found[0];
    if(!(el.localName==='input'&&el.type==='file'))throw new Error('Элемент не является input type=file: '+action.selector);
    if(!window.DataTransfer)throw new Error('Браузер не поддерживает программную загрузку файлов');
    const bin=atob(action.base64);
    const bytes=new Uint8Array(bin.length);
    for(let i=0;i<bin.length;i++)bytes[i]=bin.charCodeAt(i);
    const file=new File([bytes],action.name,{type:action.mimeType||'application/octet-stream'});
    const dt=new DataTransfer();dt.items.add(file);
    el.files=dt.files;
    el.dispatchEvent(new Event('input',{bubbles:true}));el.dispatchEvent(new Event('change',{bubbles:true}));
    return {page:pageInfo(),uploaded:{selector:uniqueSelector(el),name:action.name,size:bytes.length}}
  }
  if(action.kind==='a11y'){
    const scope=readingScope(action),limit=Math.max(1,Math.min(200,typeof action.limit==='number'?Math.floor(action.limit):200));
    const nodes=[];let total=0;
    const walk=(el,level)=>{
      if(!accessibleVisible(el))return;
      const role=accessibleRole(el);let next=level;
      if(role){total++;if(nodes.length<limit)nodes.push({role,name:accessibleName(el),selector:uniqueSelector(el),level,...controlState(el)});next++}
      for(const child of el.children)walk(child,next)
    };
    walk(scope,0);return {page:pageInfo(),nodes,total}
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
    // marks: пронумерованные кликабельные элементы в кадре — модель «указывает пальцем» по номеру.
    const marks=action.marks?[...document.querySelectorAll(CLICKABLE)].filter(el=>actionVisible(el)&&!el.closest('[data-voicechat-inspector]')).map(el=>({el,r:el.getBoundingClientRect()})).filter(({r})=>r.width>0&&r.height>0&&r.left+scroller.scrollLeft<rect.x+rect.width&&r.right+scroller.scrollLeft>rect.x&&r.top+scroller.scrollTop<rect.y+rect.height&&r.bottom+scroller.scrollTop>rect.y).slice(0,40).map(({el,r},i)=>({n:i+1,selector:uniqueSelector(el),text:(accessibleName(el)||'').slice(0,60),...(accessibleRole(el)?{role:accessibleRole(el)}:{}),box:{x:r.left+scroller.scrollLeft-rect.x,y:r.top+scroller.scrollTop-rect.y,width:r.width,height:r.height}})):null;
    // Масштаб до 1400px по большей стороне: снимок агента идёт в контекст модели.
    return captureArea(rect,1400,marks).then((dataUrl)=>({page:pageInfo(),rect,dataUrl,...(marks?{marks:marks.map(({n,selector,text,role})=>({n,selector,text,...(role?{role}:{})}))}:{})}))
  }
  if(action.kind==='press'){
    const el=action.selector?chooseTarget(action):(document.activeElement||document.body);
    if(action.selector){actionable(el);el.focus&&el.focus()}
    const repeat=Math.min(50,Math.max(1,Math.floor(action.repeat||1)));
    let pressed;for(let i=0;i<repeat;i++)pressed=performKey(document.activeElement&&document.activeElement!==document.body&&!action.selector?document.activeElement:el,action.key);
    const dialogsAfter=openDialogs();
    return {page:pageInfo(),pressed:repeat>1?Object.assign(pressed,{repeat}):pressed,...(dialogsAfter.length?{dialogs:dialogsAfter}:{})}
  }
  if(action.kind==='read'){
    const section=action.section?sectionScope(action.section):null;
    // Открытое модальное окно держит внимание человека — без selector читаем именно его.
    const dialogSelectors=!action.selector&&!section?openDialogs():[];
    const dialogEl=dialogSelectors.length?bySelector(dialogSelectors[dialogSelectors.length-1])[0]:null;
    const mainEl=action.main&&!action.selector&&!section?mainScope():null;
    const scope=section?section.scope:mainEl||dialogEl||readingScope(action);
    const selectedText=(()=>{try{return String(getSelection()||'').replace(/\\s+/g,' ').trim().slice(0,2000)}catch{return ''}})();
    // visible — экран пользователя: элементы вне видимой области отфильтровываются, текст берётся из видимых узлов.
    const parts=Array.isArray(action.parts)&&action.parts.length?new Set(action.parts):null;
    const keep=(name,value)=>!parts||parts.has(name)?value:undefined;
    // Клон раздела не в документе: видимость и координаты у него не спросить — берём всё.
    const pick=(selector)=>(section&&section.detached?[...(scope.matches(selector)?[scope]:[]),...scope.querySelectorAll(selector)]:scopeElements(scope,selector)).filter(el=>!action.visible||onScreen(el));
    const headings=pick('h1,h2,h3,h4,h5,h6').slice(0,HEADINGS).map(h=>({level:Number(h.localName[1]),text:readableText(h,EL_TEXT),selector:uniqueSelector(h)}));
    const links=[],seen=new Set();
    for(const a of pick('a[href]')){if(links.length>=LINKS)break;const text=accessibleName(a),href=unproxy(a.getAttribute('href'));if(!text||seen.has(text+'|'+href))continue;seen.add(text+'|'+href);links.push({text,href})}
    const buttons=pick('button,[role=button],input[type=submit],input[type=button],input[type=reset],input[type=image]').map(el=>accessibleName(el)).filter(Boolean).slice(0,BUTTONS);
    const inputs=pick('input:not([type=hidden]),textarea,select').slice(0,INPUTS).map(el=>({selector:uniqueSelector(el),type:el.localName==='input'?(el.type||'text'):el.localName,name:el.name||'',label:accessibleName(el),placeholder:el.getAttribute('placeholder')||'',value:sensitive(el)?'':String(el.value||'').slice(0,EL_TEXT),...controlState(el),...(el.localName==='select'?{options:[...el.options].slice(0,20).map(o=>textOf(o).slice(0,EL_TEXT))}:{})}));
    const forms=pick('form').slice(0,10).map(form=>{const fields=[...form.querySelectorAll('input:not([type=hidden]),textarea,select')].filter(readingVisible).slice(0,20).map(el=>accessibleName(el)||el.getAttribute('placeholder')||el.name||el.localName);const submitter=[...form.querySelectorAll('button,input[type=submit],input[type=image]')].find(el=>readingVisible(el)&&(el.localName==='input'||!el.type||el.type==='submit'));return {selector:uniqueSelector(form),fields,...(submitter?{submit:accessibleName(submitter)}:{})}});
    // Таблицы построчно: заголовки и первые строки — так их читает человек.
    const frames=[...document.querySelectorAll('iframe')].filter(readingVisible).slice(0,8).map(f=>({selector:uniqueSelector(f),src:unproxy(f.getAttribute('src')||'').slice(0,300),title:(f.getAttribute('title')||f.getAttribute('name')||'').slice(0,EL_TEXT)}));
    // Картинки видит человек, но не модель: по запросу все видимые, иначе — только подписанные, до пяти.
    const wantImages=parts&&parts.has('images');
    const images=(wantImages||!parts)?pick('img,[role=img]').filter(img=>{const r=img.getBoundingClientRect();return (r.width||img.width||img.naturalWidth||0)>=24&&(wantImages||(img.getAttribute('alt')||img.getAttribute('aria-label')||'').trim())}).slice(0,wantImages?20:5).map(img=>{const r=img.getBoundingClientRect();return {selector:uniqueSelector(img),alt:(img.getAttribute('alt')||img.getAttribute('aria-label')||img.getAttribute('title')||'').slice(0,EL_TEXT),src:unproxy(img.currentSrc||img.getAttribute('src')||'').slice(0,300),width:Math.round(r.width||img.width||0),height:Math.round(r.height||img.height||0)}}):[];
    const overlays=(!parts||parts.has('landmarks'))?findOverlays('all').map(el=>({selector:uniqueSelector(el),text:textOf(el).slice(0,120),kind:overlayKind(el)})):[];
    // Ориентиры страницы, которые человек замечает сразу: путь по сайту, листалка, дата и поле поиска.
    const breadcrumbs=(!parts||parts.has('landmarks'))?breadcrumbsOf():[];
    const pagination=(!parts||parts.has('links'))?paginationOf():null;
    const published=(!parts||parts.has('text'))?publishedOf():null;
    const searchEl=(!parts||parts.has('inputs'))?searchField():null;
    const tables=(!parts||parts.has('tables'))?pick('table').slice(0,5).map(table=>{const rowsAll=[...table.querySelectorAll('tr')].filter(readingVisible);const headers=[...table.querySelectorAll('th')].filter(readingVisible).slice(0,12).map(th=>readableText(th,EL_TEXT));const body=rowsAll.filter(tr=>!tr.querySelector('th')||headers.length===0);const rows=body.slice(0,10).map(tr=>[...tr.querySelectorAll('td,th')].slice(0,12).map(td=>readableText(td,EL_TEXT)));const cap=table.querySelector('caption');return {selector:uniqueSelector(table),...(cap?{caption:readableText(cap,EL_TEXT)}:{}),headers,rows,totalRows:body.length}}):[];
    const landmarks=pick('nav,main,header,footer,aside,[role=navigation],[role=main],[role=banner],[role=contentinfo],[role=complementary],[role=search],[role=region][aria-label],[role=region][aria-labelledby]').slice(0,12).map(el=>({role:accessibleRole(el)||el.getAttribute('role')||el.localName,name:(el.getAttribute('aria-label')||accessibleName(el)||'').slice(0,80),selector:uniqueSelector(el)}));
    // markdown: заголовки и пункты списков размечены — так текст читается структурно, а не потоком.
    const markdownText=()=>{const parts=[];const walker=document.createTreeWalker(scope,NodeFilter.SHOW_ELEMENT|NodeFilter.SHOW_TEXT);let node;const seen=new Set();
      while((node=walker.nextNode())){if(node.nodeType===1){if(/^h[1-6]$/.test(node.localName)&&readingVisible(node)){parts.push('\\n'+'#'.repeat(Number(node.localName[1]))+' '+readableText(node,EL_TEXT)+'\\n');seen.add(node);continue}if(node.localName==='li'&&readingVisible(node)){parts.push('\\n- '+readableText(node,400));seen.add(node);continue}if(node.localName==='p'||node.localName==='br'||node.localName==='tr')parts.push('\\n');continue}
        const parent=node.parentElement;if(!parent||!readingVisible(parent)||parent.closest('script,style,template,noscript,[data-voicechat-inspector]'))continue;if([...seen].some(el=>el.contains(parent)))continue;const t=(node.nodeValue||'').replace(/\\s+/g,' ').trim();if(t)parts.push(t+' ')}
      return parts.join('').replace(/\\n{3,}/g,'\\n\\n').trim()};
    let text=action.markdown?markdownText():action.visible?visibleText(scope):readableText(scope,Number.MAX_SAFE_INTEGER,Boolean(section&&section.detached));
    // next — «читай дальше»: продолжаем с места, где закончился прошлый read этой же страницы.
    let offset=action.next&&readCursor.url===pageInfo().url?readCursor.end:(action.offset??0);
    if(action.next&&offset>=text.length&&text.length)offset=Math.max(0,text.length-200);
    if(action.around){const idx=normText(text).indexOf(normText(action.around));if(idx<0)throw new Error('Фраза не найдена на странице: '+action.around);offset=Math.max(0,idx-600)}
    const limit=action.around?Math.min(action.limit??1200,SNIPPET):(action.limit??SNIPPET),end=Math.min(text.length,offset+limit);
    readCursor={url:pageInfo().url,end};
    const toc=action.toc?tocOf(scope):null;
    const lists=(!parts||parts.has('links'))?listsOf(scope):[];
    const tableOne=action.table?(()=>{const table=tableByName(action.table);const rowsAll=[...table.querySelectorAll('tr')].filter(readingVisible);const headers=[...table.querySelectorAll('th')].filter(readingVisible).slice(0,20).map(th=>readableText(th,EL_TEXT));const body=rowsAll.filter(tr=>!tr.querySelector('th')||headers.length===0);const rowOffset=Math.max(0,Math.min(body.length,action.rowOffset??0));const page=body.slice(rowOffset,rowOffset+20).map(tr=>[...tr.querySelectorAll('td,th')].slice(0,20).map(td=>readableText(td,EL_TEXT)));const caption=table.querySelector('caption');return {selector:uniqueSelector(table),...(caption?{caption:readableText(caption,EL_TEXT)}:{}),headers,rows:page,totalRows:body.length,rowOffset,...(rowOffset+page.length<body.length?{nextRowOffset:rowOffset+page.length}:{})}})():null;
    const focus=document.activeElement&&document.activeElement!==document.body&&document.activeElement!==document.documentElement?uniqueSelector(document.activeElement):undefined;
    // Уведомления и индикаторы загрузки — то, на что человек смотрит прежде всего.
    const notices=[...document.querySelectorAll('[role=alert],[role=status],[aria-live="assertive"],[aria-live="polite"],.toast,.notification,.alert,.snackbar')].filter(readingVisible).map(el=>readableText(el,EL_TEXT)).filter(Boolean).filter((t,i,all)=>all.indexOf(t)===i).slice(0,8);
    const progress=[...document.querySelectorAll('progress,[role=progressbar],[aria-busy="true"]')].filter(readingVisible).slice(0,8).map(el=>({selector:uniqueSelector(el),...(el.localName==='progress'&&Number.isFinite(el.value)?{value:el.value,max:el.max}:{}),...(el.getAttribute('aria-valuenow')?{value:Number(el.getAttribute('aria-valuenow')),...(el.getAttribute('aria-valuemax')?{max:Number(el.getAttribute('aria-valuemax'))}:{})}:{}),...(accessibleName(el)?{label:accessibleName(el)}:{})}));
    if(!action.selector&&!section)textSnapshot=visibleTexts();
    const scroller=document.scrollingElement||document.documentElement,maxScroll=Math.max(0,scroller.scrollHeight-innerHeight),scroll={top:Math.round(scroller.scrollTop),max:Math.round(maxScroll),percent:maxScroll>0?Math.round(scroller.scrollTop/maxScroll*100):100};
    const briefBase=action.brief?[pageInfo().title?'Страница «'+pageInfo().title+'»':'Страница без заголовка',headings[0]?'главный заголовок — «'+headings[0].text+'»':'',dialogEl?'открыто окно':'',links.length+' ссылок, '+buttons.length+' кнопок, '+inputs.length+' полей'+(forms.length?', '+forms.length+' форм':''),text.slice(0,240)?'начало текста: '+text.slice(0,240).trim()+(text.length>240?'…':''):''].filter(Boolean).join('; '):'';
    return {page:pageInfo(),headings:keep('headings',headings)??[],links:keep('links',links)??[],buttons:keep('buttons',buttons)??[],inputs:keep('inputs',inputs)??[],...(forms.length&&keep('forms',true)?{forms}:{}),...(landmarks.length&&keep('landmarks',true)?{landmarks}:{}),...(tables.length?{tables}:{}),...(frames.length?{frames}:{}),...(images.length?{images}:{}),...(overlays.length?{overlays}:{}),...(breadcrumbs.length?{breadcrumbs}:{}),...(pagination?{pagination}:{}),...(published?{published}:{}),...(searchEl?{search:uniqueSelector(searchEl)}:{}),...(mainEl?{main:uniqueSelector(mainEl)}:{}),...(toc?{toc}:{}),...(lists.length?{lists}:{}),...(tableOne?{table:tableOne}:{}),...(focus?{focus}:{}),...(selectedText?{selection:selectedText}:{}),...(section?{section:section.title}:{}),...(dialogEl?{dialog:uniqueSelector(dialogEl)}:{}),...(briefBase?{brief:(briefBase+(notices.length?'; уведомления: '+notices.slice(0,3).join(' | '):'')).slice(0,600)}:{}),scroll,...(notices.length?{notices}:{}),...(progress.length?{progress}:{}),text:keep('text',true)?text.slice(offset,end):'',total:text.length,offset,...(action.visible?{visible:true,viewport:{width:innerWidth,height:innerHeight,scrollTop:(document.scrollingElement||document.documentElement).scrollTop}}:{}),...(end<text.length?{truncated:true,nextOffset:end}:{})}
  }
  throw new Error('Неизвестное действие')
};
const reply=(requestId,ok,payload)=>parent.postMessage(ok?{type:RESULT,requestId,ok:true,result:payload}:{type:RESULT,requestId,ok:false,error:String(payload).slice(0,2000)},location.origin);
let recording=false,diagnosticRunning=false,lastRecordedClickAt=0;
const sensitive=(el)=>['input','textarea'].includes(el.localName)&&(el.hasAttribute('data-voicechat-secret')||el.type==='password'||el.autocomplete==='current-password'||el.autocomplete==='new-password'||/pass|secret|token|card|cvv/i.test((el.name||'')+' '+(el.id||'')));
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
const captureArea=async(rect,maxSide,marks)=>{
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
  if(marks)for(const mark of marks){const b=mark.box;ctx.strokeStyle='#e5484d';ctx.lineWidth=2;ctx.strokeRect(b.x,b.y,b.width,b.height);const label=String(mark.n);ctx.font='bold 12px system-ui,sans-serif';const w=ctx.measureText(label).width+8;ctx.fillStyle='#e5484d';ctx.fillRect(b.x,Math.max(0,b.y-16),w,16);ctx.fillStyle='#fff';ctx.fillText(label,b.x+4,Math.max(12,b.y-4))}
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
  if(e.data.type===READER&&typeof e.data.enabled==='boolean'){setReader(e.data.enabled);return}
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
// Сводка страницы вместе с готовностью: модель ориентируется по open без отдельного read.
const outline=()=>{try{const scope=document.body||document.documentElement;const words=readableText(scope,200000).split(/\\s+/).filter(Boolean).length;return {headings:[...scope.querySelectorAll('h1,h2,h3')].filter(readingVisible).slice(0,5).map(h=>readableText(h,120)).filter(Boolean),links:scope.querySelectorAll('a[href]').length,buttons:scope.querySelectorAll('button,[role=button],input[type=submit]').length,inputs:scope.querySelectorAll('input:not([type=hidden]),textarea,select').length,words}}catch{return {headings:[],links:0,buttons:0,inputs:0}}};
// Ориентиры для самой панели: путь по сайту, листалка, дата и поле поиска — их рисует оболочка, не модель.
const navInfo=()=>{try{const search=searchField();return {breadcrumbs:breadcrumbsOf(),toc:tocOf(document.body||document.documentElement).slice(0,40),...(paginationOf()?{pagination:paginationOf()}:{}),...(publishedOf()?{published:publishedOf()}:{}),...(search?{search:uniqueSelector(search)}:{})}}catch{return {breadcrumbs:[]}}};
const ready=()=>parent.postMessage({type:READY,...pageInfo(),outline:outline(),nav:navInfo(),viewport:{width:innerWidth,height:innerHeight}},location.origin);
// Выделение пользователя уходит оболочке: она предложит спросить о нём ассистента.
const SELECTION='voicechat.preview.selection.v1';let selectionTimer=null,lastSelection='',selectionByAssistant=false;
document.addEventListener('selectionchange',()=>{if(selectionTimer)clearTimeout(selectionTimer);selectionTimer=setTimeout(()=>{let text='';try{text=String(getSelection()||'').replace(/\\s+/g,' ').trim().slice(0,2000)}catch{}if(text===lastSelection)return;lastSelection=text;const by=selectionByAssistant?'assistant':'user';selectionByAssistant=false;parent.postMessage({type:SELECTION,text,by},location.origin)},250)});
// Адрес ссылки под курсором или в фокусе уходит оболочке — строка состояния браузера; долгое нажатие — меню ссылки на телефоне.
const LINK='voicechat.preview.link.v1';let lastLink='';
const linkOf=(node)=>{const a=node&&node.closest?node.closest('a[href]'):null;return a&&!a.closest('[data-voicechat-inspector]')?a:null};
const postLink=(a,longPress)=>{const href=a?unproxy(a.getAttribute('href')||''):'';if(!longPress&&href===lastLink)return;lastLink=href;parent.postMessage({type:LINK,href,text:a?(accessibleName(a)||textOf(a)).slice(0,120):'',newTab:Boolean(a&&a.getAttribute('target')==='_blank'),longPress:Boolean(longPress)},location.origin)};
document.addEventListener('mouseover',e=>postLink(linkOf(e.target),false),true);
document.addEventListener('mouseout',e=>{if(linkOf(e.target)&&!linkOf(e.relatedTarget))postLink(null,false)},true);
document.addEventListener('focusin',e=>{const a=linkOf(e.target);if(a)postLink(a,false)},true);
document.addEventListener('focusout',e=>{if(linkOf(e.target))postLink(null,false)},true);
// Свайп от края — назад/вперёд, как в мобильных браузерах; долгое нажатие на ссылку — её меню.
const GESTURE='voicechat.preview.gesture.v1';let pressTimer=null,pressStart=null;
document.addEventListener('touchstart',e=>{const t=e.touches[0];if(!t)return;pressStart={x:t.clientX,y:t.clientY,at:Date.now()};if(pressTimer)clearTimeout(pressTimer);const a=linkOf(e.target);pressTimer=a?setTimeout(()=>{pressTimer=null;postLink(a,true)},500):null},{passive:true,capture:true});
document.addEventListener('touchmove',e=>{const t=e.touches[0];if(pressTimer&&pressStart&&t&&Math.hypot(t.clientX-pressStart.x,t.clientY-pressStart.y)>10){clearTimeout(pressTimer);pressTimer=null}},{passive:true,capture:true});
document.addEventListener('touchend',e=>{if(pressTimer){clearTimeout(pressTimer);pressTimer=null}const t=e.changedTouches[0];if(!t||!pressStart)return;const dx=t.clientX-pressStart.x,dy=t.clientY-pressStart.y;
  if(Math.abs(dx)>80&&Math.abs(dy)<60&&Date.now()-pressStart.at<800){if(pressStart.x<=24&&dx>0)parent.postMessage({type:GESTURE,gesture:'back'},location.origin);else if(pressStart.x>=innerWidth-24&&dx<0)parent.postMessage({type:GESTURE,gesture:'forward'},location.origin)}
  pressStart=null},{passive:true,capture:true});
// Режим чтения: спрятать навигацию и колонки, оставить текст удобной ширины — как «Reader» в браузере.
const READER='voicechat.preview.reader.v1',READER_ID='voicechat-reader-style';
const setReader=(enabled)=>{const existing=document.getElementById(READER_ID);if(!enabled){if(existing)existing.remove();return}if(existing)return;const style=document.createElement('style');style.id=READER_ID;style.textContent='nav,header,footer,aside,[role=navigation],[role=banner],[role=contentinfo],[role=complementary],iframe,[class*="sidebar"],[id*="sidebar"]{display:none !important}body{max-width:44em !important;margin:0 auto !important;padding:0 1em !important;font-size:1.06em !important;line-height:1.6 !important}img,video{max-width:100% !important;height:auto !important}';document.head.appendChild(style)};
addEventListener('message',message);
for(const event of ['hashchange','popstate','voicechat.preview.navigation'])addEventListener(event,ready);
// BFCache сохраняет документ после pagehide: восстанавливаем его обработчик.
addEventListener('pageshow',()=>{addEventListener('message',message);ready()});
addEventListener('pagehide',()=>{disable();disableEdit();disableCapture();setRecording(false);removeEventListener('message',message)});
ready();
})();<\/script>`
}

export function rewritePreviewBody(body: Buffer, type: string, base: URL, rewriteModules = true): Buffer {
  if (!isPreviewText(type)) return body
  let text = decodePreviewText(body, type)
  const rewriteCssUrls = (css: string, targetBase = base): string => rewritePreviewCss(css, targetBase, proxyUrl)
  if (/text\/html|application\/xhtml\+xml/i.test(type)) {
    text = rewritePreviewHtml(text, base, {
      url: proxyUrl,
      css: rewriteCssUrls,
      module: rewriteModuleSpecifiers,
      importMap: (source, mapBase) => rewritePreviewImportMap(source, mapBase, proxyUrl),
      context: (documentBase) => previewContextScript(base.toString(), documentBase.toString()),
      inspector: previewInspectorScript()
    })
  }
  if (/text\/css/i.test(type)) text = rewriteCssUrls(text)
  // ESM-модули dev-сервера на машине. Их импорты браузер резолвит сам: `/@vite/client`
  // ушёл бы на origin ChatAI (404), а `./chunk.js` — относительно `/api/preview`.
  // Поэтому спецификаторы переписываем так же, как ссылки в HTML. Это нужно и
  // приложению через операторский алиас: его собранные chunks тоже используют ESM.
  if (rewriteModules && /javascript|ecmascript/i.test(type)) text = rewriteModuleSpecifiers(text, base)
  return Buffer.from(text)
}

/** Хост машины: `<agentId>.machine.internal`. */
export function isMachinePreviewHost(hostname: string): boolean {
  return hostname.endsWith(MACHINE_PREVIEW_SUFFIX)
}

/**
 * `import … from '…'`, `export … from '…'` и `import('…')` с путём (абсолютным или
 * относительным). Голые имена пакетов не трогаем: dev-сервер их уже разрешил, а в
 * статике они и не встречаются.
 */
export function rewriteModuleSpecifiers(code: string, base: URL): string {
  return rewritePreviewModules(code, base, proxyUrl)
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

async function get(url: URL, userId: string, method = 'GET', body?: string | Buffer, headers: Record<string, string | string[]> = {}, hostAliases: HostAliases = new Map(), cookies: PreviewCookieStore = legacyCookies): Promise<{ response: IncomingMessage; finalUrl: URL }> {
  // Проверяем исходный адрес на каждом редиректе. Только операторский алиас
  // разрешает внутренний транспорт; прямое обращение к его цели остаётся закрытым.
  await assertPublicHost(url.hostname)
  const target = applyHostAlias(url, hostAliases)
  const aliased = target.host !== url.host
  return new Promise((resolve, reject) => {
    const transport = url.protocol === 'https:' ? httpsRequest : httpRequest
    const request = transport(target, {
      method,
      headers: { 'user-agent': 'voiceAIChat-preview/1.0', accept: '*/*', ...headers, ...(cookies.header(userId, url) ? { cookie: cookies.header(userId, url) } : {}), ...(body === undefined ? {} : { 'content-length': String(Buffer.byteLength(body)) }) },
      timeout: TIMEOUT_MS,
      lookup(hostname, options, callback) {
        void lookup(hostname, { all: true, verbatim: true }).then((addresses) => {
          let result: ResolvedAddress | ResolvedAddress[]
          try {
            result = aliased ? (options.all ? addresses : addresses[0]!) : publicLookupResult(addresses, options.all === true)
            if (!result || (Array.isArray(result) && !result.length)) throw new PreviewProxyError(502, 'Адрес сайта не найден')
          } catch (err) {
            return callback(err as Error, options.all ? [] : '', 4)
          }
          if (Array.isArray(result)) return callback(null, result)
          callback(null, result.address, result.family)
        }, (err) => callback(err, options.all ? [] : '', 4))
      }
    }, (response) => {
      // Промежуточный redirect часто устанавливает сессию для следующего запроса.
      cookies.store(userId, url, responseSetCookies(response.headers))
      resolve({ response, finalUrl: url })
    })
    request.once('timeout', () => request.destroy(new PreviewProxyError(504, 'Сайт не ответил вовремя')))
    request.once('error', reject)
    request.end(body)
  })
}

async function load(url: URL, userId: string, method = 'GET', body?: string | Buffer, headers: Record<string, string | string[]> = {}, hostAliases: HostAliases = new Map(), cookies: PreviewCookieStore = legacyCookies): Promise<{ response: IncomingMessage; finalUrl: URL }> {
  let current = url
  let currentMethod = method
  let currentBody = body
  let currentHeaders = headers
  for (let redirects = 0; redirects <= MAX_REDIRECTS; redirects++) {
    const result = await get(current, userId, currentMethod, currentBody, currentHeaders, hostAliases, cookies)
    const location = result.response.headers.location
    if (!location || ![301, 302, 303, 307, 308].includes(result.response.statusCode ?? 0)) return result
    result.response.resume()
    if (redirects === MAX_REDIRECTS) throw new PreviewProxyError(502, 'Слишком много перенаправлений')
    const next = previewRedirect(current, location, result.response.statusCode!, currentMethod, currentBody, currentHeaders)
    current = next.url; currentMethod = next.method; currentBody = next.body; currentHeaders = next.headers
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
<label for="diag-select">Diagnostic select</label><select id="diag-select"><option value="">—</option><option value="one">Первая опция</option></select>
<input type="checkbox" id="diag-check" aria-label="Diagnostic checkbox">
<input type="file" id="diag-file" aria-label="Diagnostic file"><p id="file-status">file:none</p>
<p id="dbl-target">Diagnostic dblclick target</p><p id="dbl-status">dbl:0</p>
<div id="drag-source" style="width:40px;height:40px">drag me</div><p id="drag-status">drag:idle</p>
<a id="diagnostic-nav" href="/api/preview/diagnostics?page=destination">Diagnostic action navigation</a>
<div id="diagnostic-tall" style="height:3000px"></div><p id="page-bottom">page bottom</p>
<script>(()=>{let input=0,change=0,hover=0,dbl=0,moves=0,down=false;const field=document.querySelector('#diagnostic-input'),events=document.querySelector('#event-status');field.addEventListener('input',()=>{input++;events.textContent='input:'+input+' change:'+change});field.addEventListener('change',()=>{change++;events.textContent='input:'+input+' change:'+change});document.querySelector('#diagnostic-form').addEventListener('submit',(event)=>{event.preventDefault();document.querySelector('#submit-status').textContent='submitted:'+field.value});document.querySelector('#hover-target').addEventListener('mouseover',()=>{hover++;document.querySelector('#hover-status').textContent='hover:'+hover});document.addEventListener('keydown',(event)=>{document.querySelector('#key-status').textContent='key:'+event.key});document.querySelector('#dbl-target').addEventListener('dblclick',()=>{dbl++;document.querySelector('#dbl-status').textContent='dbl:'+dbl});document.querySelector('#diag-file').addEventListener('change',(event)=>{const f=event.target.files&&event.target.files[0];document.querySelector('#file-status').textContent='file:'+(f?f.name+':'+f.size:'none')});const dragStatus=document.querySelector('#drag-status');document.querySelector('#drag-source').addEventListener('pointerdown',()=>{down=true;moves=0;dragStatus.textContent='drag:down'});document.addEventListener('pointermove',()=>{if(down){moves++;dragStatus.textContent='drag:move:'+moves}});document.addEventListener('pointerup',()=>{if(down){down=false;dragStatus.textContent='drag:done:'+moves}})})()<\/script>
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
  incomingHeaders: Record<string, string | string[]>,
  cookies: PreviewCookieStore
): Promise<{ status: number; headers: Record<string, string | string[]>; body: Buffer; finalUrl: URL }> {
  let current = url
  let currentMethod = method
  let currentBody = body
  let headers = { ...incomingHeaders }
  for (let redirects = 0; redirects <= MAX_REDIRECTS; redirects++) {
    const agentId = machineAgentIdOf(current.hostname)
    if (!agentId) throw new PreviewProxyError(502, 'Тестовое окружение перенаправило наружу — открой внешний адрес напрямую')
    if (!(await deps.canUse(userId, agentId))) throw new PreviewProxyError(403, 'Машина недоступна этому пользователю')
    if (!await deps.bridge.isOnline(agentId)) throw new PreviewProxyError(502, 'Машина тестового окружения не в сети')
    const secure = current.protocol === 'https:'
    const port = current.port ? Number(current.port) : secure ? 443 : 80
    const cookie = cookies.header(userId, current)
    let response: AgentHttpResponse
    try {
      response = await deps.bridge.http(agentId, {
        method: currentMethod,
        ...(secure ? { protocol: 'https' as const } : {}),
        port,
        path: current.pathname + current.search,
        headers: { ...headers, ...(cookie ? { cookie } : {}) },
        ...(currentBody === undefined ? {} : { bodyBase64: Buffer.from(currentBody).toString('base64') })
      }, userId)
    } catch (err) {
      throw new PreviewProxyError(502, err instanceof Error ? err.message : 'Тестовое окружение недоступно')
    }
    cookies.store(userId, current, responseSetCookies(response.headers))
    const location = headerValue(response.headers, 'location')
    if (location && [301, 302, 303, 307, 308].includes(response.status)) {
      const next = new URL(location, current)
      // Сначала возвращаем логический host: локальный redirect не меняет origin сайта.
      if (next.hostname === '127.0.0.1' || next.hostname === 'localhost') next.hostname = agentId + MACHINE_PREVIEW_SUFFIX
      const redirect = previewRedirect(current, next.toString(), response.status, currentMethod, currentBody, headers)
      currentMethod = redirect.method; currentBody = redirect.body; headers = redirect.headers
      current = redirect.url
      continue
    }
    return { status: response.status, headers: response.headers, body: Buffer.from(response.bodyBase64, 'base64'), finalUrl: current }
  }
  throw new PreviewProxyError(502, 'Слишком много перенаправлений')
}

/**
 * Заголовки ответа апстрима, которые не возвращаются браузеру: фрейм-политики
 * мешают iframe, cookie живут в серверном контейнере, а валидаторы кэша
 * (etag/last-modified) описывают апстримное тело — после инъекций оно другое,
 * и ревалидация по ним оставляла бы в кэше браузера устаревшие шимы.
 */
/**
 * Ответы машины кэшируются на минуту: dev-сервер Storybook отдаёт сотни модулей, и
 * каждый идёт до машины через мост агента. Кэш общий на процесс, ключ включает машину.
 */
/** Минута в браузере: столько же живёт серверная запись, дольше держать опасно. */
const MACHINE_CACHE_CONTROL = 'private, no-cache'

const DROPPED_RESPONSE_HEADERS = new Set(['x-frame-options', 'content-security-policy', 'set-cookie', 'content-length', 'connection', 'transfer-encoding', 'content-encoding', 'etag', 'last-modified'])

/** Человеческая страница вместо JSON-ошибки: она открывается прямо в кадре. */
export function previewErrorPage(message: string): string {
  const safe = message.replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[ch] ?? ch)
  return `<!doctype html><html lang="ru"><head><meta charset="utf-8"><title>Сайт не загрузился</title>
<style>
  :root { color-scheme: light dark }
  body { margin: 0; min-height: 100vh; display: grid; place-items: center; font: 14px/1.5 system-ui, sans-serif; padding: 24px; text-align: center }
  h1 { margin: 0 0 8px; font-size: 16px }
  p { margin: 0 0 16px; max-width: 46ch; opacity: .8 }
  button { font: inherit; padding: 6px 14px; border-radius: 8px; border: 1px solid currentColor; background: transparent; cursor: pointer }
</style></head>
<body><div><h1>Сайт не загрузился</h1><p>${safe}</p>
<p>Не удалось загрузить сайт по текущему адресу. Повторите попытку, когда он снова станет доступен.</p>
<button type="button" onclick="this.disabled=true;this.textContent='Загрузка…';document.querySelector('h1').textContent='Загрузка сайта…';document.querySelectorAll('p').forEach(p=>p.hidden=true);document.querySelector('div').setAttribute('role','status');requestAnimationFrame(()=>setTimeout(()=>location.reload(),0))">Повторить</button></div></body></html>`
}

export function registerPreviewProxy(app: FastifyInstance, deps: PreviewProxyDeps = {}): void {
  // Экземпляры Reader могут иметь разные мосты/права; кэш не переживает их lifecycle.
  const machineCache = new MachineResponseCache()
  const cookies = deps.cookies ?? new PreviewCookieStore()
  app.addHook('onClose', async () => { cookies.clearAll() })
  // Сброс сессий окружений: удобно перелогиниться под другим тестовым
  // пользователем. Авторизуется preview-cookie (кнопка «Сессия» в Reader) или Bearer.
  app.post<{ Body: { host?: string } }>('/api/preview/reset-cookies', async (req) => {
    const host = typeof req.body?.host === 'string' && req.body.host.length <= 255 ? req.body.host : undefined
    return { cleared: cookies.clear(uid(req), host) }
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
        url = new URL(readerProjectUrl(req.query.url ?? '', req.protocol + '://' + req.headers.host))
        if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error()
      } catch {
        return reply.code(400).send({ error: 'invalid_url', message: 'Разрешены только HTTP и HTTPS адреса' })
      }
      try {
        // Самодиагностика не выполняет сетевой запрос: принимается только точный
        // same-origin внутренний маршрут и проходит через тот же rewrite/DOM bridge.
        if (url.pathname === '/api/preview/diagnostics' && (url.host === req.headers.host || url.origin === READER_PROJECT_ORIGIN)) {
          const source = Buffer.from(previewDiagnosticsHtml(url.searchParams.get('page') === 'destination'))
          const rewritten = rewritePreviewBody(source, 'text/html; charset=utf-8', url)
          return reply.type('text/html; charset=utf-8').send(rewritten)
        }
        const userId = uid(req)
        const body = (typeof req.body === 'string' || Buffer.isBuffer(req.body)) && req.method !== 'GET' && req.method !== 'HEAD' ? req.body : undefined
        if (url.origin === READER_PROJECT_ORIGIN) {
          if (!deps.projectResource) throw new PreviewProxyError(502, 'Текущее приложение недоступно этому Reader')
          const project = await loadPreviewProject(deps.projectResource, cookies, userId, url, req.method, body, upstreamRequestHeaders(req.headers))
          const type = headerValue(project.headers, 'content-type') ?? 'application/octet-stream'
          const decoded = await decodePreviewResponse(project.body, headerValue(project.headers, 'content-encoding'))
          const rewritten = rewritePreviewBody(decoded, type, project.finalUrl)
          reply.code(project.status)
          for (const [name, value] of Object.entries(project.headers)) {
            if (!DROPPED_RESPONSE_HEADERS.has(name.toLowerCase()) && name.toLowerCase() !== 'location') reply.header(name, value)
          }
          reply.header('content-type', previewContentType(type))
          reply.header('cache-control', 'private, no-store')
          reply.header('content-length', String(rewritten.length))
          return reply.send(rewritten)
        }
        // Тестовые окружения машин: доставка через компаньон-агента, не сетью.
        const machineAgent = machineAgentIdOf(url.hostname)
        if (machineAgent) {
          if (!deps.machines) throw new PreviewProxyError(502, 'Мост машин недоступен на этом сервере')
          // Проверка нужна и на cache hit: доступ могли отозвать после первой загрузки.
          if (!(await deps.machines.canUse(userId, machineAgent))) throw new PreviewProxyError(403, 'Машина недоступна этому пользователю')
          if (!await deps.machines.bridge.isOnline(machineAgent)) throw new PreviewProxyError(502, 'Машина тестового окружения не в сети')
          if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method)) machineCache.dropAgent(machineAgent)
          const cacheUrl = url.toString()
          const cacheAllowed = canReadPreviewCache(req.method, req.headers, Boolean(cookies.header(userId, url)))
          const cached = cacheAllowed ? machineCache.get(machineAgent, cacheUrl, userId) : null
          // Браузер уже держит эту версию — отвечаем 304 и не идём на машину вовсе.
          if (cached && String(req.headers['if-none-match'] ?? '') === cached.etag) {
            reply.code(304)
            reply.header('etag', cached.etag)
            reply.header('cache-control', MACHINE_CACHE_CONTROL)
            return reply.send()
          }
          if (cached) {
            reply.code(cached.status)
            for (const [name, value] of Object.entries(cached.headers)) reply.header(name, value)
            reply.header('etag', cached.etag)
            reply.header('cache-control', MACHINE_CACHE_CONTROL)
            reply.header('content-length', String(cached.body.length))
            return reply.send(cached.body)
          }
          const machine = await loadViaMachine(deps.machines, userId, url, req.method, body, upstreamRequestHeaders(req.headers), cookies)
          const machineType = headerValue(machine.headers, 'content-type') ?? 'application/octet-stream'
          // JS у машины переписывается тоже: dev-сервер отдаёт ESM с абсолютными
          // импортами, и без правки они ушли бы на origin ChatAI.
          const decoded = await decodePreviewResponse(machine.body, headerValue(machine.headers, 'content-encoding'))
          const machineBody = rewritePreviewBody(decoded, machineType, machine.finalUrl)
          const headers: Record<string, string | string[]> = {}
          for (const [name, value] of Object.entries(machine.headers)) {
            if (value === undefined || DROPPED_RESPONSE_HEADERS.has(name.toLowerCase()) || name.toLowerCase() === 'location') continue
            headers[name] = value
          }
          headers['content-type'] = previewContentType(machineType)
          // Браузер перепроверяет права даже пока серверная статика свежая.
          // no-store апстрима строже: не ослабляем его до обычного revalidation.
          headers['cache-control'] = /no-store/i.test(headerValue(machine.headers, 'cache-control') ?? '') ? 'private, no-store' : MACHINE_CACHE_CONTROL
          reply.code(machine.status)
          for (const [name, value] of Object.entries(headers)) reply.header(name, value)
          if (cacheAllowed && canStorePreviewCache(machine.headers) && isCacheableMachineResponse(req.method, machine.status, machineType, machineBody.length)) {
            // Валидатор считаем от переписанного тела: апстримовый etag ему не соответствует.
            const etag = `W/"${createHash('sha1').update(machineBody).digest('base64url')}"`
            machineCache.put(machineAgent, cacheUrl, { status: machine.status, headers, body: machineBody, etag }, userId)
            reply.header('etag', etag)
            reply.header('cache-control', MACHINE_CACHE_CONTROL)
          }
          reply.header('content-length', String(machineBody.length))
          return reply.send(machineBody)
        }
        const { response, finalUrl } = await load(url, userId, req.method, body, upstreamRequestHeaders(req.headers), deps.hostAliases, cookies)
        const responseType = response.headers['content-type'] ?? 'application/octet-stream'
        const responseBody = await decodePreviewResponse(await readLimited(response), response.headers['content-encoding'])
        const rewritten = rewritePreviewBody(responseBody, responseType, finalUrl)
        reply.code(response.statusCode ?? 502)
        for (const [name, value] of Object.entries(response.headers)) {
          if (value === undefined || DROPPED_RESPONSE_HEADERS.has(name.toLowerCase())) continue
          reply.header(name, value)
        }
        reply.header('content-type', previewContentType(responseType))
        // The rewritten document carries the injected panel script: a cached copy would keep an old script after a release.
        if (/text\/html|application\/xhtml\+xml/i.test(responseType)) reply.header('cache-control', 'private, no-store')
        reply.header('content-length', String(rewritten.length))
        return reply.send(rewritten)
      } catch (err) {
        const known = (err instanceof PreviewProxyError || err instanceof ProjectPreviewError || err instanceof PreviewResponseError) ? err : new PreviewProxyError(502, 'Сайт недоступен')
        // Документ в iframe отвечать JSON-ом нельзя: пользователь видел сырой
        // `{"error":"preview_unavailable"}` вместо объяснения. Для кадров отдаём
        // страницу с причиной и кнопкой повтора, для fetch/XHR — прежний JSON.
        const wantsHtml = /document|iframe|frame/i.test(String(req.headers['sec-fetch-dest'] ?? ''))
          || String(req.headers.accept ?? '').includes('text/html')
        if (wantsHtml) {
          return reply.code(known.status).type('text/html; charset=utf-8').send(previewErrorPage(known.message))
        }
        return reply.code(known.status).send({ error: 'preview_unavailable', message: known.message })
      }
    })
  })
}
