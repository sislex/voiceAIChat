import { lookup } from 'node:dns/promises'
import { isIP } from 'node:net'
import { request as httpRequest } from 'node:http'
import { request as httpsRequest } from 'node:https'
import type { IncomingMessage } from 'node:http'
import type { FastifyInstance } from 'fastify'

const MAX_REDIRECTS = 5
const MAX_BYTES = 5 * 1024 * 1024
const TIMEOUT_MS = 10_000

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
const key=(e)=>{if(active&&e.key==='Escape'){e.preventDefault();disable()}};
const enable=()=>{if(active)return;active=true;document.addEventListener('pointerover',move,true);document.addEventListener('click',click,true);document.addEventListener('keydown',key,true)};
const disable=()=>{active=false;selected=null;document.removeEventListener('pointerover',move,true);document.removeEventListener('click',click,true);document.removeEventListener('keydown',key,true);hide()};
const message=(e)=>{if(e.source!==parent||e.origin!==location.origin||!e.data||e.data.type!==COMMAND||typeof e.data.enabled!=='boolean')return;e.data.enabled?enable():disable()};
addEventListener('message',message);addEventListener('pagehide',()=>{disable();removeEventListener('message',message)},{once:true});
})();<\/script>`
}

export function rewritePreviewBody(body: Buffer, type: string, base: URL): Buffer {
  let text = body.toString('utf8')
  if (/text\/html|application\/xhtml\+xml/i.test(type)) {
    text = text.replace(/<meta\b[^>]*http-equiv\s*=\s*(['"]?)content-security-policy\1[^>]*>/gi, '')
      .replace(/\b(href|src|action|poster)\s*=\s*(["'])(.*?)\2/gi, (_m, name, quote, value) => name + '=' + quote + proxyUrl(value, base) + quote)
      .replace(/\bsrcset\s*=\s*(["'])(.*?)\1/gi, (_m, quote, value) => 'srcset=' + quote + value.split(',').map((part: string) => {
        const [url, ...descriptor] = part.trim().split(/\s+/)
        return proxyUrl(url, base) + (descriptor.length ? ' ' + descriptor.join(' ') : '')
      }).join(', ') + quote)
    const inspector = previewInspectorScript()
    text = /<\/body\s*>/i.test(text) ? text.replace(/<\/body\s*>/i, inspector + '</body>') : text + inspector
  }
  if (/text\/css/i.test(type)) text = text.replace(/url\(\s*(['"]?)(.*?)\1\s*\)/gi, (_m, quote, value) => 'url(' + quote + proxyUrl(value, base) + quote + ')')
  return Buffer.from(text)
}

async function get(url: URL): Promise<{ response: IncomingMessage; finalUrl: URL }> {
  await assertPublicHost(url.hostname)
  return new Promise((resolve, reject) => {
    const transport = url.protocol === 'https:' ? httpsRequest : httpRequest
    const request = transport(url, {
      headers: { 'user-agent': 'voiceAIChat-preview/1.0', accept: '*/*' },
      timeout: TIMEOUT_MS,
      lookup(hostname, _opts, callback) {
        void lookup(hostname, { all: true, verbatim: true }).then((addresses) => {
          const address = addresses.find((candidate) => isPublicAddress(candidate.address))
          if (!address || addresses.some((candidate) => !isPublicAddress(candidate.address))) return callback(new Error('blocked address'), '', 4)
          callback(null, address.address, address.family)
        }, (err) => callback(err, '', 4))
      }
    }, (response) => resolve({ response, finalUrl: url }))
    request.once('timeout', () => request.destroy(new PreviewProxyError(504, 'Сайт не ответил вовремя')))
    request.once('error', reject)
    request.end()
  })
}

async function load(url: URL): Promise<{ response: IncomingMessage; finalUrl: URL }> {
  let current = url
  for (let redirects = 0; redirects <= MAX_REDIRECTS; redirects++) {
    const result = await get(current)
    const location = result.response.headers.location
    if (!location || ![301, 302, 303, 307, 308].includes(result.response.statusCode ?? 0)) return result
    result.response.resume()
    if (redirects === MAX_REDIRECTS) throw new PreviewProxyError(502, 'Слишком много перенаправлений')
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
  app.get<{ Querystring: { url?: string } }>('/api/preview', async (req, reply) => {
    let url: URL
    try {
      url = new URL(req.query.url ?? '')
      if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error()
    } catch {
      return reply.code(400).send({ error: 'invalid_url', message: 'Разрешены только HTTP и HTTPS адреса' })
    }
    try {
      const { response, finalUrl } = await load(url)
      const contentType = response.headers['content-type'] ?? 'application/octet-stream'
      const body = await readLimited(response)
      const rewritten = /text\/(html|css)|application\/xhtml\+xml/i.test(contentType) ? rewritePreviewBody(body, contentType, finalUrl) : body
      reply.code(response.statusCode ?? 502)
      for (const [name, value] of Object.entries(response.headers)) {
        if (value === undefined || ['x-frame-options', 'content-security-policy', 'set-cookie', 'content-length', 'connection', 'transfer-encoding'].includes(name.toLowerCase())) continue
        reply.header(name, value)
      }
      reply.header('content-type', contentType)
      reply.header('content-length', String(rewritten.length))
      return reply.send(rewritten)
    } catch (err) {
      const known = err instanceof PreviewProxyError ? err : new PreviewProxyError(502, 'Сайт недоступен')
      return reply.code(known.status).send({ error: 'preview_unavailable', message: known.message })
    }
  })
}
