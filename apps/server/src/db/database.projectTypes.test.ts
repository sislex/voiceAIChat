import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import Database from 'better-sqlite3'
import { VoiceChatDb } from './database.js'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { BUILTIN_PROJECT_TYPE_IDS, PROJECT_FEATURES } from '@voicechat/shared'

let db: VoiceChatDb

beforeEach(async () => {
  let id = 0
  let clock = 1000
  db = new VoiceChatDb(':memory:', { newId: () => `id-${++id}`, now: () => (clock += 10) })
  await db.identity.createUser('alice', '', 'developer')
  await db.identity.createUser('bob', '', 'developer')
})
afterEach(() => db.close())

describe('дерево типов: посев и каталог', () => {
  it('встроенные узлы засеяны, помечены builtin и опубликованы', async () => {
    const all = await db.projects.allProjectTypes()
    const ids = all.map((t) => t.id).sort()
    expect(ids).toEqual(Object.values(BUILTIN_PROJECT_TYPE_IDS).sort())
    for (const node of all) {
      expect(node.builtin).toBe(true)
      expect(node.status).toBe('published')
      expect(node.ownerId).toBeNull()
    }
  })

  it('каталог показывает встроенные, свои и опубликованные, но не чужие личные', async () => {
    const mine = await db.projects.createProjectType('alice', { parentId: BUILTIN_PROJECT_TYPE_IDS.software, name: 'Мой подтип' })
    expect((await db.projects.listProjectTypes('alice')).map((t) => t.id)).toContain(mine.id)
    expect((await db.projects.listProjectTypes('bob')).map((t) => t.id)).not.toContain(mine.id)

    await db.projects.setProjectTypeStatus('alice', mine.id, 'pending')
    // Отправленный на утверждение ещё не общий.
    expect((await db.projects.listProjectTypes('bob')).map((t) => t.id)).not.toContain(mine.id)
    await db.projects.setProjectTypeStatus('admin', mine.id, 'published')
    expect((await db.projects.listProjectTypes('bob')).map((t) => t.id)).toContain(mine.id)
  })

  it('встроенный узел нельзя изменить или удалить', async () => {
    await expect(async () => await db.projects.updateProjectType(BUILTIN_PROJECT_TYPE_IDS.general, { name: 'Другое' })).rejects.toThrow(/встроенн/i)
    await expect(async () => await db.projects.deleteProjectType(BUILTIN_PROJECT_TYPE_IDS.general)).rejects.toThrow(/встроенн/i)
  })
})

describe('дерево типов: инварианты структуры', () => {
  it('цикл при смене родителя запрещён', async () => {
    const parent = await db.projects.createProjectType('alice', { parentId: BUILTIN_PROJECT_TYPE_IDS.software, name: 'Родитель' })
    const child = await db.projects.createProjectType('alice', { parentId: parent.id, name: 'Ребёнок' })
    await expect(async () => await db.projects.updateProjectType(parent.id, { parentId: child.id })).rejects.toThrow(/потомком самого себя/i)
    await expect(async () => await db.projects.updateProjectType(parent.id, { parentId: parent.id })).rejects.toThrow(/потомком самого себя/i)
  })

  it('глубина ограничена', async () => {
    let parentId: string = BUILTIN_PROJECT_TYPE_IDS.software
    // Корень уже занимает первый уровень, поэтому пятый узел ещё проходит, шестой — нет.
    for (let i = 2; i <= 5; i++) parentId = (await db.projects.createProjectType('alice', { parentId, name: `Уровень ${i}` })).id
    await expect(async () => await db.projects.createProjectType('alice', { parentId, name: 'Уровень 6' })).rejects.toThrow(/вложенност/i)
  })

  it('несуществующий родитель отклоняется, пустое имя тоже', async () => {
    await expect(async () => await db.projects.createProjectType('alice', { parentId: 'нет-такого', name: 'X' })).rejects.toThrow(/не найден/i)
    await expect(async () => await db.projects.createProjectType('alice', { parentId: null, name: '   ' })).rejects.toThrow(/Название/i)
  })

  it('удаление запрещено при детях и при используемых проектах', async () => {
    const parent = await db.projects.createProjectType('alice', { parentId: null, name: 'Родитель' })
    const child = await db.projects.createProjectType('alice', { parentId: parent.id, name: 'Ребёнок' })
    await expect(async () => await db.projects.deleteProjectType(parent.id)).rejects.toThrow(/подтип/i)

    await db.projects.createProject('alice', { name: 'P', typeId: child.id })
    await expect(async () => await db.projects.deleteProjectType(child.id)).rejects.toThrow(/используют проекты/i)
  })
})

