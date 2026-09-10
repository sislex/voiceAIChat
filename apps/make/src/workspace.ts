// Make project working directories at <dataDir>/make/<conversationId>/ contain static project files
// and .snapshots/ revisions. This is the single disk-access boundary for REST routes and assistant
// MCP tools, enforcing quotas and rejecting parent traversal, hidden segments, and symlinks
// escaping the project. rev is an in-memory refresh counter for open previews, not a durable
// version.

import { createHash, randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { cp, lstat, mkdir, readdir, readFile, rename, rm, rmdir, stat, writeFile, statfs } from 'node:fs/promises'
import { dirname, join, resolve, sep } from 'node:path'
import {
  MAKE_LIMITS, MAKE_SCAFFOLD, MAKE_TEMPLATES, MAKE_STACK_HINTS, MAKE_UI_KIT_HINTS, applyMakeUiKit, isMakeTemplateCompatible, normalizeMakeStack, normalizeMakeUiKit, detectPwaMeta, injectPwaIntoHtml, pwaFiles, isMakeTextPath, isMakeTestPath, isValidMakeSlug, makePublicUrl, makeSlugUrl, makeSharedUrl, normalizeMakePath,
  type MakeCheckIssue, type MakeFileContent, type MakeFileInfo, type MakeProjectState, type MakePublication, type MakeSnapshot, isMakeStoriesPath, isMakeTranspiledPath } from '@voicechat/shared'
import { parseStoryFile, parseTestFile } from './stories.js'
import { compileDiagnostics } from './transpile.js'
import type {
  MakeProjectLink, AdminDiskStats, MakePublicComment, MakeSearchMatch, MakeStoryFile, MakeStoryShot, MakeSnapshotDiff, MakeSnapshotDiffEntry, MakeImportMode, MockResponse, MakeUsage, MakeCleanupOptions, MakeCleanupResult, MakeComment, MakeShare, MakeShareGrant, MakeShareRole, MakePublishEntry, MakeTestFile, MakeProjectNotes, MakeAssistantMode, AdminMakeStats, AdminMakeProjectStat, AdminMakeUserStat } from '@voicechat/shared'
import { lintMakeFile, addComponentImports, componentExports, pickEntryFile, type AutoImportSpec } from '@voicechat/shared'
import { MAKE_DISK_ALERT_BYTES, deployConfigFiles, type MakeDeployTarget } from '@voicechat/shared'
import { buildMakeSearchRegex, previewMakeReplace, type MakeReplacePreviewLine, type MakeSearchOptions } from '@voicechat/shared'
import { MAKE_MODE_HINTS, applyAuthMock, applyCollectionRequest, collectionCandidates, isAuthMock, isMockCollection, mockCandidates, unwrapMockEnvelope, parseCssTokens, pickTokensFile, setCssToken } from '@voicechat/shared'
import { buildStoredZip } from './zip.js'

export type MakeErrorCode = 'invalid_id' | 'invalid_path' | 'not_found' | 'too_large' | 'too_many_files' | 'not_text' | 'exists' | 'quota'

export class MakeError extends Error {
  constructor(readonly code: MakeErrorCode, message: string) {
    super(message)
    this.name = 'MakeError'
  }
}

const SNAPSHOTS_DIR = '.snapshots'
/** Project publication file in its root and the shared token-to-conversation index. */
const PUBLISH_FILE = '.publish.json'
const COMMENTS_FILE = '.comments.json'
/** Links between workshop files and project repository files for project pull/push. */
const PROJECT_LINKS_FILE = '.project-links.json'

/** Referrer host for publication analytics; empty, invalid, or direct requests return null. */
export function refererHost(referer?: string | null): string | null {
  if (!referer) return null
  try { const h = new URL(referer).hostname.toLowerCase(); return h && h !== 'localhost' ? h : null } catch { return null }
}
const SHARE_FILE = '.share.json'
const NOTES_DIR = '.make'
/** Contents of .publish.json; passwordHash has the form <salt>:<sha256(salt:password)>. */
interface PublishRaw { token: string; allowComments?: boolean; publishedAt?: number; snapshotId?: string | null; snapshotLabel?: string | null; slug?: string | null; passwordHash?: string | null; views?: number; history?: MakePublishEntry[]; days?: Record<string, number>; referers?: Record<string, number> }
const SHOTS_DIR = '.shots'
const SHOTS_PER_STORY = 10
const PUBLISHED_INDEX_DIR = '.published'
const ID_RE = /^[A-Za-z0-9_-]{1,80}$/

interface SnapshotMeta { id: string; createdAt: number; label: string; files: number }

/**
 * Resolve a project file link relative to dir. Normalize . and .. segments and treat /x as relative
 * to the project root. Return null for invalid links or paths escaping the root, and undefined for
 * normalized empty links that need no check.
 */
function resolveRelativeRef(dir: string, value: string): string | null | undefined {
  const raw = value.startsWith('/') ? value.slice(1) : dir ? `${dir}/${value}` : value
  const out: string[] = []
  for (const part of raw.split('/')) {
    if (!part || part === '.') continue
    if (part === '..') { if (out.length === 0) return null; out.pop(); continue }
    out.push(part)
  }
  if (out.length === 0) return undefined
  return normalizeMakePath(out.join('/'))
}

export class MakeWorkspaces {
  private readonly revs = new Map<string, number>()

  constructor(private readonly rootDir: string, private readonly limits: { maxUserBytes: number } = { maxUserBytes: MAKE_LIMITS.maxUserBytes }) {}

  /** All projects owned by this conversation's owner for per-user quotas; null means the owner is unknown. */
  private projectsOfOwner: ((conversationId: string) => Promise<string[] | null>) | null = null
  private readonly userBytesCache = new Map<string, { bytes: number; at: number }>()

  setProjectsOfOwner(fn: (conversationId: string) => Promise<string[] | null>): void { this.projectsOfOwner = fn }

  /** Total bytes across the owner's projects, cached for 60 seconds because traversing directories on every write is too expensive. */
  async ownerBytes(conversationId: string): Promise<{ bytes: number; projects: number } | null> {
    const ids = await this.projectsOfOwner?.(conversationId)
    if (!ids) return null
    const key = [...ids].sort().join(',')
    const hit = this.userBytesCache.get(key)
    if (hit && Date.now() - hit.at < 60_000) return { bytes: hit.bytes, projects: ids.length }
    let bytes = 0
    for (const id of ids) { try { bytes += (await this.usage(id)).totalBytes } catch { /* Do not count skipped projects. */ } }
    this.userBytesCache.set(key, { bytes, at: Date.now() })
    return { bytes, projects: ids.length }
  }

  private async assertUserQuota(conversationId: string, deltaBytes: number): Promise<void> {
    if (deltaBytes <= 0) return
    const owner = await this.ownerBytes(conversationId)
    if (owner && owner.bytes + deltaBytes > this.limits.maxUserBytes) {
      throw new MakeError('quota', `Все ваши проекты Make заняли ${Math.round(owner.bytes / 1048576)} МБ из ${Math.round(this.limits.maxUserBytes / 1048576)} — очистите снимки или удалите старые проекты`)
    }
    this.userBytesCache.clear()
  }

  /** Conversation project root; validate the ID to prevent forged directory names. */
  dirOf(conversationId: string): string {
    if (!ID_RE.test(conversationId)) throw new MakeError('invalid_id', 'Некорректный id разговора')
    return join(this.rootDir, 'make', conversationId)
  }

  /** Resolve an absolute path inside the project or throw; reject symlinks escaping the project. */
  private async resolveFile(conversationId: string, rawPath: string): Promise<{ path: string; abs: string }> {
    const path = normalizeMakePath(rawPath)
    if (!path) throw new MakeError('invalid_path', `Недопустимый путь файла: «${rawPath}»`)
    const root = resolve(this.dirOf(conversationId))
    const abs = resolve(root, ...path.split('/'))
    if (abs !== root && !abs.startsWith(root + sep)) throw new MakeError('invalid_path', 'Путь выходит за пределы проекта')
    // No existing path segment may be a symlink, or a/b could resolve outside the project.
    let cursor = root
    for (const part of path.split('/')) {
      cursor = join(cursor, part)
      try {
        const st = await lstat(cursor)
        if (st.isSymbolicLink()) throw new MakeError('invalid_path', 'Символические ссылки в проекте запрещены')
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') break
        throw error
      }
    }
    return { path, abs }
  }

  rev(conversationId: string): number {
    return this.revs.get(conversationId) ?? 0
  }

  private bump(conversationId: string): number {
    const next = this.rev(conversationId) + 1
    this.revs.set(conversationId, next)
    return next
  }

  /** Create a starter project if its directory is missing or empty. */
  async ensure(conversationId: string): Promise<void> {
    const dir = this.dirOf(conversationId)
    await mkdir(join(dir, SNAPSHOTS_DIR), { recursive: true })
    const files = await this.list(conversationId)
    if (files.length > 0) return
    for (const [path, content] of Object.entries(MAKE_SCAFFOLD)) {
      await writeFile(join(dir, ...path.split('/')), content, 'utf8')
    }
  }

  async list(conversationId: string): Promise<MakeFileInfo[]> {
    const root = this.dirOf(conversationId)
    if (!existsSync(root)) return []
    const out: MakeFileInfo[] = []
    const walk = async (dir: string, prefix: string): Promise<void> => {
      const entries = await readdir(dir, { withFileTypes: true })
      for (const entry of entries) {
        if (entry.name.startsWith('.')) continue
        const rel = prefix ? `${prefix}/${entry.name}` : entry.name
        if (entry.isDirectory()) { await walk(join(dir, entry.name), rel); continue }
        if (!entry.isFile()) continue
        const st = await stat(join(dir, entry.name))
        out.push({ path: rel, size: st.size, updatedAt: Math.round(st.mtimeMs) })
      }
    }
    await walk(root, '')
    return out.sort((a, b) => a.path.localeCompare(b.path, 'ru'))
  }

  async read(conversationId: string, rawPath: string): Promise<MakeFileContent> {
    const { path, abs } = await this.resolveFile(conversationId, rawPath)
    if (!isMakeTextPath(path)) throw new MakeError('not_text', `Файл «${path}» не текстовый — откройте его в превью`)
    let st
    try { st = await stat(abs) } catch { throw new MakeError('not_found', `Файл «${path}» не найден`) }
    if (!st.isFile()) throw new MakeError('not_found', `Файл «${path}» не найден`)
    const content = await readFile(abs, 'utf8')
    return { path, size: st.size, updatedAt: Math.round(st.mtimeMs), content }
  }

  /** Read any file as bytes for previews; return null when it does not exist. */
  async readBuffer(conversationId: string, rawPath: string): Promise<{ path: string; data: Buffer } | null> {
    const { path, abs } = await this.resolveFile(conversationId, rawPath)
    try {
      const st = await stat(abs)
      if (!st.isFile()) return null
      return { path, data: await readFile(abs) }
    } catch {
      return null
    }
  }

  async write(conversationId: string, rawPath: string, content: string): Promise<MakeProjectState> {
    return this.writeBuffer(conversationId, rawPath, Buffer.from(content, 'utf8'))
  }

  /** Write binary uploads, such as images and fonts, with the same limits as text files. */
  async writeBuffer(conversationId: string, rawPath: string, content: Buffer): Promise<MakeProjectState> {
    const { path, abs } = await this.resolveFile(conversationId, rawPath)
    if (content.byteLength > MAKE_LIMITS.maxFileBytes) {
      throw new MakeError('too_large', `Файл «${path}» больше ${Math.round(MAKE_LIMITS.maxFileBytes / 1024)} КБ`)
    }
    const files = await this.list(conversationId)
    if (!files.some((f) => f.path === path) && files.length >= MAKE_LIMITS.maxFiles) {
      throw new MakeError('too_many_files', `В проекте уже ${MAKE_LIMITS.maxFiles} файлов`)
    }
    // Project quota (item 30) includes snapshots and story PNGs, which can quietly consume disk
    // space.
    const prev = files.find((f) => f.path === path)?.size ?? 0
    const usage = await this.usage(conversationId)
    if (usage.totalBytes - prev + content.byteLength > MAKE_LIMITS.maxProjectBytes) {
      throw new MakeError('quota', `Проект занял ${Math.round(usage.totalBytes / 1048576)} МБ из ${Math.round(MAKE_LIMITS.maxProjectBytes / 1048576)} — очистите снимки в «Место»`)
    }
    await this.assertUserQuota(conversationId, content.byteLength - prev)
    await mkdir(dirname(abs), { recursive: true })
    await writeFile(abs, content)
    this.bump(conversationId)
    return this.state(conversationId)
  }

  async delete(conversationId: string, rawPath: string): Promise<MakeProjectState> {
    const { path, abs } = await this.resolveFile(conversationId, rawPath)
    try {
      const st = await stat(abs)
      if (!st.isFile()) throw new MakeError('not_found', `Файл «${path}» не найден`)
    } catch (error) {
      if (error instanceof MakeError) throw error
      throw new MakeError('not_found', `Файл «${path}» не найден`)
    }
    await rm(abs)
    await this.pruneEmptyDirs(conversationId, dirname(abs))
    this.bump(conversationId)
    return this.state(conversationId)
  }

  async rename(conversationId: string, rawFrom: string, rawTo: string): Promise<MakeProjectState> {
    const from = await this.resolveFile(conversationId, rawFrom)
    const to = await this.resolveFile(conversationId, rawTo)
    if (!existsSync(from.abs)) throw new MakeError('not_found', `Файл «${from.path}» не найден`)
    if (existsSync(to.abs)) throw new MakeError('exists', `Файл «${to.path}» уже существует`)
    await mkdir(dirname(to.abs), { recursive: true })
    await rename(from.abs, to.abs)
    await this.pruneEmptyDirs(conversationId, dirname(from.abs))
    this.bump(conversationId)
    return this.state(conversationId)
  }

  /** Remove empty ancestor directories up to, but excluding, the project root. */
  private async pruneEmptyDirs(conversationId: string, dir: string): Promise<void> {
    const root = resolve(this.dirOf(conversationId))
    let cursor = resolve(dir)
    while (cursor !== root && cursor.startsWith(root + sep)) {
      const entries = await readdir(cursor).catch(() => null)
      if (!entries || entries.length > 0) return
      await rmdir(cursor).catch(() => undefined)
      cursor = dirname(cursor)
    }
  }

  async snapshots(conversationId: string): Promise<MakeSnapshot[]> {
    const dir = join(this.dirOf(conversationId), SNAPSHOTS_DIR)
    if (!existsSync(dir)) return []
    const ids = await readdir(dir)
    const out: MakeSnapshot[] = []
    for (const id of ids) {
      try {
        const meta = JSON.parse(await readFile(join(dir, id, 'meta.json'), 'utf8')) as SnapshotMeta
        out.push({ id: meta.id, createdAt: meta.createdAt, label: meta.label, files: meta.files })
      } catch { /* Skip corrupt snapshots. */ }
    }
    return out.sort((a, b) => b.createdAt - a.createdAt)
  }

  // Project memory and assistant mode (roadmap-4, items 6-7): .make/notes.md and
  // .make/settings.json.

  async notes(conversationId: string): Promise<MakeProjectNotes> {
    const dir = join(this.dirOf(conversationId), NOTES_DIR)
    const notes = await readFile(join(dir, 'notes.md'), 'utf8').catch(() => '')
    let mode: MakeAssistantMode = 'balanced'
    let stack: MakeProjectNotes['stack'] = 'html-js'
    let uiKit: MakeProjectNotes['uiKit'] = 'none'
    try {
      const s = JSON.parse(await readFile(join(dir, 'settings.json'), 'utf8')) as { mode?: unknown; stack?: unknown; uiKit?: unknown }
      if (s.mode === 'designer' || s.mode === 'developer') mode = s.mode
      stack = normalizeMakeStack(s.stack)
      uiKit = normalizeMakeUiKit(s.uiKit)
    } catch { /* Safe defaults for missing or corrupt settings. */ }
    return { notes, mode, stack, uiKit }
  }

  async setNotes(conversationId: string, patch: Partial<MakeProjectNotes>): Promise<MakeProjectNotes> {
    const dir = join(this.dirOf(conversationId), NOTES_DIR)
    await mkdir(dir, { recursive: true })
    const cur = await this.notes(conversationId)
    const next: MakeProjectNotes = {
      notes: (typeof patch.notes === 'string' ? patch.notes : cur.notes).slice(0, 20_000),
      mode: patch.mode === 'designer' || patch.mode === 'developer' || patch.mode === 'balanced' ? patch.mode : cur.mode,
      stack: patch.stack === undefined ? cur.stack : normalizeMakeStack(patch.stack),
      uiKit: patch.uiKit === undefined ? cur.uiKit : normalizeMakeUiKit(patch.uiKit)
    }
    await writeFile(join(dir, 'notes.md'), next.notes, 'utf8')
    await writeFile(join(dir, 'settings.json'), JSON.stringify({ mode: next.mode, stack: next.stack, uiKit: next.uiKit }), 'utf8')
    return next
  }

  /** Append a dated note through the make_remember tool. */
  async appendNote(conversationId: string, line: string): Promise<MakeProjectNotes> {
    const cur = await this.notes(conversationId)
    const stamp = new Date().toISOString().slice(0, 10)
    return this.setNotes(conversationId, { notes: `${cur.notes.trimEnd()}${cur.notes.trim() ? '\n' : ''}- ${stamp}: ${line.trim().slice(0, 500)}\n` })
  }

  // Component tests (roadmap-4, item 3).

  async tests(conversationId: string): Promise<MakeTestFile[]> {
    const files = await this.list(conversationId)
    const paths = new Set(files.map((f) => f.path))
    const out: MakeTestFile[] = []
    for (const f of files) {
      if (!isMakeTestPath(f.path) || f.size > 256 * 1024) continue
      const buf = await this.readBuffer(conversationId, f.path).catch(() => null)
      if (buf) out.push(parseTestFile(f.path, buf.data.toString('utf8'), paths))
    }
    return out.sort((a, b) => a.path.localeCompare(b.path))
  }

  // Transactional edits and patches (roadmap-4, items 1-2).

  /**
   * Write several files as one operation. If post-write checks find a compilation error in any of
   * them, restore every written or deleted file and return the issues, preventing the model from
   * leaving a partially working project.
   */
  async applyChanges(conversationId: string, files: Array<{ path: string; content: string }>, deletes: string[] = []): Promise<{ state: MakeProjectState; issues: MakeCheckIssue[]; rolledBack: boolean }> {
    const previous = new Map<string, string | null>()
    const remember = async (path: string): Promise<void> => {
      if (previous.has(path)) return
      const cur = await this.readBuffer(conversationId, path).catch(() => null)
      previous.set(path, cur ? cur.data.toString('utf8') : null)
    }
    for (const f of files) await remember(f.path)
    for (const d of deletes) await remember(d)
    for (const f of files) await this.write(conversationId, f.path, f.content)
    for (const d of deletes) { try { await this.delete(conversationId, d) } catch { /* Already absent. */ } }
    const touched = new Set(files.map((f) => f.path))
    const issues = (await this.check(conversationId).catch(() => [] as MakeCheckIssue[])).filter((i) => touched.has(i.path))
    const fatal = issues.some((i) => i.kind === 'compile-error')
    if (fatal) {
      for (const [path, content] of previous) {
        if (content === null) { try { await this.delete(conversationId, path) } catch { /* Did not exist. */ } } else await this.write(conversationId, path, content)
      }
    }
    return { state: await this.state(conversationId), issues, rolledBack: fatal }
  }

  /** Targeted edit: replace find with replace; unless all is set, find must occur exactly once. */
  async editFile(conversationId: string, path: string, find: string, replace: string, all = false): Promise<{ state: MakeProjectState; replaced: number }> {
    if (!find) throw new MakeError('invalid_path', 'Пустой фрагмент для поиска')
    const cur = await this.readBuffer(conversationId, path)
    if (!cur) throw new MakeError('not_found', `Файл ${path} не найден`)
    const text = cur.data.toString('utf8')
    const count = text.split(find).length - 1
    if (count === 0) throw new MakeError('not_found', `Фрагмент не найден в ${path}. Перечитай файл make_read_file и передай точный текст.`)
    if (count > 1 && !all) throw new MakeError('exists', `Фрагмент встречается ${count} раз в ${path}: расширь его до уникального или передай all=true`)
    const next = all ? text.split(find).join(replace) : text.replace(find, () => replace)
    return { state: await this.write(conversationId, path, next), replaced: all ? count : 1 }
  }

  // Insert from a component library or design kit (roadmap-2, item 13).

  /**
   * Copy component files as in a merge import. For tokens.css or styles.css, add only missing :root
   * variables to preserve the project's existing palette.
   */
  async insertLibraryFiles(conversationId: string, files: Array<{ path: string; data: Buffer }>): Promise<{ state: MakeProjectState; mergedTokens: number; autoImported: string[] }> {
    const existing = new Set((await this.list(conversationId)).map((f) => f.path))
    const isTokens = (p: string): boolean => p === 'tokens.css' || p === 'styles.css'
    const plain = files.filter((f) => !(isTokens(f.path) && existing.has(f.path)))
    const tokenFiles = files.filter((f) => isTokens(f.path) && existing.has(f.path))
    let state = plain.length ? await this.importFiles(conversationId, plain, 'merge') : await this.state(conversationId)
    let mergedTokens = 0
    for (const tf of tokenFiles) {
      const incoming = parseCssTokens(tf.data.toString('utf8'))
      const current = await this.readBuffer(conversationId, tf.path)
      if (!current) continue
      let css = current.data.toString('utf8')
      const have = new Set(parseCssTokens(css).map((t) => t.name))
      for (const t of incoming) if (!have.has(t.name)) { css = setCssToken(css, t.name, t.value); mergedTokens += 1 }
      if (mergedTokens) state = await this.write(conversationId, tf.path, css)
    }
    // Automatic imports (roadmap-4, item 13): connect kit components to the entry point so they are
    // usable rather than merely copied files.
    const autoImported: string[] = []
    const entry = pickEntryFile(state.files.map((f) => f.path))
    if (entry) {
      const specs: AutoImportSpec[] = []
      for (const f of plain) {
        if (!/\.(tsx|jsx)$/i.test(f.path) || isMakeStoriesPath(f.path) || /\.test\.(tsx|jsx)$/i.test(f.path) || f.path === entry) continue
        const exp = componentExports(f.path, f.data.toString('utf8'))
        const base = f.path.slice(f.path.lastIndexOf('/') + 1).replace(/\.(tsx|jsx)$/i, '')
        const defaultName = exp.hasDefault && !exp.names.includes(base) ? base : undefined
        if (exp.names.length || defaultName) specs.push({ path: f.path, names: exp.names, defaultName })
      }
      if (specs.length) {
        const cur = await this.readBuffer(conversationId, entry)
        if (cur) {
          const r = addComponentImports(entry, cur.data.toString('utf8'), specs)
          if (r.added.length) { state = await this.write(conversationId, entry, r.source); autoImported.push(...r.added) }
        }
      }
    }
    return { state, mergedTokens, autoImported }
  }

  // Prompt context (roadmap-2, item 9).

  /** Combine :root tokens and open comments into one text block; return an empty string when there is no context. */
  async promptContext(conversationId: string): Promise<string> {
    const files = await this.list(conversationId).catch(() => [] as MakeFileInfo[])
    const tokensPath = pickTokensFile(files.map((f) => f.path))
    const parts: string[] = []
    if (tokensPath) {
      const css = await this.readBuffer(conversationId, tokensPath).catch(() => null)
      const tokens = css ? parseCssTokens(css.data.toString('utf8')) : []
      if (tokens.length) parts.push(`Дизайн-токены проекта (${tokensPath}, используй var(--имя), новые добавляй туда же): ${tokens.slice(0, 40).map((t) => `${t.name}: ${t.value}`).join('; ')}${tokens.length > 40 ? '; …' : ''}`)
    }
    const memo = await this.notes(conversationId).catch(() => ({ notes: '', mode: 'balanced' as MakeAssistantMode, stack: 'html-js' as const, uiKit: 'none' as const }))
    parts.push(MAKE_STACK_HINTS[memo.stack])
    parts.push(MAKE_UI_KIT_HINTS[memo.uiKit])
    if (MAKE_MODE_HINTS[memo.mode]) parts.push(MAKE_MODE_HINTS[memo.mode])
    if (memo.notes.trim()) parts.push(`Заметки проекта (решения, которых нужно придерживаться; дополняй через make_remember):\n${memo.notes.trim().slice(0, 4000)}`)
    const open = (await this.comments(conversationId).catch(() => [] as MakeComment[])).filter((c) => !c.resolved)
    if (open.length) parts.push(`Открытые замечания пользователя к превью (учитывай при правках, если запрос их касается):\n${open.slice(0, 20).map((c, i) => `${i + 1}. ${c.elementLabel || c.selector} (селектор \`${c.selector}\`): ${c.text}`).join('\n')}`)
    return parts.length ? `## Контекст проекта Make\n${parts.join('\n')}` : ''
  }

  // Background cleanup (roadmap-2, item 16).

  /**
   * Delete snapshots and story PNGs older than maxAgeMs across projects. Always retain the snapshot
   * pinned by a publication and each project's newest snapshot.
   */
  async sweep(maxAgeMs = 30 * 86_400_000, now = Date.now()): Promise<{ projects: number; snapshots: number; shots: number }> {
    const root = join(this.rootDir, 'make')
    let ids: string[] = []
    try { ids = (await readdir(root, { withFileTypes: true })).filter((e) => e.isDirectory() && !e.name.startsWith('.')).map((e) => e.name) } catch { ids = [] }
    const out = { projects: 0, snapshots: 0, shots: 0 }
    for (const id of ids) {
      if (!ID_RE.test(id)) continue
      out.projects += 1
      try {
        const [snaps, pub] = await Promise.all([this.snapshots(id), this.publication(id)])
        const newest = snaps[0]?.id
        for (const s of snaps) {
          if (s.id === newest || s.id === pub?.snapshotId || now - s.createdAt < maxAgeMs) continue
          await rm(join(root, id, SNAPSHOTS_DIR, s.id), { recursive: true, force: true })
          out.snapshots += 1
        }
        const shots = await this.shots(id)
        const keep = shots.filter((s) => now - s.at < maxAgeMs)
        if (keep.length !== shots.length) {
          for (const s of shots) if (!keep.includes(s)) { await rm(join(root, id, SHOTS_DIR, `${s.id}.png`), { force: true }); out.shots += 1 }
          await writeFile(join(root, id, SHOTS_DIR, 'meta.json'), JSON.stringify(keep), 'utf8').catch(() => undefined)
        }
      } catch { /* Skip corrupt projects. */ }
    }
    this.userBytesCache.clear()
    return out
  }

  // Admin metrics (item 38).

  /** Traverse all projects on disk; resolve owners through a database callback because directories only encode conversation IDs. */
  /** Free space on the data volume (roadmap-4, item 40): statfs on the data root with a 10 GB alert threshold. */
  async diskStats(): Promise<AdminDiskStats | null> {
    try {
      const st = await statfs(this.rootDir)
      const total = Number(st.blocks) * Number(st.bsize), free = Number(st.bavail) * Number(st.bsize)
      return { totalBytes: total, freeBytes: free, alert: free < MAKE_DISK_ALERT_BYTES }
    } catch { return null }
  }

  async adminStats(ownerOf: (conversationId: string) => Promise<string | null>): Promise<AdminMakeStats> {
    const root = join(this.rootDir, 'make')
    let ids: string[] = []
    try { ids = (await readdir(root, { withFileTypes: true })).filter((e) => e.isDirectory() && !e.name.startsWith('.')).map((e) => e.name) } catch { ids = [] }
    const projects: AdminMakeProjectStat[] = []
    const totals = { filesBytes: 0, snapshotsBytes: 0, shotsBytes: 0, published: 0, shared: 0, views: 0 }
    for (const id of ids) {
      if (!ID_RE.test(id)) continue
      try {
        const [files, snapshots, pub, shared, snapshotsBytes, shotsBytes] = await Promise.all([
          this.list(id), this.snapshots(id), this.publication(id), this.share(id), this.dirBytes(join(root, id, SNAPSHOTS_DIR)), this.dirBytes(join(root, id, SHOTS_DIR))
        ])
        const filesBytes = files.reduce((s, f) => s + f.size, 0)
        totals.filesBytes += filesBytes; totals.snapshotsBytes += snapshotsBytes; totals.shotsBytes += shotsBytes
        if (pub) { totals.published += 1; totals.views += pub.views ?? 0 }
        if (shared) totals.shared += 1
        projects.push({ conversationId: id, owner: await ownerOf(id), filesCount: files.length, bytes: filesBytes + snapshotsBytes + shotsBytes, snapshots: snapshots.length, published: Boolean(pub), shared: Boolean(shared), views: pub?.views ?? 0, updatedAt: files.reduce((m, f) => Math.max(m, f.updatedAt), 0) })
      } catch { /* Skip corrupt directories. */ }
    }
    const byUserMap = new Map<string, AdminMakeUserStat>()
    for (const p of projects) {
      const key = p.owner ?? '—'
      const cur = byUserMap.get(key) ?? { user: key, projects: 0, bytes: 0, published: 0, views: 0 }
      cur.projects += 1; cur.bytes += p.bytes; cur.published += p.published ? 1 : 0; cur.views += p.views
      byUserMap.set(key, cur)
    }
    return {
      disk: await this.diskStats(),
      projects: projects.length, bytes: totals.filesBytes + totals.snapshotsBytes + totals.shotsBytes, ...totals, limitBytes: MAKE_LIMITS.maxProjectBytes, userLimitBytes: this.limits.maxUserBytes,
      byUser: [...byUserMap.values()].sort((a, b) => b.bytes - a.bytes),
      top: [...projects].sort((a, b) => b.bytes - a.bytes).slice(0, 10)
    }
  }

  // Read-only ChatAI links (item 33): .share.json and a share-<token>-to-conversation index.

  async share(conversationId: string): Promise<MakeShare | null> {
    try {
      const raw = JSON.parse(await readFile(join(this.dirOf(conversationId), SHARE_FILE), 'utf8')) as { token?: string; createdAt?: number; grants?: MakeShareGrant[] }
      if (!raw.token || !ID_RE.test(raw.token)) return null
      return { token: raw.token, createdAt: raw.createdAt ?? 0, url: makeSharedUrl(raw.token), grants: raw.grants ?? [] }
    } catch { return null }
  }

  /** Create a link, returning the same link on subsequent calls. */
  async createShare(conversationId: string): Promise<MakeProjectState> {
    if (!(await this.share(conversationId))) {
      const token = randomUUID().replace(/-/g, '')
      const indexDir = join(this.rootDir, 'make', PUBLISHED_INDEX_DIR)
      await mkdir(indexDir, { recursive: true })
      await writeFile(join(indexDir, `share-${token}.json`), JSON.stringify({ conversationId }), 'utf8')
      await writeFile(join(this.dirOf(conversationId), SHARE_FILE), JSON.stringify({ token, createdAt: Date.now() }), 'utf8')
    }
    return this.state(conversationId)
  }

  /** Named access (roadmap-3, item 6): null role revokes access; create the link if it does not exist. */
  async setShareGrant(conversationId: string, user: string, role: MakeShareRole | null): Promise<MakeProjectState> {
    const name = user.trim()
    if (!/^[\w.@-]{1,64}$/.test(name)) throw new MakeError('invalid_path', 'Некорректное имя пользователя')
    if (!(await this.share(conversationId))) await this.createShare(conversationId)
    const cur = (await this.share(conversationId))!
    const grants = (cur.grants ?? []).filter((g) => g.user !== name)
    if (role) grants.push({ user: name, role })
    await writeFile(join(this.dirOf(conversationId), SHARE_FILE), JSON.stringify({ token: cur.token, createdAt: cur.createdAt, grants }), 'utf8')
    return this.state(conversationId)
  }

  /** User role from a named grant; null means no access. */
  async shareRole(conversationId: string, user: string): Promise<MakeShareRole | null> {
    const cur = await this.share(conversationId)
    return cur?.grants?.find((g) => g.user === user)?.role ?? null
  }

  async revokeShare(conversationId: string): Promise<MakeProjectState> {
    const cur = await this.share(conversationId)
    if (cur) {
      await rm(join(this.rootDir, 'make', PUBLISHED_INDEX_DIR, `share-${cur.token}.json`), { force: true })
      await rm(join(this.dirOf(conversationId), SHARE_FILE), { force: true })
    }
    return this.state(conversationId)
  }

  /** Resolve a share token to a conversation; null means invalid or revoked. */
  async sharedTarget(token: string): Promise<string | null> {
    if (!ID_RE.test(token)) return null
    try {
      const raw = JSON.parse(await readFile(join(this.rootDir, 'make', PUBLISHED_INDEX_DIR, `share-${token}.json`), 'utf8')) as { conversationId?: string }
      if (!raw.conversationId) return null
      const cur = await this.share(raw.conversationId)
      return cur?.token === token ? raw.conversationId : null
    } catch { return null }
  }

  // Preview element comments (item 32): .comments.json survives reset, like .publish.json.

  async comments(conversationId: string): Promise<MakeComment[]> {
    try {
      const raw = JSON.parse(await readFile(join(this.dirOf(conversationId), COMMENTS_FILE), 'utf8')) as MakeComment[]
      return Array.isArray(raw) ? raw : []
    } catch { return [] }
  }

  private async saveComments(conversationId: string, list: MakeComment[]): Promise<MakeComment[]> {
    await writeFile(join(this.dirOf(conversationId), COMMENTS_FILE), JSON.stringify(list), 'utf8')
    return list
  }

  // Project repository links in .project-links.json have the same lifetime as comments.

  async projectLinks(conversationId: string): Promise<MakeProjectLink[]> {
    try {
      const raw = JSON.parse(await readFile(join(this.dirOf(conversationId), PROJECT_LINKS_FILE), 'utf8')) as MakeProjectLink[]
      return Array.isArray(raw) ? raw : []
    } catch { return [] }
  }

  async saveProjectLinks(conversationId: string, list: MakeProjectLink[]): Promise<MakeProjectLink[]> {
    await writeFile(join(this.dirOf(conversationId), PROJECT_LINKS_FILE), JSON.stringify(list), 'utf8')
    return list
  }

  async addComment(conversationId: string, input: { selector: string; elementLabel: string; text: string; author: string; status?: 'pending' | 'approved'; guestName?: string }): Promise<MakeComment[]> {
    const text = input.text.trim().slice(0, 2000)
    const selector = input.selector.trim().slice(0, 500)
    if (!text || !selector) throw new MakeError('invalid_path', 'Нужны селектор и текст комментария')
    const list = await this.comments(conversationId)
    if (list.length >= 500) throw new MakeError('too_many_files', 'Слишком много комментариев — удалите решённые')
    const item: MakeComment = { id: `${Date.now().toString(36)}-${randomUUID().slice(0, 6)}`, selector, elementLabel: input.elementLabel.slice(0, 160), text, author: input.author, createdAt: Date.now(), resolved: false, ...(input.status ? { status: input.status } : {}), ...(input.guestName ? { guestName: input.guestName.trim().slice(0, 60) } : {}) }
    return this.saveComments(conversationId, [item, ...list])
  }

  async updateComment(conversationId: string, commentId: string, patch: { resolved?: boolean; text?: string; status?: 'pending' | 'approved' }): Promise<MakeComment[]> {
    const list = await this.comments(conversationId)
    const idx = list.findIndex((c) => c.id === commentId)
    if (idx < 0) throw new MakeError('not_found', 'Комментарий не найден')
    const cur = list[idx]!
    list[idx] = { ...cur, resolved: patch.resolved ?? cur.resolved, text: patch.text?.trim() ? patch.text.trim().slice(0, 2000) : cur.text, ...(patch.status ? { status: patch.status } : {}) }
    return this.saveComments(conversationId, list)
  }

  /** Comments visible to publication viewers (roadmap-4, item 34): approved only, with no selectors or usernames. */
  async publicComments(conversationId: string): Promise<MakePublicComment[]> {
    return (await this.comments(conversationId)).filter((c) => c.status !== 'pending' && !c.resolved)
      .map((c) => ({ id: c.id, elementLabel: c.elementLabel, text: c.text, createdAt: c.createdAt, ...(c.guestName ? { guestName: c.guestName } : {}) }))
  }

  /** Viewer comments enter moderation as pending with guest authorship; the publication must allow comments. */
  async addGuestComment(conversationId: string, input: { selector: string; elementLabel: string; text: string; guestName: string }): Promise<MakeComment> {
    const raw = await this.publishRaw(conversationId)
    if (!raw?.allowComments) throw new MakeError('invalid_path', 'Комментарии зрителей выключены')
    const list = await this.addComment(conversationId, { selector: input.selector || 'body', elementLabel: input.elementLabel, text: input.text, author: 'guest', status: 'pending', guestName: input.guestName || 'Гость' })
    return list[0]!
  }

  async removeComment(conversationId: string, commentId: string): Promise<MakeComment[]> {
    const list = await this.comments(conversationId)
    if (!list.some((c) => c.id === commentId)) throw new MakeError('not_found', 'Комментарий не найден')
    return this.saveComments(conversationId, list.filter((c) => c.id !== commentId))
  }

  // Quota and cleanup (item 30).

  private async dirBytes(dir: string): Promise<number> {
    let total = 0
    let entries: import('node:fs').Dirent[]
    try { entries = await readdir(dir, { withFileTypes: true }) } catch { return 0 }
    for (const e of entries) {
      const abs = join(dir, e.name)
      if (e.isDirectory()) total += await this.dirBytes(abs)
      else if (e.isFile()) total += (await stat(abs).catch(() => ({ size: 0 }))).size
    }
    return total
  }

  /** Disk usage by category and a list of unreferenced binary files. */
  async usage(conversationId: string): Promise<MakeUsage> {
    const root = this.dirOf(conversationId)
    const files = await this.list(conversationId)
    const filesBytes = files.reduce((s, f) => s + f.size, 0)
    const snapshots = await this.snapshots(conversationId)
    const [snapshotsBytes, shotsBytes, shots] = await Promise.all([
      this.dirBytes(join(root, SNAPSHOTS_DIR)), this.dirBytes(join(root, SHOTS_DIR)), this.shots(conversationId)
    ])
    // Unused assets are binaries whose filenames appear in no text file.
    const texts: string[] = []
    for (const f of files) {
      if (!isMakeTextPath(f.path) || f.size > 512 * 1024) continue
      const buf = await this.readBuffer(conversationId, f.path).catch(() => null)
      if (buf) texts.push(buf.data.toString('utf8'))
    }
    const unusedAssets = files
      .filter((f) => !isMakeTextPath(f.path))
      .filter((f) => { const name = f.path.split('/').pop()!; return !texts.some((t) => t.includes(name)) })
      .map((f) => ({ path: f.path, size: f.size }))
    return {
      filesBytes, filesCount: files.length, snapshotsBytes, snapshotsCount: snapshots.length, shotsBytes, shotsCount: shots.length,
      totalBytes: filesBytes + snapshotsBytes + shotsBytes, limitBytes: MAKE_LIMITS.maxProjectBytes, unusedAssets
    }
  }

  /** Clean selected categories and return bytes freed. Never delete the snapshot pinned by a publication. */
  async cleanup(conversationId: string, options: MakeCleanupOptions): Promise<MakeCleanupResult> {
    const root = this.dirOf(conversationId)
    const before = await this.usage(conversationId)
    const removed = { snapshots: 0, shots: 0, assets: 0 }
    if (typeof options.keepSnapshots === 'number') {
      const keep = Math.max(0, Math.floor(options.keepSnapshots))
      const pinned = (await this.publication(conversationId))?.snapshotId ?? null
      const all = await this.snapshots(conversationId)
      for (const snap of all.slice(keep)) {
        if (snap.id === pinned) continue
        await rm(join(root, SNAPSHOTS_DIR, snap.id), { recursive: true, force: true })
        removed.snapshots += 1
      }
    }
    if (options.shots) {
      removed.shots = (await this.shots(conversationId)).length
      await rm(join(root, SHOTS_DIR), { recursive: true, force: true })
    }
    if (options.unusedAssets) {
      for (const asset of before.unusedAssets) {
        try { await this.delete(conversationId, asset.path); removed.assets += 1 } catch { /* Already deleted. */ }
      }
    }
    const usage = await this.usage(conversationId)
    return { freedBytes: Math.max(0, before.totalBytes - usage.totalBytes), removed, usage, state: await this.state(conversationId) }
  }

  /** Snapshot the current files and remove older snapshots exceeding the retention limit. */
  async snapshot(conversationId: string, label: string): Promise<MakeProjectState> {
    const files = await this.list(conversationId)
    const id = `${Date.now().toString(36)}-${randomUUID().slice(0, 6)}`
    const dir = join(this.dirOf(conversationId), SNAPSHOTS_DIR, id)
    await mkdir(join(dir, 'files'), { recursive: true })
    for (const file of files) {
      const src = join(this.dirOf(conversationId), ...file.path.split('/'))
      const dst = join(dir, 'files', ...file.path.split('/'))
      await mkdir(dirname(dst), { recursive: true })
      await cp(src, dst)
    }
    const meta: SnapshotMeta = { id, createdAt: Date.now(), label: label.slice(0, 120) || 'Снимок', files: files.length }
    await writeFile(join(dir, 'meta.json'), JSON.stringify(meta), 'utf8')
    const all = await this.snapshots(conversationId)
    for (const old of all.slice(MAKE_LIMITS.maxSnapshots)) {
      await rm(join(this.dirOf(conversationId), SNAPSHOTS_DIR, old.id), { recursive: true, force: true })
    }
    return this.state(conversationId)
  }

  /** Restore a project snapshot, first saving the current state as another snapshot. */
  async restore(conversationId: string, snapshotId: string): Promise<MakeProjectState> {
    if (!ID_RE.test(snapshotId)) throw new MakeError('not_found', 'Снимок не найден')
    const src = join(this.dirOf(conversationId), SNAPSHOTS_DIR, snapshotId, 'files')
    if (!existsSync(src)) throw new MakeError('not_found', 'Снимок не найден')
    await this.snapshot(conversationId, 'Перед восстановлением снимка')
    await this.clearFiles(conversationId)
    await cp(src, this.dirOf(conversationId), { recursive: true })
    this.bump(conversationId)
    return this.state(conversationId)
  }

  /** Compare a snapshot with current files to identify additions, removals, and changes. */
  async snapshotDiff(conversationId: string, snapshotId: string): Promise<MakeSnapshotDiff> {
    if (!ID_RE.test(snapshotId)) throw new MakeError('not_found', 'Снимок не найден')
    const snapRoot = join(this.dirOf(conversationId), SNAPSHOTS_DIR, snapshotId, 'files')
    if (!existsSync(snapRoot)) throw new MakeError('not_found', 'Снимок не найден')
    const before = new Map<string, Buffer>()
    const walk = async (dir: string, rel: string): Promise<void> => {
      for (const entry of await readdir(dir, { withFileTypes: true })) {
        const next = rel ? `${rel}/${entry.name}` : entry.name
        if (entry.isDirectory()) await walk(join(dir, entry.name), next)
        else before.set(next, await readFile(join(dir, entry.name)))
      }
    }
    await walk(snapRoot, '')
    const current = await this.list(conversationId)
    const files: MakeSnapshotDiffEntry[] = []
    for (const file of current) {
      const now = await readFile(join(this.dirOf(conversationId), ...file.path.split('/')))
      const old = before.get(file.path)
      if (!old) files.push({ path: file.path, status: 'added', before: null, after: now.length })
      else files.push({ path: file.path, status: old.equals(now) ? 'same' : 'changed', before: old.length, after: now.length })
      before.delete(file.path)
    }
    for (const [path, data] of before) files.push({ path, status: 'removed', before: data.length, after: null })
    files.sort((a, b) => a.path.localeCompare(b.path))
    return { snapshotId, files }
  }

  /** Read snapshot file text for comparison with the current version. */
  async snapshotFile(conversationId: string, snapshotId: string, rawPath: string): Promise<MakeFileContent> {
    if (!ID_RE.test(snapshotId)) throw new MakeError('not_found', 'Снимок не найден')
    const path = normalizeMakePath(rawPath)
    if (!path) throw new MakeError('invalid_path', 'Недопустимый путь')
    if (!isMakeTextPath(path)) throw new MakeError('not_text', `Файл «${path}» не текстовый`)
    const src = join(this.dirOf(conversationId), SNAPSHOTS_DIR, snapshotId, 'files', ...path.split('/'))
    if (!existsSync(src)) throw new MakeError('not_found', `В снимке нет файла «${path}»`)
    const data = await readFile(src)
    return { path, size: data.byteLength, updatedAt: (await stat(src)).mtimeMs, content: data.toString('utf8') }
  }

  /** Read any snapshot file as a buffer for publication-version previews (roadmap-4, item 37); return null when absent. */
  async snapshotBuffer(conversationId: string, snapshotId: string, rawPath: string): Promise<{ path: string; data: Buffer } | null> {
    if (!ID_RE.test(snapshotId)) return null
    const path = normalizeMakePath(rawPath)
    if (!path) return null
    const src = join(this.dirOf(conversationId), SNAPSHOTS_DIR, snapshotId, 'files', ...path.split('/'))
    if (!existsSync(src)) return null
    return { path, data: await readFile(src) }
  }

  /** Restore a single file from a snapshot while preserving the rest of the project. */
  async restoreFile(conversationId: string, snapshotId: string, rawPath: string): Promise<MakeProjectState> {
    if (!ID_RE.test(snapshotId)) throw new MakeError('not_found', 'Снимок не найден')
    const { path, abs } = await this.resolveFile(conversationId, rawPath)
    const src = join(this.dirOf(conversationId), SNAPSHOTS_DIR, snapshotId, 'files', ...path.split('/'))
    if (!existsSync(src)) throw new MakeError('not_found', `В снимке нет файла «${path}»`)
    await mkdir(dirname(abs), { recursive: true })
    await cp(src, abs)
    this.bump(conversationId)
    return this.state(conversationId)
  }

  /** Import files from a ZIP archive or URL after taking a snapshot. */
  async importFiles(conversationId: string, files: Array<{ path: string; data: Buffer }>, mode: MakeImportMode): Promise<MakeProjectState> {
    // Per-user quota (roadmap-2, item 15): imports may contain hundreds of files, so calculate the
    // total before writing.
    await this.assertUserQuota(conversationId, files.reduce((n, f) => n + f.data.byteLength, 0))
    await this.ensure(conversationId)
    const accepted: Array<{ path: string; data: Buffer }> = []
    for (const file of files) {
      const path = normalizeMakePath(file.path)
      if (!path) continue
      if (file.data.byteLength > MAKE_LIMITS.maxFileBytes) throw new MakeError('too_large', `Файл «${path}» больше ${Math.round(MAKE_LIMITS.maxFileBytes / 1024)} КБ`)
      accepted.push({ path, data: file.data })
    }
    if (accepted.length === 0) throw new MakeError('invalid_path', 'В импорте нет подходящих файлов')
    if (accepted.length > MAKE_LIMITS.maxFiles) throw new MakeError('too_many_files', `В проекте не может быть больше ${MAKE_LIMITS.maxFiles} файлов`)
    await this.snapshot(conversationId, mode === 'replace' ? 'Перед импортом (замена)' : 'Перед импортом')
    if (mode === 'replace') await this.clearFiles(conversationId)
    for (const file of accepted) {
      const abs = join(this.dirOf(conversationId), ...file.path.split('/'))
      await mkdir(dirname(abs), { recursive: true })
      await writeFile(abs, file.data)
    }
    this.bump(conversationId)
    return this.state(conversationId)
  }

  /** Replace all project files with the starter template, preserving snapshots. */
  async reset(conversationId: string): Promise<MakeProjectState> {
    await this.snapshot(conversationId, 'Перед сбросом проекта')
    await this.clearFiles(conversationId)
    for (const [path, content] of Object.entries(MAKE_SCAFFOLD)) {
      await writeFile(join(this.dirOf(conversationId), ...path.split('/')), content, 'utf8')
    }
    this.bump(conversationId)
    return this.state(conversationId)
  }

  private async clearFiles(conversationId: string): Promise<void> {
    const root = this.dirOf(conversationId)
    for (const entry of await readdir(root)) {
      if (entry === SNAPSHOTS_DIR || entry === PUBLISH_FILE || entry === SHOTS_DIR || entry === COMMENTS_FILE || entry === PROJECT_LINKS_FILE || entry === SHARE_FILE || entry === NOTES_DIR) continue
      await rm(join(root, entry), { recursive: true, force: true })
    }
  }

  /** Search text file contents case-insensitively, returning at most limit matches with truncated lines. */
  async search(conversationId: string, query: string, limit = 200, options: MakeSearchOptions = {}): Promise<MakeSearchMatch[]> {
    if (!query.trim()) return []
    const re = this.searchRegex(query, options)
    const matches: MakeSearchMatch[] = []
    for (const file of await this.list(conversationId)) {
      if (!isMakeTextPath(file.path)) continue
      const { content } = await this.read(conversationId, file.path)
      const lines = content.split('\n')
      for (let i = 0; i < lines.length; i++) {
        re.lastIndex = 0
        if (re.test(lines[i]!)) {
          matches.push({ path: file.path, line: i + 1, text: lines[i]!.trim().slice(0, 200) })
          if (matches.length >= limit) return matches
        }
      }
    }
    return matches
  }

  /** Invalid user regular expressions are request errors, not server errors. */
  private searchRegex(query: string, options: MakeSearchOptions): RegExp {
    try { return buildMakeSearchRegex(query, options) } catch (e) { throw new MakeError('invalid_path', `Неверное выражение: ${(e as Error).message}`) }
  }

  /** Replace text across files using literal matches or regex capture substitutions such as $1. Take a snapshot before editing; dryRun only previews the result. */
  async replaceAll(conversationId: string, query: string, replacement: string, options: MakeSearchOptions & { dryRun?: boolean } = {}): Promise<{ files: number; replacements: number; state: MakeProjectState; preview?: MakeReplacePreviewLine[] }> {
    if (!query) throw new MakeError('invalid_path', 'Пустая строка поиска')
    const re = this.searchRegex(query, options)
    // Without regex mode, $1 must remain literal replacement text; use a replacement function.
    const substitute = options.regex ? replacement : (): string => replacement
    let files = 0, replacements = 0
    const touched: Array<{ path: string; next: string }> = []
    const preview: MakeReplacePreviewLine[] = []
    for (const file of await this.list(conversationId)) {
      if (!isMakeTextPath(file.path)) continue
      const { content } = await this.read(conversationId, file.path)
      re.lastIndex = 0
      const count = (content.match(re) ?? []).length
      if (count === 0) continue
      files += 1; replacements += count
      if (options.dryRun) { if (preview.length < 500) preview.push(...previewMakeReplace(file.path, content, re, substitute)); continue }
      re.lastIndex = 0
      touched.push({ path: file.path, next: content.replace(re, substitute as string) })
    }
    if (options.dryRun) return { files, replacements, state: await this.state(conversationId), preview }
    if (touched.length > 0) {
      await this.snapshot(conversationId, `Перед заменой «${query.slice(0, 30)}» → «${replacement.slice(0, 30)}»`)
      for (const t of touched) await writeFile(join(this.dirOf(conversationId), ...t.path.split('/')), t.next, 'utf8')
      this.bump(conversationId)
    }
    return { files, replacements, state: await this.state(conversationId) }
  }

  /** Visual story snapshots: PNGs in .shots/<id>.png with meta.json, limited to SHOTS_PER_STORY per story. */
  async shots(conversationId: string): Promise<MakeStoryShot[]> {
    try {
      const raw = JSON.parse(await readFile(join(this.dirOf(conversationId), SHOTS_DIR, 'meta.json'), 'utf8')) as MakeStoryShot[]
      return Array.isArray(raw) ? raw.sort((a, b) => b.at - a.at) : []
    } catch { return [] }
  }

  async addShot(conversationId: string, file: string, story: string, png: Buffer): Promise<MakeStoryShot[]> {
    if (png.byteLength > MAKE_LIMITS.maxFileBytes * 2) throw new MakeError('too_large', 'Снимок больше 4 МБ')
    if (!/^\x89PNG/.test(png.subarray(0, 4).toString('latin1'))) throw new MakeError('invalid_path', 'Ожидается PNG')
    const dir = join(this.dirOf(conversationId), SHOTS_DIR)
    await mkdir(dir, { recursive: true })
    const id = `${Date.now().toString(36)}-${randomUUID().slice(0, 6)}`
    await writeFile(join(dir, `${id}.png`), png)
    const list = [{ id, file, story, at: Date.now(), rev: this.rev(conversationId) }, ...(await this.shots(conversationId))]
    // Enforce the per-story limit by deleting older snapshots and their files.
    const keep: MakeStoryShot[] = []
    const perStory = new Map<string, number>()
    for (const s of list) {
      const k = `${s.file}::${s.story}`
      const n = (perStory.get(k) ?? 0) + 1
      perStory.set(k, n)
      if (n <= SHOTS_PER_STORY) keep.push(s)
      else await rm(join(dir, `${s.id}.png`), { force: true })
    }
    await writeFile(join(dir, 'meta.json'), JSON.stringify(keep), 'utf8')
    return keep
  }

  async shotImage(conversationId: string, shotId: string): Promise<Buffer | null> {
    if (!ID_RE.test(shotId)) return null
    try { return await readFile(join(this.dirOf(conversationId), SHOTS_DIR, `${shotId}.png`)) } catch { return null }
  }

  /** Project story files with their exported story names. */
  async stories(conversationId: string): Promise<MakeStoryFile[]> {
    const result: MakeStoryFile[] = []
    for (const file of await this.list(conversationId)) {
      if (!isMakeStoriesPath(file.path)) continue
      const { content } = await this.read(conversationId, file.path)
      result.push(parseStoryFile(file.path, content))
    }
    return result
  }

  async state(conversationId: string): Promise<MakeProjectState> {
    const [files, snapshots, published, shared] = await Promise.all([this.list(conversationId), this.snapshots(conversationId), this.publication(conversationId), this.share(conversationId)])
    return { conversationId, files, snapshots, rev: this.rev(conversationId), published, shared }
  }

  // Publications use unlisted /p/<token>/ links without account authentication.

  /** Raw publication file includes the password hash; MakePublication never exposes it. */
  /**
   * Write publication state through a temporary file and rename. Ordinary writeFile truncates
   * before writing, while view counting runs in the background. Concurrent readers could see empty
   * or partial JSON and make publishRaw return null. Unpublish would then report success without
   * removing anything, leaving the link active. This race also caused intermittent post-unpublish
   * /p/<token>/ test failures.
   */
  /**
   * Serialize publication mutations per conversation. Background countView could read state before
   * unpublish and write it after republishing, reviving the old token and making the new
   * publishedTarget return 404. This caused intermittent /p/<token>/ failures after republishing.
   */
  private publishChains = new Map<string, Promise<unknown>>()

  private async withPublishLock<T>(conversationId: string, fn: () => Promise<T>): Promise<T> {
    const prev = this.publishChains.get(conversationId) ?? Promise.resolve()
    const next = prev.then(fn, fn)
    this.publishChains.set(conversationId, next.then(() => undefined, () => undefined))
    return next
  }

  private async writePublishRaw(conversationId: string, raw: PublishRaw): Promise<void> {
    const file = join(this.dirOf(conversationId), PUBLISH_FILE)
    const temporary = `${file}.${randomUUID()}.tmp`
    await writeFile(temporary, JSON.stringify(raw), 'utf8')
    await rename(temporary, file)
  }

  private async publishRaw(conversationId: string): Promise<PublishRaw | null> {
    try {
      const raw = JSON.parse(await readFile(join(this.dirOf(conversationId), PUBLISH_FILE), 'utf8')) as PublishRaw
      if (!raw.token || !ID_RE.test(raw.token)) return null
      return raw
    } catch {
      return null
    }
  }

  async publication(conversationId: string): Promise<MakePublication | null> {
    const raw = await this.publishRaw(conversationId)
    if (!raw) return null
    return {
      token: raw.token, publishedAt: raw.publishedAt ?? 0, url: makePublicUrl(raw.token),
      snapshotId: raw.snapshotId ?? null, snapshotLabel: raw.snapshotLabel ?? null,
      slug: raw.slug ?? null, slugUrl: raw.slug ? makeSlugUrl(raw.slug) : null,
      passwordProtected: Boolean(raw.passwordHash), views: raw.views ?? 0, history: raw.history ?? [], allowComments: Boolean(raw.allowComments),
      stats: {
        days: Object.entries(raw.days ?? {}).sort(([a], [b]) => a.localeCompare(b)).map(([day, views]) => ({ day, views })),
        referers: Object.entries(raw.referers ?? {}).sort(([, a], [, b]) => b - a).map(([host, views]) => ({ host, views }))
      }
    }
  }

  /** Publish a project, returning the same link on subsequent calls. */
  /**
   * Create the publication token once and preserve it. snapshotId pins the published files to that
   * snapshot until the publication is updated; null serves the current project files live.
   */
  async publish(conversationId: string, options: { snapshotId?: string | null; slug?: string | null; password?: string | null; allowComments?: boolean } = {}): Promise<MakeProjectState> {
    return this.withPublishLock(conversationId, () => this.publishInner(conversationId, options))
  }

  private async publishInner(conversationId: string, options: { snapshotId?: string | null; slug?: string | null; password?: string | null; allowComments?: boolean } = {}): Promise<MakeProjectState> {
    const existing = await this.publishRaw(conversationId)
    const token = existing?.token ?? randomUUID().replace(/-/g, '')
    if (!existing) {
      const indexDir = join(this.rootDir, 'make', PUBLISHED_INDEX_DIR)
      await mkdir(indexDir, { recursive: true })
      await writeFile(join(indexDir, `${token}.json`), JSON.stringify({ conversationId }), 'utf8')
    }
    let snapshotId: string | null = null, snapshotLabel: string | null = null
    if (options.snapshotId) {
      if (!ID_RE.test(options.snapshotId)) throw new MakeError('not_found', 'Снимок не найден')
      const snap = (await this.snapshots(conversationId)).find((s) => s.id === options.snapshotId)
      if (!snap) throw new MakeError('not_found', 'Снимок не найден')
      snapshotId = snap.id; snapshotLabel = snap.label
    }
    // Slug (item 25): undefined preserves it, null removes it, and a string is validated and
    // claimed in the slug-to-token index. A slug owned by another publication is a conflict.
    let slug = existing?.slug ?? null
    if (options.slug !== undefined) {
      const next = options.slug ? options.slug.trim().toLowerCase() : null
      if (next && !isValidMakeSlug(next)) throw new MakeError('invalid_path', 'Адрес: 3–40 символов, латиница, цифры и дефис')
      if (next !== slug) {
        const indexDir = join(this.rootDir, 'make', PUBLISHED_INDEX_DIR)
        if (next) {
          const owner = await this.slugToken(next)
          if (owner && owner !== token) throw new MakeError('exists', 'Такой адрес уже занят другим проектом')
          await mkdir(indexDir, { recursive: true })
          await writeFile(join(indexDir, `slug-${next}.json`), JSON.stringify({ token }), 'utf8')
        }
        if (slug) await rm(join(indexDir, `slug-${slug}.json`), { force: true })
        slug = next
      }
    }
    // Password: undefined preserves it, null removes it, and a string creates a new salted hash.
    // Never store the password itself.
    let passwordHash = existing?.passwordHash ?? null
    if (options.password !== undefined) {
      if (options.password === null || options.password === '') passwordHash = null
      else {
        if (options.password.length < 4) throw new MakeError('invalid_path', 'Пароль — не короче 4 символов')
        const salt = randomUUID().replace(/-/g, '')
        passwordHash = `${salt}:${createHash('sha256').update(`${salt}:${options.password}`).digest('hex')}`
      }
    }
    // History (roadmap-2, item 11): add an entry only when the served version changes between
    // snapshots or live files. Slug and password changes do not affect history.
    const history = [...(existing?.history ?? [])]
    const last = history[history.length - 1]
    if (!existing || !last || last.snapshotId !== snapshotId) history.push({ at: Date.now(), snapshotId, snapshotLabel })
    const raw: PublishRaw = { token, publishedAt: Date.now(), snapshotId, snapshotLabel, slug, passwordHash, views: existing?.views ?? 0, history: history.slice(-30), days: existing?.days, referers: existing?.referers, allowComments: options.allowComments ?? existing?.allowComments ?? false }
    await this.writePublishRaw(conversationId, raw)
    return this.state(conversationId)
  }

  /** Publication token for a slug; null means the address is available or has been removed. */
  async slugToken(slug: string): Promise<string | null> {
    if (!isValidMakeSlug(slug)) return null
    try {
      const raw = JSON.parse(await readFile(join(this.rootDir, 'make', PUBLISHED_INDEX_DIR, `slug-${slug}.json`), 'utf8')) as { token?: string }
      if (!raw.token) return null
      // The index may outlive an unpublished project, so verify the publication itself.
      const conversationId = await this.publishedTarget(raw.token)
      if (!conversationId) return null
      const pub = await this.publishRaw(conversationId)
      return pub?.slug === slug ? raw.token : null
    } catch { return null }
  }

  /**
   * Password access signature: null means no password. Otherwise, the server sets this signature in
   * a cookie after a correct password and checks it on every request. It depends on the password
   * hash, so changing the password revokes all existing cookies.
   */
  async publicGate(conversationId: string): Promise<string | null> {
    const raw = await this.publishRaw(conversationId)
    if (!raw?.passwordHash) return null
    return createHash('sha256').update(`gate:${raw.token}:${raw.passwordHash}`).digest('hex')
  }

  async verifyPublicPassword(conversationId: string, password: string): Promise<boolean> {
    const raw = await this.publishRaw(conversationId)
    if (!raw?.passwordHash) return true
    const [salt, hash] = raw.passwordHash.split(':')
    return createHash('sha256').update(`${salt}:${password}`).digest('hex') === hash
  }

  /** Increment the view counter when a publication's index.html opens. Races are tolerable because this is analytics, not billing. */
  async countView(conversationId: string, referer?: string | null, now = Date.now()): Promise<void> {
    return this.withPublishLock(conversationId, () => this.countViewInner(conversationId, referer, now))
  }

  private async countViewInner(conversationId: string, referer?: string | null, now = Date.now()): Promise<void> {
    const raw = await this.publishRaw(conversationId)
    if (!raw) return
    raw.views = (raw.views ?? 0) + 1
    // Analytics (roadmap-3, item 3): UTC day and referrer host; exclude the publication's own
    // addresses.
    const day = new Date(now).toISOString().slice(0, 10)
    const days = raw.days ?? {}
    days[day] = (days[day] ?? 0) + 1
    raw.days = Object.fromEntries(Object.entries(days).sort(([a], [b]) => a.localeCompare(b)).slice(-90))
    const host = refererHost(referer)
    if (host) {
      const refs = raw.referers ?? {}
      refs[host] = (refs[host] ?? 0) + 1
      raw.referers = Object.fromEntries(Object.entries(refs).sort(([, a], [, b]) => b - a).slice(0, 20))
    }
    await this.writePublishRaw(conversationId, raw).catch(() => undefined)
  }

  /**
   * Mock API (item 29): when a file is missing, look for mock/<path>[.<METHOD>].json. publicMode
   * uses published files, including pinned snapshots; otherwise use current files. Return the
   * parsed response, or null for missing mocks and invalid JSON.
   */
  async resolveMock(conversationId: string, rawPath: string, method: string, publicMode = false, body: unknown = undefined, cookieHeader: string | undefined = undefined): Promise<MockResponse | null> {
    // Persistent collections (roadmap-2, item 12): mock/<base>.json with $collection supports CRUD
    // by ID with file persistence. Publications expose collections as read-only so anonymous
    // visitors cannot modify project files.
    for (const { file: colPath, id } of collectionCandidates(rawPath)) {
      const colFile = publicMode ? await this.publicFile(conversationId, colPath).catch(() => null) : await this.readBuffer(conversationId, colPath).catch(() => null)
      if (!colFile) continue
      let json: unknown = null
      try { json = JSON.parse(colFile.data.toString('utf8')) } catch { json = null }
      if (!isMockCollection(json)) continue
      const m = method.toUpperCase()
      if (publicMode && m !== 'GET') return { status: 405, body: { error: 'публикация только для чтения' }, headers: {}, delayMs: 0 }
      const result = applyCollectionRequest(json, m, id, body, () => randomUUID().slice(0, 8))
      if (result.changed) await this.write(conversationId, colPath, JSON.stringify(result.file, null, 2) + '\n')
      return result.response
    }
    for (const candidate of mockCandidates(rawPath, method)) {
      let file: { data: Buffer } | null = null
      try { file = publicMode ? await this.publicFile(conversationId, candidate) : await this.readBuffer(conversationId, candidate) } catch { file = null }
      if (!file) continue
      let json: unknown
      try { json = JSON.parse(file.data.toString('utf8')) } catch { return { status: 500, body: { error: `Мок ${candidate}: невалидный JSON` }, headers: {}, delayMs: 0 } }
      // Authentication mock (roadmap-4, item 32): login sets a session cookie required by protected
      // resources.
      return isAuthMock(json) ? applyAuthMock(json, method, body, cookieHeader) : unwrapMockEnvelope(json)
    }
    return null
  }

  /** Public-link file from the pinned snapshot or current project, plus a revision key for transpilation caching. */
  async publicFile(conversationId: string, rawPath: string): Promise<{ path: string; data: Buffer; cacheKey: string; rev: number } | null> {
    const pub = await this.publication(conversationId)
    if (pub?.snapshotId) {
      const path = normalizeMakePath(rawPath)
      if (!path) return null
      const abs = join(this.dirOf(conversationId), SNAPSHOTS_DIR, pub.snapshotId, 'files', ...path.split('/'))
      try {
        const st = await stat(abs)
        if (!st.isFile()) return null
        return { path, data: await readFile(abs), cacheKey: `${conversationId}@${pub.snapshotId}`, rev: 0 }
      } catch { return null }
    }
    const file = await this.readBuffer(conversationId, rawPath)
    return file ? { ...file, cacheKey: conversationId, rev: this.rev(conversationId) } : null
  }

  async unpublish(conversationId: string): Promise<MakeProjectState> {
    return this.withPublishLock(conversationId, () => this.unpublishInner(conversationId))
  }

  private async unpublishInner(conversationId: string): Promise<MakeProjectState> {
    const indexDir = join(this.rootDir, 'make', PUBLISHED_INDEX_DIR)
    const existing = await this.publishRaw(conversationId)
    if (existing) {
      await rm(join(indexDir, `${existing.token}.json`), { force: true })
      if (existing.slug) await rm(join(indexDir, `slug-${existing.slug}.json`), { force: true })
    } else {
      // If publication state is unreadable, its token is unknown, but the user still requested
      // unpublishing. Scan the index for links rather than leaving them active; reading a few small
      // files is acceptable.
      for (const name of await readdir(indexDir).catch(() => [] as string[])) {
        const target = await readFile(join(indexDir, name), 'utf8').then((text) => (JSON.parse(text) as { conversationId?: string }).conversationId).catch(() => null)
        if (target === conversationId) await rm(join(indexDir, name), { force: true })
      }
    }
    // Always remove the publication file: unreadable state is not a reason to leave the project
    // published.
    await rm(join(this.dirOf(conversationId), PUBLISH_FILE), { force: true })
    return this.state(conversationId)
  }

  /** Conversation published under a token; null means the link is invalid or unpublished. */
  async publishedTarget(token: string): Promise<string | null> {
    if (!ID_RE.test(token)) return null
    try {
      const raw = JSON.parse(await readFile(join(this.rootDir, 'make', PUBLISHED_INDEX_DIR, `${token}.json`), 'utf8')) as { conversationId?: string }
      if (!raw.conversationId) return null
      // The index may outlive a deleted project, so verify its publication file.
      const current = await this.publication(raw.conversationId)
      return current?.token === token ? raw.conversationId : null
    } catch {
      return null
    }
  }

  // Static project checks.

  /**
   * Find common causes of silently broken previews: missing index.html, href/src links to missing
   * project files, empty files, and external scripts using non-HTTPS URLs. Attribute regular
   * expressions are sufficient for these static checks; this is not an HTML parser.
   */
  async check(conversationId: string): Promise<MakeCheckIssue[]> {
    const files = await this.list(conversationId)
    const paths = new Set(files.map((f) => f.path))
    const issues: MakeCheckIssue[] = []
    const settings = await this.notes(conversationId)
    if (settings.stack === 'html') {
      for (const file of files) if (/\.(?:js|mjs)$/i.test(file.path)) issues.push({ path: file.path, kind: 'lint', severity: 'warning', rule: 'html-no-script', message: 'Стек HTML+CSS запрещает JavaScript-файлы' })
    }
    if (settings.stack === 'react') {
      for (const file of files) {
        const match = file.path.match(/^src\/components\/(.+)\.(jsx|tsx)$/i)
        if (!match || /\.(?:stories|test)\.(?:jsx|tsx)$/i.test(file.path)) continue
        if (!paths.has(`src/components/${match[1]}.stories.${match[2]}`)) issues.push({ path: file.path, kind: 'lint', severity: 'warning', rule: 'react-component-story', message: 'У React-компонента нет соседнего файла stories' })
      }
    }
    if (!paths.has('index.html')) issues.push({ path: 'index.html', kind: 'no-index', message: 'Нет index.html — превью открывать нечего' })
    for (const file of files) {
      if (file.size === 0) issues.push({ path: file.path, kind: 'empty-file', message: 'Файл пустой' })
      if (isMakeTranspiledPath(file.path) && file.size > 0) {
        const source = await readFile(join(this.dirOf(conversationId), ...file.path.split('/')), 'utf8')
        for (const d of await compileDiagnostics(file.path, source)) {
          issues.push({ path: file.path, kind: 'compile-error', message: `Ошибка компиляции (строка ${d.line}): ${d.message}`, line: d.line, column: d.column })
        }
        for (const w of lintMakeFile(file.path, source)) issues.push({ path: file.path, kind: 'lint', severity: 'warning', rule: w.rule, message: w.message, line: w.line, column: w.column })
      }
      if (/\.css$/i.test(file.path) && file.size > 0 && file.size <= 512 * 1024) {
        const source = await readFile(join(this.dirOf(conversationId), ...file.path.split('/')), 'utf8')
        for (const w of lintMakeFile(file.path, source)) issues.push({ path: file.path, kind: 'lint', severity: 'warning', rule: w.rule, message: w.message, line: w.line, column: w.column })
      }
      if (!/\.(html?|css)$/i.test(file.path)) continue
      const text = (await readFile(join(this.dirOf(conversationId), ...file.path.split('/')), 'utf8')).slice(0, 512 * 1024)
      if (settings.stack === 'html' && /<script\b/i.test(text)) issues.push({ path: file.path, kind: 'lint', severity: 'warning', rule: 'html-no-script', message: 'Стек HTML+CSS запрещает теги script' })
      const dir = file.path.includes('/') ? file.path.slice(0, file.path.lastIndexOf('/')) : ''
      const refs = new Set<string>()
      for (const m of text.matchAll(/(?:href|src)\s*=\s*["']([^"'#?]+)/gi)) refs.add(m[1]!)
      for (const m of text.matchAll(/url\(\s*["']?([^"')]+?)["']?\s*\)/gi)) refs.add(m[1]!)
      for (const ref of refs) {
        const value = ref.trim()
        // Anchors such as #top and SVG references such as url(#shadow) are not files.
        if (!value || value.startsWith('#') || value.startsWith('data:') || value.startsWith('mailto:') || value.startsWith('tel:') || value.startsWith('javascript:') || value.startsWith('//')) continue
        if (/^https?:/i.test(value)) {
          if (/^http:/i.test(value) && /\.js$/i.test(value)) issues.push({ path: file.path, kind: 'external-script', message: `Внешний скрипт не по https: ${value}` })
          continue
        }
        const target = resolveRelativeRef(dir, value)
        if (target === undefined) continue // Not a project file; for example, .. above the root resolves as missing.
        if (target === null || !paths.has(target)) issues.push({ path: file.path, kind: 'missing-file', message: `Ссылка на отсутствующий файл: ${value}` })
      }
    }
    return issues
  }

  /** Replace project files with a template after snapshotting the current state. */
  async applyTemplate(conversationId: string, templateId: string): Promise<MakeProjectState> {
    const template = MAKE_TEMPLATES.find((t) => t.id === templateId)
    if (!template) throw new MakeError('not_found', `Шаблон «${templateId}» не найден`)
    const settings = await this.notes(conversationId)
    if (!isMakeTemplateCompatible(template, settings.stack)) throw new MakeError('not_found', `Шаблон «${templateId}» несовместим со стеком ${settings.stack}`)
    await this.ensure(conversationId)
    await this.snapshot(conversationId, 'До смены стека')
    await this.clearFiles(conversationId)
    for (const [path, content] of Object.entries(applyMakeUiKit(template.files, settings.stack, settings.uiKit))) {
      const abs = join(this.dirOf(conversationId), ...path.split('/'))
      await mkdir(dirname(abs), { recursive: true })
      await writeFile(abs, content, 'utf8')
    }
    this.bump(conversationId)
    return this.state(conversationId)
  }

  /** ZIP all project files, excluding snapshots, for code downloads. */
  async exportZip(conversationId: string, options: { vite?: boolean; pwa?: boolean; deploy?: MakeDeployTarget | null } = {}): Promise<Buffer> {
    const files = await this.list(conversationId)
    const entries: Array<{ path: string; data: Buffer; mtime?: Date }> = []
    for (const file of files) {
      const data = await readFile(join(this.dirOf(conversationId), ...file.path.split('/')))
      entries.push({ path: file.path, data, mtime: new Date(file.updatedAt) })
    }
    // Hosting (roadmap-4, item 36): add Netlify/Vercel configuration alongside files for either
    // plain static hosting or a Vite build.
    if (options.deploy) {
      for (const [path, text] of Object.entries(deployConfigFiles(options.deploy, { vite: Boolean(options.vite), hasMocks: files.some((f) => f.path.startsWith('mock/')) }))) {
        if (!files.some((f) => f.path === path)) entries.push({ path, data: Buffer.from(text, 'utf8') })
      }
    }
    if (options.pwa) {
      // PWA (item 35): add a manifest, service worker, and icon, modifying only the archived copy
      // of index.html.
      const index = entries.find((e) => e.path === 'index.html')
      const css = entries.find((e) => /\.css$/i.test(e.path))
      const meta = detectPwaMeta(index ? index.data.toString('utf8') : null, css ? css.data.toString('utf8') : null)
      const pwa = { ...meta, vite: Boolean(options.vite) }
      for (const [path, text] of Object.entries(pwaFiles(pwa))) if (!files.some((f) => f.path === path)) entries.push({ path, data: Buffer.from(text, 'utf8') })
      if (index) index.data = Buffer.from(injectPwaIntoHtml(index.data.toString('utf8'), pwa), 'utf8')
    }
    if (options.vite) {
      // Export a runnable project with package.json and vite.config so npm i && npm run dev works
      // locally. The esm.sh import map does not interfere with Vite, which rewrites bare imports
      // before the browser applies it.
      const paths = new Set(files.map((f) => f.path))
      const react = files.some((f) => /\.(jsx|tsx)$/i.test(f.path))
      const ts = files.some((f) => /\.tsx?$/i.test(f.path))
      const pkg = {
        name: 'make-project', private: true, version: '0.1.0', type: 'module',
        scripts: { dev: 'vite', build: 'vite build', preview: 'vite preview' },
        dependencies: react ? { react: '^18.3.1', 'react-dom': '^18.3.1' } : {},
        devDependencies: { vite: '^5.4.11', ...(react ? { '@vitejs/plugin-react': '^4.3.4' } : {}), ...(ts ? { typescript: '^5.7.2', '@types/react': '^18.3.18', '@types/react-dom': '^18.3.5' } : {}) }
      }
      const add = (path: string, text: string): void => { if (!paths.has(path)) entries.push({ path, data: Buffer.from(text, 'utf8') }) }
      add('package.json', JSON.stringify(pkg, null, 2) + '\n')
      add('vite.config.js', react
        ? "import { defineConfig } from 'vite'\nimport react from '@vitejs/plugin-react'\n\nexport default defineConfig({ plugins: [react()] })\n"
        : "import { defineConfig } from 'vite'\n\nexport default defineConfig({})\n")
      if (ts) add('tsconfig.json', JSON.stringify({ compilerOptions: { target: 'ES2020', module: 'ESNext', moduleResolution: 'Bundler', jsx: 'react-jsx', strict: true, allowImportingTsExtensions: true, noEmit: true, skipLibCheck: true }, include: ['src'] }, null, 2) + '\n')
      add('.gitignore', 'node_modules\ndist\n')
      add('README.md', '# Project exported from Make\n\n```bash\nnpm install\nnpm run dev\n```\n\nCreated with Make: a static website' + (react ? ' built with React (JSX is transpiled by Vite)' : '') + '.\n')
    }
    return buildStoredZip(entries)
  }

  /** Short content fingerprint for preview ETags. */
  static etag(data: Buffer): string {
    return `"${createHash('sha1').update(data).digest('hex').slice(0, 16)}"`
  }
}
