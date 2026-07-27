import { createHash } from 'node:crypto'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { basename, join, relative } from 'node:path'
import type { KbDocument, KbDocumentKind, KbDocumentSummary, KbFreshness, KbMatchType, KbSearchRequest, KbSearchResult, KbStatus } from '@voicechat/shared'
import type { KbSemanticReranker, KnowledgeBaseService } from './types.js'

interface Chunk { id: string; documentId: string; heading: string; anchor: string; text: string; tokens: string[] }
interface IndexedDocument { document: KbDocument; aliases: string[]; chunks: Chunk[] }
const KINDS = new Set<KbDocumentKind>(['feature','subsystem','protocol','decision','convention','runbook','package'])

function listMarkdown(root: string): string[] {
  if (!existsSync(root)) return []
  const out: string[] = []
  const walk = (dir: string): void => { for (const entry of readdirSync(dir, { withFileTypes: true })) { const path = join(dir, entry.name); if (entry.isDirectory() && entry.name !== 'log') walk(path); else if (entry.isFile() && entry.name.endsWith('.md') && entry.name !== 'README.md') out.push(path) } }
  walk(root); return out.sort()
}
function unquote(value: string): string { return value.trim().replace(/^['"]|['"]$/g, '') }
function frontmatter(text: string): { data: Record<string, string | string[]>; body: string } {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(text); if (!match) return { data: {}, body: text }
  const data: Record<string, string | string[]> = {}; let list: string | null = null
  for (const raw of match[1].split(/\r?\n/)) { const item = /^\s*-\s+(.+)$/.exec(raw); if (item && list && Array.isArray(data[list])) { (data[list] as string[]).push(unquote(item[1])); continue } const pair = /^([A-Za-z_][\w-]*):\s*(.*)$/.exec(raw); if (!pair) continue; list = pair[2] === '' ? pair[1] : null; data[pair[1]] = list ? [] : unquote(pair[2]) }
  return { data, body: text.slice(match[0].length) }
}
function array(data: Record<string, string | string[]>, key: string): string[] { const value = data[key]; return Array.isArray(value) ? value : value ? [value] : [] }
function slug(text: string): string { return text.toLowerCase().trim().replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-|-$/g, '') }
function tokenize(text: string): string[] { return text.toLocaleLowerCase('ru').match(/[\p{L}\p{N}_./:-]+/gu) ?? [] }
function excerpt(text: string, terms: string[]): string { const plain = text.replace(/[`*_>#|]/g, ' ').replace(/\s+/g, ' ').trim(); const lower = plain.toLocaleLowerCase('ru'); const at = terms.reduce((best, term) => { const hit = lower.indexOf(term); return hit >= 0 && (best < 0 || hit < best) ? hit : best }, -1); const start = Math.max(0, (at < 0 ? 0 : at) - 90); return `${start ? '…' : ''}${plain.slice(start, start + 320)}${plain.length > start + 320 ? '…' : ''}` }

function loadDocument(root: string, path: string): IndexedDocument {
  const raw = readFileSync(path, 'utf8'); const { data, body } = frontmatter(raw)
  const sourcePath = `docs/kb/${relative(root, path).replaceAll('\\', '/')}`
  const id = String(data.id ?? relative(root, path).replace(/\.md$/, '').replaceAll('\\', '/'))
  const title = String(data.title ?? /^#\s+(.+)$/m.exec(body)?.[1] ?? basename(path, '.md'))
  const rawKind = String(data.kind ?? (sourcePath.includes('/features/') ? 'feature' : 'subsystem')) as KbDocumentKind
  const kind = KINDS.has(rawKind) ? rawKind : 'subsystem'; const headings: KbDocument['headings'] = []; const chunks: Chunk[] = []
  let heading = title; let anchor = ''; let lines: string[] = []
  const flush = (): void => { const text = lines.join('\n').trim(); if (text) chunks.push({ id: `${id}#${anchor || 'overview'}`, documentId: id, heading, anchor, text, tokens: tokenize(`${heading} ${text}`) }); lines = [] }
  for (const line of body.split(/\r?\n/)) { const h = /^(#{1,4})\s+(.+)$/.exec(line); if (h) { flush(); heading = h[2].trim(); anchor = slug(heading); headings.push({ title: heading, anchor, level: h[1].length }) } else lines.push(line) } flush()
  const freshness: KbFreshness = data.updated ? 'current' : 'unknown'
  const document: KbDocument = { id, title, kind, tags: array(data,'tags'), packages: array(data,'packages'), freshness, sourcePath, updated: typeof data.updated === 'string' ? data.updated : undefined, body, symbols: array(data,'symbols'), protocols: array(data,'protocols'), areas: array(data,'areas'), related: array(data,'related'), headings }
  return { document, aliases: array(data,'aliases'), chunks }
}

export class FileKnowledgeBaseService implements KnowledgeBaseService {
  private readonly documents: IndexedDocument[]; private readonly byId: Map<string, IndexedDocument>; private readonly createdAt = new Date().toISOString(); private readonly version: string
  constructor(root: string, private readonly reranker?: KbSemanticReranker) { this.documents = listMarkdown(root).map((path) => loadDocument(root,path)); this.byId = new Map(this.documents.map((item) => [item.document.id,item])); this.version = createHash('sha256').update(this.documents.map((item) => `${item.document.sourcePath}\0${item.document.body}`).join('\0')).digest('hex').slice(0,12) }
  status(): KbStatus { return { available: this.documents.length > 0, mode:'source', searchMode: this.reranker ? 'hybrid':'lexical', version:this.version, createdAt:this.createdAt, documents:this.documents.length, chunks:this.documents.reduce((n,item)=>n+item.chunks.length,0), staleDocuments:this.documents.filter((item)=>item.document.freshness==='stale').length } }
  topics(): KbDocumentSummary[] { return this.documents.map(({document:d}) => ({ id:d.id,title:d.title,kind:d.kind,tags:d.tags,packages:d.packages,freshness:d.freshness,sourcePath:d.sourcePath })) }
  document(id: string): KbDocument | null { return this.byId.get(id)?.document ?? null }
  async search(request: KbSearchRequest): Promise<KbSearchResult[]> {
    const query=request.query.trim(); if(!query) return []; const queryTokens=[...new Set(tokenize(query))]; const all=this.documents.flatMap(item=>item.chunks.map(chunk=>({item,chunk}))); const df=new Map<string,number>(); for(const term of queryTokens) df.set(term,all.filter(({chunk})=>chunk.tokens.includes(term)).length); const avg=all.reduce((n,{chunk})=>n+chunk.tokens.length,0)/Math.max(1,all.length); const scored: KbSearchResult[]=[]
    for(const {item,chunk} of all){ const d=item.document; if(request.kinds?.length&&!request.kinds.includes(d.kind))continue; if(request.tags?.length&&!request.tags.some(tag=>d.tags.includes(tag)))continue; const q=query.toLocaleLowerCase('ru'); const symbols=d.symbols.map(v=>v.toLocaleLowerCase('ru')); const aliases=[d.id,d.title,...item.aliases].map(v=>v.toLocaleLowerCase('ru')); const paths=d.areas.map(v=>v.toLocaleLowerCase('ru')); const protocols=d.protocols.map(v=>v.toLocaleLowerCase('ru')); const matchTypes:KbMatchType[]=[]; let score=0; if(symbols.includes(q)){score+=12;matchTypes.push('symbol')} if(aliases.includes(q)){score+=10;matchTypes.push('alias')} if(paths.some(v=>v.includes(q))){score+=9;matchTypes.push('path')} if(protocols.some(v=>v.includes(q))){score+=9;matchTypes.push('protocol')} const counts=new Map<string,number>(); for(const token of chunk.tokens)counts.set(token,(counts.get(token)??0)+1); for(const term of queryTokens){const tf=counts.get(term)??0;if(!tf)continue;const freq=df.get(term)??0;const idf=Math.log(1+(all.length-freq+.5)/(freq+.5));score+=idf*(tf*2.2)/(tf+1.2*(.25+.75*chunk.tokens.length/Math.max(1,avg)))} if(score<=0)continue; if(!matchTypes.length)matchTypes.push('lexical'); const primary=matchTypes[0]; scored.push({documentId:d.id,chunkId:chunk.id,title:d.title,heading:chunk.heading,excerpt:excerpt(chunk.text,queryTokens),score:Number(score.toFixed(4)),matchTypes,explanation:primary==='symbol'?'Точное совпадение символа':primary==='path'?'Совпадение пути':primary==='protocol'?'Совпадение протокола':primary==='alias'?'Совпадение названия или псевдонима':'Полнотекстовое совпадение',freshness:d.freshness,sourcePath:d.sourcePath,anchor:chunk.anchor,symbols:d.symbols,relatedFiles:d.areas}) }
    scored.sort((a,b)=>b.score-a.score||a.chunkId.localeCompare(b.chunkId)); const limit=Math.min(Math.max(request.limit??20,1),50); const candidates=scored.slice(0,Math.max(limit,15)); if(!this.reranker||candidates.length<2||candidates[0].score>=9)return candidates.slice(0,limit)
    try { const ids=await this.reranker.rerank(query,candidates.slice(0,15).map(r=>({chunkId:r.chunkId,title:r.title,heading:r.heading,excerpt:r.excerpt})),limit); const rank=new Map(ids.map((id,i)=>[id,i])); return candidates.sort((a,b)=>(rank.get(a.chunkId)??999)-(rank.get(b.chunkId)??999)||b.score-a.score).slice(0,limit).map(result=>rank.has(result.chunkId)?{...result,matchTypes:[...result.matchTypes,'semantic'],explanation:`${result.explanation}; подтверждено LLM-reranking`}:result) } catch { return candidates.slice(0,limit) }
  }
  async context(query:string,budget=3500){const results=await this.search({query,limit:8});const sections:KbSearchResult[]=[];let estimatedTokens=0;for(const result of results){const cost=Math.ceil(result.excerpt.length/4);if(sections.length>=5||estimatedTokens+cost>Math.max(200,budget))break;sections.push(result);estimatedTokens+=cost}const top=sections[0];const exact=top?.matchTypes.some(type=>['symbol','alias','path','protocol'].includes(type))??false;const gap=top&&sections[1]?top.score-sections[1].score:top?.score??0;const confidence:'high'|'medium'|'low'=!top?'low':exact||(top.score>=5&&gap>=1.5)?'high':top.score>=1?'medium':'low';return{query,confidence,autoInjectAllowed:confidence==='high',sections,relatedFiles:[...new Set(sections.flatMap(r=>r.relatedFiles))],relatedDocuments:[...new Set(sections.map(r=>r.documentId))],staleWarnings:sections.filter(r=>r.freshness==='stale').map(r=>`${r.title} требует сверки`),estimatedTokens}}
}