describe('дерево типов: публикация', () => {
  it('нельзя опубликовать узел с приватным предком', async () => {
    const parent = await db.projects.createProjectType('alice', { parentId: null, name: 'Личный родитель' })
    const child = await db.projects.createProjectType('alice', { parentId: parent.id, name: 'Ребёнок' })
    await expect(async () => await db.projects.setProjectTypeStatus('alice', child.id, 'pending')).rejects.toThrow(/родительск/i)

    await db.projects.setProjectTypeStatus('admin', parent.id, 'published')
    expect((await db.projects.setProjectTypeStatus('alice', child.id, 'pending'))?.status).toBe('pending')
  })

  it('решения администратора пишутся в аудит', async () => {
    const node = await db.projects.createProjectType('alice', { parentId: null, name: 'На ревью' })
    await db.projects.setProjectTypeStatus('alice', node.id, 'pending')
    const rejected = await db.projects.setProjectTypeStatus('admin', node.id, 'rejected', 'слишком узкий')
    expect(rejected?.status).toBe('rejected')
    expect(rejected?.reviewNote).toBe('слишком узкий')

    const audit = await db.projects.projectTypeReviewAudit(node.id)
    expect(audit.map((a) => [a.oldStatus, a.newStatus])).toEqual([['private', 'pending'], ['pending', 'rejected']])
    expect(audit[1].actor).toBe('admin')
    expect(audit[1].note).toBe('слишком узкий')
  })

  it('публикацию нельзя отозвать, пока тип используют чужие проекты', async () => {
    const node = await db.projects.createProjectType('alice', { parentId: null, name: 'Общий' })
    await db.projects.setProjectTypeStatus('admin', node.id, 'published')
    await db.projects.createProject('bob', { name: 'Чужой проект', typeId: node.id })
    await expect(async () => await db.projects.setProjectTypeStatus('alice', node.id, 'private')).rejects.toThrow(/чужие проекты/i)
  })
})

