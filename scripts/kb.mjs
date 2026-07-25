#!/usr/bin/env node
// Обслуживание базы знаний docs/kb: проверка свежести, генерация индекса,
// записи журнала. Без зависимостей — запускается любым агентом на любой машине.
//
// Команды:
//   node scripts/kb.mjs check [--strict]   что устарело, что не описано, битые ссылки
//   node scripts/kb.mjs index              перегенерировать docs/kb/README.md
//   node scripts/kb.mjs log <slug>         новая запись журнала (имя уникально по машине)
//   node scripts/kb.mjs touch <файл...>    поставить сегодняшнюю дату в updated
//   node scripts/kb.mjs                    = check + index

import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { hostname } from 'node:os'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const KB_DIR = join(ROOT, 'docs/kb')
const LOG_DIR = join(KB_DIR, 'log')
const INDEX_FILE = join(KB_DIR, 'README.md')
/** Пакеты, у каждого из которых должен быть свой AGENTS.md. */
const PKG_GLOB_DIRS = ['apps', 'packages']

const C = {
  dim: (s) => `[2m${s}[0m`,
  red: (s) => `[31m${s}[0m`,
  yellow: (s) => `[33m${s}[0m`,
  green: (s) => `[32m${s}[0m`,
  bold: (s) => `[1m${s}[0m`
}

