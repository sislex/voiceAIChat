// Ядро базы знаний: разбор Markdown в документы с разделами, BM25-поиск по ним и
// сборка контекстного бандла. Вынесено из service.ts, потому что источников
// документов теперь два: файлы репозитория (раздел «Использование») и статьи из
// БД (разделы «Настройки пользователя» и «Разработка проекта»). Индекс один на
// оба источника — иначе оценки BM25 из разных индексов несравнимы, и выдача
// перемешивалась бы случайным образом.

import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { basename, join, relative } from 'node:path'
import type { KbContextBundle, KbDocument, KbDocumentKind, KbDocumentSummary, KbFreshness, KbMatchType, KbScope, KbSearchRequest, KbSearchResult } from '@voicechat/shared'
import type { KbSemanticReranker } from './types.js'

export interface Chunk { id: string; documentId: string; heading: string; anchor: string; text: string; tokens: string[] }
export interface IndexedDocument { document: KbDocument; aliases: string[]; chunks: Chunk[] }
const KINDS = new Set<KbDocumentKind>(['feature','subsystem','protocol','decision','convention','runbook','package'])

export function listMarkdown(root: string): string[] {
  if (!existsSync(root)) return []
  const out: string[] = []
  const walk = (dir: string): void => { for (const entry of readdirSync(dir, { withFileTypes: true })) { const path = join(dir, entry.name); if (entry.isDirectory() && entry.name !== 'log') walk(path); else if (entry.isFile() && entry.name.endsWith('.md') && entry.name !== 'README.md') out.push(path) } }
  walk(root); return out.sort()
}
function unquote(value: string): string { return value.trim().replace(/^['"]|['"]$/g, '') }
export function frontmatter(text: string): { data: Record<string, string | string[]>; body: string } {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(text); if (!match) return { data: {}, body: text }
  const data: Record<string, string | string[]> = {}; let list: string | null = null
  for (const raw of match[1].split(/\r?\n/)) { const item = /^\s*-\s+(.+)$/.exec(raw); if (item && list && Array.isArray(data[list])) { (data[list] as string[]).push(unquote(item[1])); continue } const pair = /^([A-Za-z_][\w-]*):\s*(.*)$/.exec(raw); if (!pair) continue; list = pair[2] === '' ? pair[1] : null; data[pair[1]] = list ? [] : unquote(pair[2]) }
  return { data, body: text.slice(match[0].length) }
}
function array(data: Record<string, string | string[]>, key: string): string[] { const value = data[key]; return Array.isArray(value) ? value : value ? [value] : [] }
export function slug(text: string): string { return text.toLowerCase().trim().replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-|-$/g, '') }
export function tokenize(text: string): string[] { return text.toLocaleLowerCase('ru').match(/[\p{L}\p{N}_./:-]+/gu) ?? [] }
function excerpt(text: string, terms: string[]): string { const plain = text.replace(/[`*_>#|]/g, ' ').replace(/\s+/g, ' ').trim(); const lower = plain.toLocaleLowerCase('ru'); const at = terms.reduce((best, term) => { const hit = lower.indexOf(term); return hit >= 0 && (best < 0 || hit < best) ? hit : best }, -1); const start = Math.max(0, (at < 0 ? 0 : at) - 90); return `${start ? '…' : ''}${plain.slice(start, start + 320)}${plain.length > start + 320 ? '…' : ''}` }

/** Метаданные документа без тела: общая часть файлового и «БД»-источника. */
export interface DocumentMeta {
  id: string; title: string; kind: KbDocumentKind; scope: KbScope; projectId?: string | null
  sourcePath: string; tags?: string[]; packages?: string[]; symbols?: string[]; protocols?: string[]
  areas?: string[]; related?: string[]; aliases?: string[]; updated?: string; freshness?: KbFreshness
  editable?: boolean
}

/** Разбор тела в разделы (chunks) + заголовки: один алгоритм на оба источника. */
export function indexBody(meta: DocumentMeta, body: string): IndexedDocument {
  const headings: KbDocument['headings'] = []; const chunks: Chunk[] = []
  let heading = meta.title; let anchor = ''; let lines: string[] = []
  const flush = (): void => { const text = lines.join('\n').trim(); if (text) chunks.push({ id: `${meta.id}#${anchor || 'overview'}`, documentId: meta.id, heading, anchor, text, tokens: tokenize(`${heading} ${text}`) }); lines = [] }
  for (const line of body.split(/\r?\n/)) { const h = /^(#{1,4})\s+(.+)$/.exec(line); if (h) { flush(); heading = h[2].trim(); anchor = slug(heading); headings.push({ title: heading, anchor, level: h[1].length }) } else lines.push(line) } flush()
  const document: KbDocument = {
    id: meta.id, title: meta.title, kind: meta.kind, scope: meta.scope, projectId: meta.projectId ?? null,
    tags: meta.tags ?? [], packages: meta.packages ?? [], freshness: meta.freshness ?? (meta.updated ? 'current' : 'unknown'),
    sourcePath: meta.sourcePath, ...(meta.updated ? { updated: meta.updated } : {}), body,
    symbols: meta.symbols ?? [], protocols: meta.protocols ?? [], areas: meta.areas ?? [], related: meta.related ?? [],
    headings, ...(meta.editable ? { editable: true } : {})
  }
  return { document, aliases: meta.aliases ?? [], chunks }
}

/** Файловая тема docs/kb/*.md. Такие статьи — раздел «Использование»: общие для всех. */
export function loadDocument(root: string, path: string): IndexedDocument {
  const raw = readFileSync(path, 'utf8'); const { data, body } = frontmatter(raw)
  const sourcePath = `docs/kb/${relative(root, path).replaceAll('\\', '/')}`
  const id = String(data.id ?? relative(root, path).replace(/\.md$/, '').replaceAll('\\', '/'))
  const title = String(data.title ?? /^#\s+(.+)$/m.exec(body)?.[1] ?? basename(path, '.md'))
  const rawKind = String(data.kind ?? (sourcePath.includes('/features/') ? 'feature' : 'subsystem')) as KbDocumentKind
  const kind = KINDS.has(rawKind) ? rawKind : 'subsystem'
  return indexBody({
    id, title, kind, scope: 'usage', sourcePath, tags: array(data,'tags'), packages: array(data,'packages'),
    symbols: array(data,'symbols'), protocols: array(data,'protocols'), areas: array(data,'areas'),
    related: array(data,'related'), aliases: array(data,'aliases'),
    ...(typeof data.updated === 'string' ? { updated: data.updated } : {})
  }, body)
}

export function summaryOf(d: KbDocument): KbDocumentSummary {
  return { id: d.id, title: d.title, kind: d.kind, tags: d.tags, packages: d.packages, freshness: d.freshness, sourcePath: d.sourcePath, scope: d.scope, projectId: d.projectId ?? null, ...(d.editable ? { editable: true } : {}) }
}

/**
 * BM25-поиск по набору документов. Набор приходит УЖЕ отфильтрованным по доступу:
 * df и средняя длина считаются только по видимым разделам, иначе оценки зависели
 * бы от чужих статей (и косвенно их выдавали).
 */
export async function searchDocuments(documents: IndexedDocument[], request: KbSearchRequest, reranker?: KbSemanticReranker): Promise<KbSearchResult[]> {
  const query=request.query.trim(); if(!query) return []; const queryTokens=[...new Set(tokenize(query))]; const all=documents.flatMap(item=>item.chunks.map(chunk=>({item,chunk}))); const df=new Map<string,number>(); for(const term of queryTokens) df.set(term,all.filter(({chunk})=>chunk.tokens.includes(term)).length); const avg=all.reduce((n,{chunk})=>n+chunk.tokens.length,0)/Math.max(1,all.length); const scored: KbSearchResult[]=[]
  for(const {item,chunk} of all){ const d=item.document; if(request.kinds?.length&&!request.kinds.includes(d.kind))continue; if(request.tags?.length&&!request.tags.some(tag=>d.tags.includes(tag)))continue; const q=query.toLocaleLowerCase('ru'); const symbols=d.symbols.map(v=>v.toLocaleLowerCase('ru')); const aliases=[d.id,d.title,...item.aliases].map(v=>v.toLocaleLowerCase('ru')); const paths=d.areas.map(v=>v.toLocaleLowerCase('ru')); const protocols=d.protocols.map(v=>v.toLocaleLowerCase('ru')); const matchTypes:KbMatchType[]=[]; let score=0; if(symbols.includes(q)){score+=12;matchTypes.push('symbol')} if(aliases.includes(q)){score+=10;matchTypes.push('alias')} if(paths.some(v=>v.includes(q))){score+=9;matchTypes.push('path')} if(protocols.some(v=>v.includes(q))){score+=9;matchTypes.push('protocol')} const counts=new Map<string,number>(); for(const token of chunk.tokens)counts.set(token,(counts.get(token)??0)+1); for(const term of queryTokens){const tf=counts.get(term)??0;if(!tf)continue;const freq=df.get(term)??0;const idf=Math.log(1+(all.length-freq+.5)/(freq+.5));score+=idf*(tf*2.2)/(tf+1.2*(.25+.75*chunk.tokens.length/Math.max(1,avg)))} if(score<=0)continue; if(!matchTypes.length)matchTypes.push('lexical'); const primary=matchTypes[0]; scored.push({documentId:d.id,chunkId:chunk.id,title:d.title,heading:chunk.heading,excerpt:excerpt(chunk.text,queryTokens),score:Number(score.toFixed(4)),matchTypes,explanation:primary==='symbol'?'Точное совпадение символа':primary==='path'?'Совпадение пути':primary==='protocol'?'Совпадение протокола':primary==='alias'?'Совпадение названия или псевдонима':'Полнотекстовое совпадение',freshness:d.freshness,sourcePath:d.sourcePath,anchor:chunk.anchor,symbols:d.symbols,relatedFiles:d.areas,scope:d.scope,projectId:d.projectId??null}) }
  scored.sort((a,b)=>b.score-a.score||a.chunkId.localeCompare(b.chunkId)); const limit=Math.min(Math.max(request.limit??20,1),50); const candidates=scored.slice(0,Math.max(limit,15)); if(!reranker||candidates.length<2||candidates[0].score>=9)return candidates.slice(0,limit)
  try { const ids=await reranker.rerank(query,candidates.slice(0,15).map(r=>({chunkId:r.chunkId,title:r.title,heading:r.heading,excerpt:r.excerpt})),limit); const rank=new Map(ids.map((id,i)=>[id,i])); return candidates.sort((a,b)=>(rank.get(a.chunkId)??999)-(rank.get(b.chunkId)??999)||b.score-a.score).slice(0,limit).map(result=>rank.has(result.chunkId)?{...result,matchTypes:[...result.matchTypes,'semantic'],explanation:`${result.explanation}; подтверждено LLM-reranking`}:result) } catch { return candidates.slice(0,limit) }
}

/** Бандл контекста из готовой выдачи: бюджет символов и оценка уверенности. */
export function buildContext(query: string, results: KbSearchResult[], budget = 3500): KbContextBundle {
  const sections:KbSearchResult[]=[];let estimatedTokens=0;for(const result of results){const cost=Math.ceil(result.excerpt.length/4);if(sections.length>=5||estimatedTokens+cost>Math.max(200,budget))break;sections.push(result);estimatedTokens+=cost}const top=sections[0];const exact=top?.matchTypes.some(type=>['symbol','alias','path','protocol'].includes(type))??false;const gap=top&&sections[1]?top.score-sections[1].score:top?.score??0;const confidence:'high'|'medium'|'low'=!top?'low':exact||(top.score>=5&&gap>=1.5)?'high':top.score>=1?'medium':'low';return{query,confidence,autoInjectAllowed:confidence==='high',sections,relatedFiles:[...new Set(sections.flatMap(r=>r.relatedFiles))],relatedDocuments:[...new Set(sections.map(r=>r.documentId))],staleWarnings:sections.filter(r=>r.freshness==='stale').map(r=>`${r.title} требует сверки`),estimatedTokens}
}