describe('проект и его тип', () => {
  it('без указания типа проект получает встроенный корень', async () => {
    const p = await db.projects.createProject('alice', { name: 'P' })
    expect(p.typeId).toBe(BUILTIN_PROJECT_TYPE_IDS.software)
    expect(p.typeChain.label).toBe('Разработка ПО')
    for (const feature of PROJECT_FEATURES) expect(p.typeChain.features[feature], feature).toBe(true)
  })

  it('«Общий проект» отдаёт выключенные возможности и короткую доску', async () => {
    const p = await db.projects.createProject('alice', { name: 'Общий', typeId: BUILTIN_PROJECT_TYPE_IDS.general })
    for (const feature of PROJECT_FEATURES) expect(p.typeChain.features[feature], feature).toBe(false)
    expect((await db.projects.projectFeatures(p.id)).ci).toBe(false)

    const semantics = (await db.tasks.getBoard('alice', p.id))!.columns.map((c) => c.semanticType)
    expect(semantics).toEqual(['backlog', 'development', 'done', 'cancelled', 'decision_required'])
  })

  it('подтип наследует возможности и приносит свои заготовки', async () => {
    const p = await db.projects.createProject('alice', { name: 'Веб', typeId: BUILTIN_PROJECT_TYPE_IDS.web })
    expect(p.typeChain.label).toBe('Разработка ПО / Веб-приложение')
    expect(p.typeChain.features.preview).toBe(true)
    expect(p.technologies).toEqual(['web'])
    // У «Разработки ПО» своих колонок нет — остаётся системный конвейер.
    expect((await db.tasks.getBoard('alice', p.id))!.columns.length).toBe(13)
  })

  it('новые встроенные подтипы копируют свои заготовки в проект', async () => {
    const expected = [
      [BUILTIN_PROJECT_TYPE_IDS.backend, ['backend', 'api', 'database'], 13],
      [BUILTIN_PROJECT_TYPE_IDS.mobile, ['mobile', 'ios', 'android'], 13],
      [BUILTIN_PROJECT_TYPE_IDS.library, ['library', 'sdk', 'package'], 10]
    ] as const

    for (const [typeId, technologies, columnCount] of expected) {
      const p = await db.projects.createProject('alice', { name: typeId, typeId })
      expect(p.technologies).toEqual(technologies)
      expect(p.skills.length).toBeGreaterThan(0)
      expect(p.defaultSkills.task.length).toBeGreaterThan(0)
      expect(p.ciBaseBranch).toBe('main')
      expect(p.ciBranchTemplate).toBe('{task_number}')
      expect(p.ciReuseStrategy).toBe('clean')
      expect((await db.tasks.getBoard('alice', p.id))!.columns).toHaveLength(columnCount)
    }
    const library = await db.projects.createProject('alice', { name: 'Библиотека', typeId: BUILTIN_PROJECT_TYPE_IDS.library })
    expect(library.typeChain.features.preview).toBe(false)
    expect(library.typeChain.features.ci).toBe(true)
  })

  it('явный аргумент важнее заготовки типа', async () => {
    const p = await db.projects.createProject('alice', { name: 'Веб', typeId: BUILTIN_PROJECT_TYPE_IDS.web, technologies: ['go'] })
    expect(p.technologies).toEqual(['go'])
  })

  it('неизвестный тип при создании откатывается на встроенный корень', async () => {
    const p = await db.projects.createProject('alice', { name: 'P', typeId: 'нет-такого' })
    expect(p.typeId).toBe(BUILTIN_PROJECT_TYPE_IDS.software)
  })

  it('смена типа меняет возможности, но не трогает уже созданную доску', async () => {
    const p = await db.projects.createProject('alice', { name: 'P' })
    const before = (await db.tasks.getBoard('alice', p.id))!.columns.map((c) => c.id)
    const updated = (await db.projects.updateProject('alice', p.id, { typeId: BUILTIN_PROJECT_TYPE_IDS.general }))!
    expect(updated.typeChain.features.releases).toBe(false)
    expect((await db.projects.projectFeatures(p.id)).releases).toBe(false)
    // Заготовки — снимок: колонки остаются теми же самыми.
    expect((await db.tasks.getBoard('alice', p.id))!.columns.map((c) => c.id)).toEqual(before)
    await expect(async () => await db.projects.updateProject('alice', p.id, { typeId: 'нет-такого' })).rejects.toThrow(/не найден/i)
  })

  it('правка возможностей типа действует на существующие проекты живьём', async () => {
    const own = await db.projects.createProjectType('alice', { parentId: BUILTIN_PROJECT_TYPE_IDS.software, name: 'Без релизов', features: { releases: false } })
    const p = await db.projects.createProject('alice', { name: 'P', typeId: own.id })
    expect((await db.projects.projectFeatures(p.id)).releases).toBe(false)
    await db.projects.updateProjectType(own.id, { features: { releases: true } })
    // Кэш цепочек обязан сброситься, иначе гейт останется на старом значении.
    expect((await db.projects.projectFeatures(p.id)).releases).toBe(true)
  })
})

describe('сохранить проект как подтип', () => {
  it('узел встаёт под текущим типом и повторяет доску, теги и настройки проекта', async () => {
    const p = await db.projects.createProject('alice', { name: 'Настроенный', typeId: BUILTIN_PROJECT_TYPE_IDS.general, technologies: ['ремонт'], skills: ['смета'] })
    await db.projects.renameColumn('alice', p.id, (await db.tasks.getBoard('alice', p.id))!.columns[0].id, 'Идеи')
    const board = (await db.tasks.getBoard('alice', p.id))!
    expect(board.columns[0].name).toBe('Идеи')

    const derived = (await db.projects.deriveProjectType('alice', p.id, '  Ремонтный проект  '))!
    expect(derived.name).toBe('Ремонтный проект')
    expect(derived.parentId).toBe(BUILTIN_PROJECT_TYPE_IDS.general)
    expect(derived.status).toBe('private')
    expect(derived.ownerId).toBe('alice')
    expect(derived.defaults.technologies).toEqual(['ремонт'])
    expect(derived.defaults.columns?.map((c) => c.semanticType)).toEqual(board.columns.map((c) => c.semanticType))
    // Переименованная колонка переносится в заготовку вместе с именем.
    expect(derived.defaults.columns?.[0]?.name).toBe('Идеи')

    // Новый проект от этого узла воспроизводит исходную доску и теги.
    const clone = await db.projects.createProject('alice', { name: 'Клон', typeId: derived.id })
    expect(clone.technologies).toEqual(['ремонт'])
    expect((await db.tasks.getBoard('alice', clone.id))!.columns.map((c) => c.name)).toEqual(board.columns.map((c) => c.name))
  })

  it('возможности снимаются эффективные и не зависят от последующей правки родителя', async () => {
    const parent = await db.projects.createProjectType('alice', { parentId: BUILTIN_PROJECT_TYPE_IDS.software, name: 'Без релизов', features: { releases: false } })
    const p = await db.projects.createProject('alice', { name: 'P', typeId: parent.id })
    const derived = (await db.projects.deriveProjectType('alice', p.id, 'Слепок'))!
    expect(derived.features.releases).toBe(false)
    expect(derived.features.ci).toBe(true)

    // Родителю вернули релизы — слепок остаётся при своём.
    await db.projects.updateProjectType(parent.id, { features: { releases: true } })
    expect((await db.projects.projectTypeChain(derived.id)).features.releases).toBe(false)
  })

  it('не владелец и пустое имя отклоняются', async () => {
    const p = await db.projects.createProject('alice', { name: 'P' })
    expect(await db.projects.deriveProjectType('bob', p.id, 'X')).toBeNull()
    await expect(async () => await db.projects.deriveProjectType('alice', p.id, '   ')).rejects.toThrow(/Название/i)
  })
})