/** Сегодняшняя дата в ЛОКАЛЬНОЙ зоне (toISOString даёт UTC — вечером это «вчера»). */
function today() {
  const d = new Date()
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

function git(args) {
  try {
    return execFileSync('git', args, { cwd: ROOT, encoding: 'utf8' }).trim()
  } catch {
    return ''
  }
}

/**
 * Разбор YAML-фронтматтера: поддерживаем ровно то, что используем —
 * скалярные `title`/`updated` и список `areas`. Полный YAML не нужен.
 */
function parseFrontMatter(text) {
  const m = /^---\n([\s\S]*?)\n---\n?/.exec(text)
  if (!m) return { data: {}, body: text }
  const data = {}
  let listKey = null
  for (const raw of m[1].split('\n')) {
    const item = /^\s*-\s+(.*)$/.exec(raw)
    if (item && listKey) {
      data[listKey].push(item[1].trim().replace(/^['"]|['"]$/g, ''))
      continue
    }
    const kv = /^([A-Za-z_][\w-]*):\s*(.*)$/.exec(raw)
    if (!kv) continue
    const [, key, value] = kv
    if (value === '') {
      listKey = key
      data[key] = []
    } else {
      listKey = null
      data[key] = value.trim().replace(/^['"]|['"]$/g, '')
    }
  }
  return { data, body: text.slice(m[0].length) }
}

/** Файлы тем (docs/kb/*.md, кроме генерируемого индекса). */
function topicFiles() {
  if (!existsSync(KB_DIR)) return []
  return readdirSync(KB_DIR)
    .filter((f) => f.endsWith('.md') && f !== 'README.md')
    .sort()
    .map((f) => {
      const path = join(KB_DIR, f)
      const { data } = parseFrontMatter(readFileSync(path, 'utf8'))
      return {
        file: f,
        path,
        title: data.title ?? f.replace(/\.md$/, ''),
        updated: data.updated ?? '',
        checked: data.checked ?? '',
        areas: Array.isArray(data.areas) ? data.areas : []
      }
    })
}

/** Дата последнего коммита, затронувшего указанные пути (YYYY-MM-DD) или ''. */
function lastCommitDate(paths) {
  if (paths.length === 0) return ''
  return git(['log', '-1', '--format=%cs', '--', ...paths])
}

/** Существует ли объект с таким sha (после rebase старый sha исчезает). */
function shaExists(sha) {
  if (!sha) return false
  try {
    execFileSync('git', ['cat-file', '-e', `${sha}^{commit}`], { cwd: ROOT, stdio: 'ignore' })
    return true
  } catch {
    return false
  }
}

/** Коммиты, затронувшие areas после сверки (`checked`). */
function commitsSinceChecked(sha, paths) {
  if (paths.length === 0) return []
  const out = git(['log', '--format=%h %s', `${sha}..HEAD`, '--', ...paths])
  return out ? out.split('\n') : []
}

/**
 * Свежесть темы. Основной механизм — sha сверки (`checked`): ловит и правки того
 * же дня, что критично, когда несколько агентов коммитят в один день. Дата
 * используется как фолбэк, когда sha нет или он исчез после rebase.
 */
function staleness(topic) {
  if (topic.areas.length === 0) return { stale: false, why: '' }
  if (shaExists(topic.checked)) {
    const commits = commitsSinceChecked(topic.checked, topic.areas)
    if (commits.length === 0) return { stale: false, why: '' }
    return {
      stale: true,
      why: `${commits.length} коммит(ов) в areas после сверки: ${commits[0]}${commits.length > 1 ? ' …' : ''}`
    }
  }
  const code = lastCommitDate(topic.areas)
  if (!topic.updated) return { stale: true, why: 'нет поля updated' }
  if (code && code > topic.updated) {
    return { stale: true, why: `код изменён ${code}, сверка ${topic.updated} (по датам: правки того же дня не видны — поставь checked)` }
  }
  return { stale: false, why: '' }
}

/** Пакеты, у которых нет AGENTS.md. */
function packagesWithoutAgentsMd() {
  const missing = []
  for (const dir of PKG_GLOB_DIRS) {
    const base = join(ROOT, dir)
    if (!existsSync(base)) continue
    for (const name of readdirSync(base)) {
      const pkg = join(base, name)
      if (!existsSync(join(pkg, 'package.json'))) continue
      if (!existsSync(join(pkg, 'AGENTS.md'))) missing.push(`${dir}/${name}`)
    }
  }
  return missing
}

/** Битые относительные ссылки в markdown-файле. */
function brokenLinks(file) {
  const text = readFileSync(join(ROOT, file), 'utf8')
  const dir = join(ROOT, file, '..')
  const broken = []
  for (const m of text.matchAll(/\[[^\]]*\]\(([^)#\s]+)(?:#[^)\s]*)?\)/g)) {
    const target = m[1]
    if (/^([a-z]+:)?\/\//.test(target) || target.startsWith('mailto:')) continue
    if (!existsSync(join(dir, target))) broken.push(target)
  }
  return broken
}

/** Все markdown-файлы KB и точек входа — для проверки ссылок. */
function docFiles() {
  const files = ['AGENTS.md', 'CLAUDE.md']
  for (const dir of PKG_GLOB_DIRS) {
    const base = join(ROOT, dir)
    if (!existsSync(base)) continue
    for (const name of readdirSync(base)) {
      const rel = `${dir}/${name}/AGENTS.md`
      if (existsSync(join(ROOT, rel))) files.push(rel)
    }
  }
  for (const t of topicFiles()) files.push(relative(ROOT, t.path))
  return files
}

function journalEntries() {
  if (!existsSync(LOG_DIR)) return []
  return readdirSync(LOG_DIR)
    .filter((f) => f.endsWith('.md') && f !== 'README.md')
    .sort()
    .reverse()
    .map((f) => {
      const { data } = parseFrontMatter(readFileSync(join(LOG_DIR, f), 'utf8'))
      return { file: f, title: data.title ?? f.replace(/\.md$/, ''), date: data.date ?? '' }
    })
}

function cmdCheck(strict) {
  const stale = []
  for (const t of topicFiles()) {
    const s = staleness(t)
    if (s.stale) stale.push({ ...t, why: s.why })
  }

  console.log(C.bold('База знаний docs/kb'))
  if (stale.length === 0) {
    console.log(C.green('  ✓ все темы свежие относительно своих areas'))
  } else {
    console.log(C.yellow(`  ⚠ требуют сверки с кодом (${stale.length}):`))
    for (const s of stale) console.log(`    ${s.file} — ${s.why}`)
    console.log(
      C.dim('    после сверки: node scripts/kb.mjs touch <файл>  (или /kb-update в Claude Code)')
    )
  }

  const missing = packagesWithoutAgentsMd()
  if (missing.length) {
    console.log(C.yellow(`  ⚠ пакеты без AGENTS.md: ${missing.join(', ')}`))
  }

  let brokenTotal = 0
  for (const file of docFiles()) {
    const broken = brokenLinks(file)
    if (broken.length) {
      brokenTotal += broken.length
      console.log(C.red(`  ✗ битые ссылки в ${file}: ${broken.join(', ')}`))
    }
  }

  const problems = stale.length + missing.length + brokenTotal
  if (brokenTotal === 0 && problems === 0) console.log(C.green('  ✓ ссылки и покрытие пакетов в порядке'))
  if (strict && problems > 0) process.exitCode = 1
}

function cmdIndex() {
  const topics = topicFiles()
  const entries = journalEntries()
  const lines = []
  lines.push('<!-- Файл генерируется: npm run kb:index. Руками не правь, при конфликте перегенерируй. -->')
  lines.push('')
  lines.push('# База знаний voiceAIChat')
  lines.push('')
  lines.push('Точка входа для агента — корневой [AGENTS.md](../../AGENTS.md).')
  lines.push('Правила ведения этой базы — [kb-workflow.md](kb-workflow.md).')
  lines.push('')
  lines.push('## Темы')
  lines.push('')
  lines.push('| Файл | Тема | Сверено | Статус |')
  lines.push('|---|---|---|---|')
  for (const t of topics) {
    const s = staleness(t)
    const status = s.stale ? `⚠ ${s.why}` : '✓'
    lines.push(`| [${t.file}](${t.file}) | ${t.title} | ${t.updated || '—'} | ${status} |`)
  }
  lines.push('')
  lines.push('## Инструкции по пакетам')
  lines.push('')
  for (const dir of PKG_GLOB_DIRS) {
    const base = join(ROOT, dir)
    if (!existsSync(base)) continue
    for (const name of readdirSync(base).sort()) {
      const rel = `${dir}/${name}/AGENTS.md`
      if (existsSync(join(ROOT, rel))) lines.push(`- [${dir}/${name}](../../${rel})`)
    }
  }
  lines.push('')
  lines.push('## Журнал сессий')
  lines.push('')
  if (entries.length === 0) {
    lines.push('_пусто_ — новая запись: `npm run kb:log -- <slug>`')
  } else {
    lines.push(`Всего записей: ${entries.length}. Последние:`)
    lines.push('')
    for (const e of entries.slice(0, 10)) {
      lines.push(`- [${e.file}](log/${e.file})${e.title ? ` — ${e.title}` : ''}`)
    }
  }
  lines.push('')
  lines.push('## Исторические планы')
  lines.push('')
  lines.push('`docs/plans/` — планы фич с чек-листами. Это намерения, а не состояние кода.')
  lines.push('')
  writeFileSync(INDEX_FILE, lines.join('\n'))
  console.log(C.green(`✓ ${relative(ROOT, INDEX_FILE)} перегенерирован (тем: ${topics.length}, записей журнала: ${entries.length})`))
}

/** Короткое имя машины — попадает в имя файла журнала, чтобы записи не конфликтовали. */
function machineSlug() {
  if (process.env.VC_KB_MACHINE) return process.env.VC_KB_MACHINE
  const host = hostname()
    .replace(/\.local$|\.lan$/i, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
  return host || 'unknown'
}

function slugify(s) {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9Ѐ-ӿ]+/gi, '-')
    .replace(/^-|-$/g, '')
}

function cmdLog(args) {
  const slug = slugify(args.join(' '))
  if (!slug) {
    console.error('Укажи короткий slug: npm run kb:log -- добавлен-pty-релей')
    process.exitCode = 1
    return
  }
  mkdirSync(LOG_DIR, { recursive: true })
  const name = `${today()}-${machineSlug()}-${slug}.md`
  const path = join(LOG_DIR, name)
  if (existsSync(path)) {
    console.log(C.yellow(`уже существует: docs/kb/log/${name}`))
    return
  }
  const author = git(['config', 'user.name']) || 'unknown'
  const body = `---
title: ${args.join(' ')}
date: ${today()}
machine: ${machineSlug()}
author: ${author}
---

# ${args.join(' ')}

## Что сделано

-

## Что выяснили (факты, которых не было в KB)

-

## Куда занесено

- docs/kb/…

## Открытые вопросы / что осталось

-
`
  writeFileSync(path, body)
  console.log(C.green(`✓ создана запись docs/kb/log/${name}`))
}

function cmdTouch(args) {
  if (args.length === 0) {
    console.error('Укажи файл(ы): node scripts/kb.mjs touch protocol llm')
    process.exitCode = 1
    return
  }
  for (const arg of args) {
    const candidates = [
      join(ROOT, arg),
      join(KB_DIR, arg),
      join(KB_DIR, arg.endsWith('.md') ? arg : `${arg}.md`)
    ]
    const path = candidates.find((p) => existsSync(p))
    if (!path) {
      console.error(C.red(`не найден: ${arg}`))
      process.exitCode = 1
      continue
    }
    const text = readFileSync(path, 'utf8')
    const { data } = parseFrontMatter(text)
    if (!('updated' in data)) {
      console.error(C.red(`нет фронтматтера с updated: ${relative(ROOT, path)}`))
      process.exitCode = 1
      continue
    }
    // Пишем и дату (для человека), и sha HEAD (для точной проверки свежести).
    const head = git(['rev-parse', '--short', 'HEAD'])
    let next = text.replace(/^(updated:\s*).*$/m, `$1${today()}`)
    next =
      'checked' in data
        ? next.replace(/^(checked:\s*).*$/m, `$1${head}`)
        : next.replace(/^(updated:\s*.*)$/m, `$1\nchecked: ${head}`)
    writeFileSync(path, next)
    console.log(C.green(`✓ ${relative(ROOT, path)} → updated: ${today()}, checked: ${head}`))
  }
}

const [cmd, ...rest] = process.argv.slice(2)
switch (cmd) {
  case undefined:
    cmdCheck(false)
    console.log('')
    cmdIndex()
    break
  case 'check':
    cmdCheck(rest.includes('--strict'))
    break
  case 'index':
    cmdIndex()
    break
  case 'log':
    cmdLog(rest)
    break
  case 'touch':
    cmdTouch(rest)
    break
  default:
    console.error(`Неизвестная команда: ${cmd}. Доступно: check, index, log, touch.`)
    process.exitCode = 1
}
