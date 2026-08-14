import { lookup } from 'node:dns/promises'
import type { LookupAddress } from 'node:dns'
import { isIP } from 'node:net'
import { request as httpRequest } from 'node:http'
import { request as httpsRequest } from 'node:https'
import type { IncomingMessage } from 'node:http'
import type { FastifyInstance } from 'fastify'
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
if(typeof navigator.sendBeacon==='function')try{const nativeBeacon=navigator.sendBeacon.bind(navigator);navigator.sendBeacon=function(url,data){return arguments.length>1?nativeBeacon(toProxy(String(url)),data):nativeBeacon(toProxy(String(url)))}}catch{}
try{const nativeAssign=location.assign.bind(location);Object.defineProperty(location,'assign',{configurable:true,value:(value)=>nativeAssign(toProxy(String(value)))})}catch{}
try{const nativeLocReplace=location.replace.bind(location);Object.defineProperty(location,'replace',{configurable:true,value:(value)=>nativeLocReplace(toProxy(String(value)))})}catch{}
try{const hrefDescriptor=Object.getOwnPropertyDescriptor(location,'href');if(hrefDescriptor&&hrefDescriptor.set&&hrefDescriptor.configurable){const setHref=hrefDescriptor.set.bind(location),getHref=hrefDescriptor.get?hrefDescriptor.get.bind(location):()=>String(location);Object.defineProperty(location,'href',{configurable:true,get:getHref,set:(value)=>setHref(toProxy(String(value)))})}}catch{}
if(window.history)try{const nativePush=history.pushState.bind(history),nativeReplaceState=history.replaceState.bind(history);
history.pushState=(state,title,url)=>nativePush(state,title,url==null?url:toProxy(String(url)));
history.replaceState=(state,title,url)=>nativeReplaceState(state,title,url==null?url:toProxy(String(url)))}catch{}
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
const ACTION='voicechat.preview.action.v1', RESULT='voicechat.preview.action-result.v1', RECORD='voicechat.preview.record.v1';
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
let recording=false;
const sensitive=(el)=>el.localName==='input'&&(el.type==='password'||el.autocomplete==='current-password'||el.autocomplete==='new-password'||/pass|secret|token|card|cvv/i.test((el.name||'')+' '+(el.id||'')));
const record=(step)=>{if(recording)parent.postMessage({type:RECORD,step},location.origin)};
const recordClick=(e)=>{const el=e.target instanceof Element?clickTarget(e.target):null;if(el&&!el.closest('[data-voicechat-inspector]'))record({kind:'click',selector:uniqueSelector(el),text:textOf(el).slice(0,EL_TEXT)})};
const recordInput=(e)=>{const el=e.target instanceof Element?e.target:null;if(!el||!el.matches('input,textarea,select,[contenteditable=true]'))return;record({kind:'type',selector:uniqueSelector(el),text:sensitive(el)?'':String(el.value===undefined?el.textContent||'':el.value).slice(0,2000),sensitive:sensitive(el)})};
const setRecording=(enabled)=>{if(recording===enabled)return;recording=enabled;if(enabled){document.addEventListener('click',recordClick,true);document.addEventListener('input',recordInput,true)}else{document.removeEventListener('click',recordClick,true);document.removeEventListener('input',recordInput,true)}};
const message=(e)=>{
  if(e.source!==parent||e.origin!==location.origin||!e.data)return;
  if(e.data.type===COMMAND&&typeof e.data.enabled==='boolean'){e.data.enabled?enable():disable();return}
  if(e.data.type===RECORD&&typeof e.data.enabled==='boolean'){setRecording(e.data.enabled);return}
  if(e.data.type===ACTION&&typeof e.data.requestId==='string'&&e.data.action&&typeof e.data.action.kind==='string'){
    try{reply(e.data.requestId,true,run(e.data.action))}
    catch(err){reply(e.data.requestId,false,err&&err.message||err)}
  }
};
addEventListener('message',message);addEventListener('pagehide',()=>{disable();setRecording(false);removeEventListener('message',message)},{once:true});
})();<\/script>`
}

export function rewritePreviewBody(body: Buffer, type: string, base: URL): Buffer {
  let text = body.toString('utf8')
  const rewriteCssUrls = (css: string): string => css.replace(/url\(\s*(['"]?)(.*?)\1\s*\)/gi, (_m, quote, value) => 'url(' + quote + proxyUrl(value, base) + quote + ')')
  if (/text\/html|application\/xhtml\+xml/i.test(type)) {
    text = text.replace(/<meta\b[^>]*http-equiv\s*=\s*(['"]?)content-security-policy\1[^>]*>/gi, '')
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
 */
const DROPPED_REQUEST_HEADERS = new Set(['host', 'connection', 'content-length', 'transfer-encoding', 'keep-alive', 'upgrade', 'te', 'trailer', 'expect', 'cookie', 'authorization', 'proxy-authorization', 'accept-encoding', 'origin', 'referer', 'via', 'priority'])

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

export function registerPreviewProxy(app: FastifyInstance): void {
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
        const userId = uid(req)
        const body = (typeof req.body === 'string' || Buffer.isBuffer(req.body)) && req.method !== 'GET' && req.method !== 'HEAD' ? req.body : undefined
        const { response, finalUrl } = await load(url, userId, req.method, body, upstreamRequestHeaders(req.headers))
        storeResponseCookies(userId, finalUrl, response.headers['set-cookie'])
        const responseType = response.headers['content-type'] ?? 'application/octet-stream'
        const responseBody = await readLimited(response)
        const rewritten = /text\/(html|css)|application\/xhtml\+xml/i.test(responseType) ? rewritePreviewBody(responseBody, responseType, finalUrl) : responseBody
        reply.code(response.statusCode ?? 502)
        for (const [name, value] of Object.entries(response.headers)) {
          if (value === undefined || ['x-frame-options', 'content-security-policy', 'set-cookie', 'content-length', 'connection', 'transfer-encoding'].includes(name.toLowerCase())) continue
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