describe('миграция существующей базы', () => {
  it('старый проект получает корневой тип, повторное открытие не плодит узлы', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'vc-ptypes-'))
    const file = join(dir, 'db.sqlite')
    try {
      const first = new VoiceChatDb(file)
      await first.ready
      first.identity.createUser('alice', '', 'developer')
      const p = await first.projects.createProject('alice', { name: 'Старый' })
      await first.close()
      // Имитируем базу до появления типов: зануляем колонку в обход слоя.
      const raw = new Database(file)
      raw.prepare(`UPDATE projects SET project_type_id = NULL WHERE id = ?`).run(p.id)
      await raw.close()
      const second = new VoiceChatDb(file)

      await second.ready
      const migrated = (await second.projects.getProject('alice', p.id))!
      expect(migrated.typeId).toBe(BUILTIN_PROJECT_TYPE_IDS.software)
      expect(migrated.typeChain.features.ci).toBe(true)
      expect((await second.projects.allProjectTypes()).length).toBe(6)
      await second.close()
      const third = new VoiceChatDb(file)

      await third.ready
      expect((await third.projects.allProjectTypes()).length).toBe(6)
      await third.close()
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('перезапуск не дописывает «Общему проекту» конвейер разработки', async () => {
    // Канонизация workflow-колонок гарантирует конвейер dev-проектам; для типа,
    // который его выключил, она обязана молчать — иначе короткая доска не
    // переживает ни одного перезапуска сервера.
    const dir = mkdtempSync(join(tmpdir(), 'vc-ptypes-cols-'))
    const file = join(dir, 'db.sqlite')
    try {
      const first = new VoiceChatDb(file)
      await first.ready
      first.identity.createUser('alice', '', 'developer')
      const general = await first.projects.createProject('alice', { name: 'Общий', typeId: BUILTIN_PROJECT_TYPE_IDS.general })
      const software = await first.projects.createProject('alice', { name: 'Разработка' })
      expect((await first.tasks.getBoard('alice', general.id))!.columns.length).toBe(5)
      await first.close()
      const second = new VoiceChatDb(file)

      await second.ready
      const semantics = (await second.tasks.getBoard('alice', general.id))!.columns.map((c) => c.semanticType)
      expect(semantics).toEqual(['backlog', 'development', 'done', 'cancelled', 'decision_required'])
      // А dev-проекту канонизация по-прежнему гарантирует полный конвейер.
      expect((await second.tasks.getBoard('alice', software.id))!.columns.length).toBe(13)
      await second.close()
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('настроенная доска переживает перезапуск: имена, своя колонка и скрытие целы', async () => {
    // Канонизация системных колонок дописывает недостающие. Проверяем, что она не
    // трогает то, что человек настроил руками, — иначе каждый перезапуск сервера
    // возвращал бы доску к заводскому виду.
    const dir = mkdtempSync(join(tmpdir(), 'vc-ptypes-board-'))
    const file = join(dir, 'db.sqlite')
    try {
      const first = new VoiceChatDb(file)
      await first.ready
      first.identity.createUser('alice', '', 'developer')
      const project = await first.projects.createProject('alice', { name: 'Настроенный' })
      const board = (await first.tasks.getBoard('alice', project.id))!
      const backlog = board.columns.find((c) => c.semanticType === 'backlog')!

      first.projects.renameColumn('alice', project.id, backlog.id, 'Идеи')
      const custom = (await first.projects.createColumn('alice', project.id, 'Согласование'))!
      first.projects.setColumnHidden('alice', project.id, board.columns.find((c) => c.semanticType === 'merge')!.id, true)
      const task = (await first.tasks.createTask('alice', project.id, { columnId: backlog.id, title: 'Задача' }))!
      const before = (await first.tasks.getBoard('alice', project.id))!
      await first.close()
      const second = new VoiceChatDb(file)

      await second.ready
      const after = (await second.tasks.getBoard('alice', project.id, { includeCompleted: true }))!
      // Количество колонок не выросло: дубли системных не появились.
      expect(after.columns.length).toBe(before.columns.length)
      expect(after.columns.find((c) => c.semanticType === 'backlog')?.name).toBe('Идеи')
      expect(after.columns.some((c) => c.id === custom.id && c.name === 'Согласование')).toBe(true)
      // Скрытие — пользовательская настройка; до этой правки канонизация сбрасывала
      // его на каждом старте сервера, и колонка возвращалась на доску сама.
      expect(after.columns.find((c) => c.semanticType === 'merge')?.hidden).toBe(true)
      // Карточка осталась в своей колонке.
      expect(after.tasks.find((t) => t.id === task.id)?.columnId).toBe(backlog.id)
      await second.close()
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('своя колонка в «Общем проекте» не удаляется канонизацией', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'vc-ptypes-general-col-'))
    const file = join(dir, 'db.sqlite')
    try {
      const first = new VoiceChatDb(file)
      await first.ready
      first.identity.createUser('alice', '', 'developer')
      const project = await first.projects.createProject('alice', { name: 'Общий', typeId: BUILTIN_PROJECT_TYPE_IDS.general })
      const custom = (await first.projects.createColumn('alice', project.id, 'Закупка'))!
      await first.close()
      const second = new VoiceChatDb(file)

      await second.ready
      const columns = (await second.tasks.getBoard('alice', project.id))!.columns
      // Тип задаёт минимум, а не потолок: добавленное человеком остаётся.
      expect(columns.some((c) => c.id === custom.id)).toBe(true)
      expect(columns.length).toBe(6)
      await second.close()
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('посев не затирает пользовательские узлы', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'vc-ptypes-user-'))
    const file = join(dir, 'db.sqlite')
    try {
      const first = new VoiceChatDb(file)
      await first.ready
      first.identity.createUser('alice', '', 'developer')
      const own = await first.projects.createProjectType('alice', { parentId: null, name: 'Мой', description: 'моё описание' })
      await first.close()
      const second = new VoiceChatDb(file)

      await second.ready
      const same = (await second.projects.getProjectType(own.id))!
      expect(same.name).toBe('Мой')
      expect(same.description).toBe('моё описание')
      expect(same.builtin).toBe(false)
      expect(same.status).toBe('private')
      await second.close()
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
  it('нормализация шаблона ветки разовая: осознанный feature/{task_number} переживает перезапуск', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'vc-branch-tpl-'))
    const file = join(dir, 'db.sqlite')
    try {
      // Первое открытие уже проставило отметку о разовой нормализации.
      const first = new VoiceChatDb(file)
      await first.ready
      first.identity.createUser('alice', '', 'developer')
      const project = await first.projects.createProject('alice', { name: 'Ветки' })
      // Человек осознанно выбирает исторический шаблон — он ничем не хуже нового.
      first.projects.updateProject('alice', project.id, { ciBranchTemplate: 'feature/{task_number}' })
      expect((await first.projects.getProject('alice', project.id))!.ciBranchTemplate).toBe('feature/{task_number}')
      await first.close()
      const second = new VoiceChatDb(file)

      await second.ready
      expect((await second.projects.getProject('alice', project.id))!.ciBranchTemplate).toBe('feature/{task_number}')
      await second.close()
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
  it('старая база нормализуется один раз: исторический дефолт заменяется, отметка ставится', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'vc-branch-tpl-legacy-'))
    const file = join(dir, 'db.sqlite')
    try {
      const first = new VoiceChatDb(file)
      await first.ready
      first.identity.createUser('alice', '', 'developer')
      const project = await first.projects.createProject('alice', { name: 'Старая' })
      await first.close()
      // Воспроизводим базу, созданную до нормализации: старый дефолт и нет отметки.
      const raw = new Database(file)
      raw.prepare(`UPDATE projects SET ci_branch_template='feature/{task_number}-{slug}' WHERE id=?`).run(project.id)
      raw.prepare(`DELETE FROM app_config WHERE key='migration.ciBranchTemplate.normalized'`).run()
      await raw.close()
      const second = new VoiceChatDb(file)

      await second.ready
      expect((await second.projects.getProject('alice', project.id))!.ciBranchTemplate).toBe('{task_number}')
      expect(await second.settings.getAppConfig('migration.ciBranchTemplate.normalized')).toBe('1')
      await second.close()
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
