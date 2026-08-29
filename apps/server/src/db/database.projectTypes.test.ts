import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import Database from 'better-sqlite3'
import { VoiceChatDb } from './database.js'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { BUILTIN_PROJECT_TYPE_IDS, PROJECT_FEATURES } from '@voicechat/shared'

let db: VoiceChatDb

beforeEach(() => {
  let id = 0
  let clock = 1000
  db = new VoiceChatDb(':memory:', { newId: () => `id-${++id}`, now: () => (clock += 10) })
  db.createUser('alice', '', 'developer')
  db.createUser('bob', '', 'developer')
})
afterEach(() => db.close())

describe('дерево типов: посев и каталог', () => {
  it('встроенные узлы засеяны, помечены builtin и опубликованы', () => {
    const all = db.allProjectTypes()
    const ids = all.map((t) => t.id).sort()
    expect(ids).toEqual(Object.values(BUILTIN_PROJECT_TYPE_IDS).sort())
    for (const node of all) {
      expect(node.builtin).toBe(true)
      expect(node.status).toBe('published')
      expect(node.ownerId).toBeNull()
    }
  })

  it('каталог показывает встроенные, свои и опубликованные, но не чужие личные', () => {
    const mine = db.createProjectType('alice', { parentId: BUILTIN_PROJECT_TYPE_IDS.software, name: 'Мой подтип' })
    expect(db.listProjectTypes('alice').map((t) => t.id)).toContain(mine.id)
    expect(db.listProjectTypes('bob').map((t) => t.id)).not.toContain(mine.id)

    db.setProjectTypeStatus('alice', mine.id, 'pending')
    // Отправленный на утверждение ещё не общий.
    expect(db.listProjectTypes('bob').map((t) => t.id)).not.toContain(mine.id)
    db.setProjectTypeStatus('admin', mine.id, 'published')
    expect(db.listProjectTypes('bob').map((t) => t.id)).toContain(mine.id)
  })

  it('встроенный узел нельзя изменить или удалить', () => {
    expect(() => db.updateProjectType(BUILTIN_PROJECT_TYPE_IDS.general, { name: 'Другое' })).toThrow(/встроенн/i)
    expect(() => db.deleteProjectType(BUILTIN_PROJECT_TYPE_IDS.general)).toThrow(/встроенн/i)
  })
})

describe('дерево типов: инварианты структуры', () => {
  it('цикл при смене родителя запрещён', () => {
    const parent = db.createProjectType('alice', { parentId: BUILTIN_PROJECT_TYPE_IDS.software, name: 'Родитель' })
    const child = db.createProjectType('alice', { parentId: parent.id, name: 'Ребёнок' })
    expect(() => db.updateProjectType(parent.id, { parentId: child.id })).toThrow(/потомком самого себя/i)
    expect(() => db.updateProjectType(parent.id, { parentId: parent.id })).toThrow(/потомком самого себя/i)
  })

  it('глубина ограничена', () => {
    let parentId: string = BUILTIN_PROJECT_TYPE_IDS.software
    // Корень уже занимает первый уровень, поэтому пятый узел ещё проходит, шестой — нет.
    for (let i = 2; i <= 5; i++) parentId = db.createProjectType('alice', { parentId, name: `Уровень ${i}` }).id
    expect(() => db.createProjectType('alice', { parentId, name: 'Уровень 6' })).toThrow(/вложенност/i)
  })

  it('несуществующий родитель отклоняется, пустое имя тоже', () => {
    expect(() => db.createProjectType('alice', { parentId: 'нет-такого', name: 'X' })).toThrow(/не найден/i)
    expect(() => db.createProjectType('alice', { parentId: null, name: '   ' })).toThrow(/Название/i)
  })

  it('удаление запрещено при детях и при используемых проектах', () => {
    const parent = db.createProjectType('alice', { parentId: null, name: 'Родитель' })
    const child = db.createProjectType('alice', { parentId: parent.id, name: 'Ребёнок' })
    expect(() => db.deleteProjectType(parent.id)).toThrow(/подтип/i)

    db.createProject('alice', { name: 'P', typeId: child.id })
    expect(() => db.deleteProjectType(child.id)).toThrow(/используют проекты/i)
  })
})

describe('дерево типов: публикация', () => {
  it('нельзя опубликовать узел с приватным предком', () => {
    const parent = db.createProjectType('alice', { parentId: null, name: 'Личный родитель' })
    const child = db.createProjectType('alice', { parentId: parent.id, name: 'Ребёнок' })
    expect(() => db.setProjectTypeStatus('alice', child.id, 'pending')).toThrow(/родительск/i)

    db.setProjectTypeStatus('admin', parent.id, 'published')
    expect(db.setProjectTypeStatus('alice', child.id, 'pending')?.status).toBe('pending')
  })

  it('решения администратора пишутся в аудит', () => {
    const node = db.createProjectType('alice', { parentId: null, name: 'На ревью' })
    db.setProjectTypeStatus('alice', node.id, 'pending')
    const rejected = db.setProjectTypeStatus('admin', node.id, 'rejected', 'слишком узкий')
    expect(rejected?.status).toBe('rejected')
    expect(rejected?.reviewNote).toBe('слишком узкий')

    const audit = db.projectTypeReviewAudit(node.id)
    expect(audit.map((a) => [a.oldStatus, a.newStatus])).toEqual([['private', 'pending'], ['pending', 'rejected']])
    expect(audit[1].actor).toBe('admin')
    expect(audit[1].note).toBe('слишком узкий')
  })

  it('публикацию нельзя отозвать, пока тип используют чужие проекты', () => {
    const node = db.createProjectType('alice', { parentId: null, name: 'Общий' })
    db.setProjectTypeStatus('admin', node.id, 'published')
    db.createProject('bob', { name: 'Чужой проект', typeId: node.id })
    expect(() => db.setProjectTypeStatus('alice', node.id, 'private')).toThrow(/чужие проекты/i)
  })
})

describe('проект и его тип', () => {
  it('без указания типа проект получает встроенный корень', () => {
    const p = db.createProject('alice', { name: 'P' })
    expect(p.typeId).toBe(BUILTIN_PROJECT_TYPE_IDS.software)
    expect(p.typeChain.label).toBe('Разработка ПО')
    for (const feature of PROJECT_FEATURES) expect(p.typeChain.features[feature], feature).toBe(true)
  })

  it('«Общий проект» отдаёт выключенные возможности и короткую доску', () => {
    const p = db.createProject('alice', { name: 'Общий', typeId: BUILTIN_PROJECT_TYPE_IDS.general })
    for (const feature of PROJECT_FEATURES) expect(p.typeChain.features[feature], feature).toBe(false)
    expect(db.projectFeatures(p.id).ci).toBe(false)

    const semantics = db.getBoard('alice', p.id)!.columns.map((c) => c.semanticType)
    expect(semantics).toEqual(['backlog', 'development', 'done', 'cancelled', 'decision_required'])
  })

  it('подтип наследует возможности и приносит свои заготовки', () => {
    const p = db.createProject('alice', { name: 'Веб', typeId: BUILTIN_PROJECT_TYPE_IDS.web })
    expect(p.typeChain.label).toBe('Разработка ПО / Веб-приложение')
    expect(p.typeChain.features.preview).toBe(true)
    expect(p.technologies).toEqual(['web'])
    // У «Разработки ПО» своих колонок нет — остаётся системный конвейер.
    expect(db.getBoard('alice', p.id)!.columns.length).toBe(13)
  })

  it('явный аргумент важнее заготовки типа', () => {
    const p = db.createProject('alice', { name: 'Веб', typeId: BUILTIN_PROJECT_TYPE_IDS.web, technologies: ['go'] })
    expect(p.technologies).toEqual(['go'])
  })

  it('неизвестный тип при создании откатывается на встроенный корень', () => {
    const p = db.createProject('alice', { name: 'P', typeId: 'нет-такого' })
    expect(p.typeId).toBe(BUILTIN_PROJECT_TYPE_IDS.software)
  })

  it('смена типа меняет возможности, но не трогает уже созданную доску', () => {
    const p = db.createProject('alice', { name: 'P' })
    const before = db.getBoard('alice', p.id)!.columns.map((c) => c.id)
    const updated = db.updateProject('alice', p.id, { typeId: BUILTIN_PROJECT_TYPE_IDS.general })!
    expect(updated.typeChain.features.releases).toBe(false)
    expect(db.projectFeatures(p.id).releases).toBe(false)
    // Заготовки — снимок: колонки остаются теми же самыми.
    expect(db.getBoard('alice', p.id)!.columns.map((c) => c.id)).toEqual(before)
    expect(() => db.updateProject('alice', p.id, { typeId: 'нет-такого' })).toThrow(/не найден/i)
  })

  it('правка возможностей типа действует на существующие проекты живьём', () => {
    const own = db.createProjectType('alice', { parentId: BUILTIN_PROJECT_TYPE_IDS.software, name: 'Без релизов', features: { releases: false } })
    const p = db.createProject('alice', { name: 'P', typeId: own.id })
    expect(db.projectFeatures(p.id).releases).toBe(false)
    db.updateProjectType(own.id, { features: { releases: true } })
    // Кэш цепочек обязан сброситься, иначе гейт останется на старом значении.
    expect(db.projectFeatures(p.id).releases).toBe(true)
  })
})

describe('сохранить проект как подтип', () => {
  it('узел встаёт под текущим типом и повторяет доску, теги и настройки проекта', () => {
    const p = db.createProject('alice', { name: 'Настроенный', typeId: BUILTIN_PROJECT_TYPE_IDS.general, technologies: ['ремонт'], skills: ['смета'] })
    db.renameColumn('alice', p.id, db.getBoard('alice', p.id)!.columns[0].id, 'Идеи')
    const board = db.getBoard('alice', p.id)!
    expect(board.columns[0].name).toBe('Идеи')

    const derived = db.deriveProjectType('alice', p.id, '  Ремонтный проект  ')!
    expect(derived.name).toBe('Ремонтный проект')
    expect(derived.parentId).toBe(BUILTIN_PROJECT_TYPE_IDS.general)
    expect(derived.status).toBe('private')
    expect(derived.ownerId).toBe('alice')
    expect(derived.defaults.technologies).toEqual(['ремонт'])
    expect(derived.defaults.columns?.map((c) => c.semanticType)).toEqual(board.columns.map((c) => c.semanticType))
    // Переименованная колонка переносится в заготовку вместе с именем.
    expect(derived.defaults.columns?.[0]?.name).toBe('Идеи')

    // Новый проект от этого узла воспроизводит исходную доску и теги.
    const clone = db.createProject('alice', { name: 'Клон', typeId: derived.id })
    expect(clone.technologies).toEqual(['ремонт'])
    expect(db.getBoard('alice', clone.id)!.columns.map((c) => c.name)).toEqual(board.columns.map((c) => c.name))
  })

  it('возможности снимаются эффективные и не зависят от последующей правки родителя', () => {
    const parent = db.createProjectType('alice', { parentId: BUILTIN_PROJECT_TYPE_IDS.software, name: 'Без релизов', features: { releases: false } })
    const p = db.createProject('alice', { name: 'P', typeId: parent.id })
    const derived = db.deriveProjectType('alice', p.id, 'Слепок')!
    expect(derived.features.releases).toBe(false)
    expect(derived.features.ci).toBe(true)

    // Родителю вернули релизы — слепок остаётся при своём.
    db.updateProjectType(parent.id, { features: { releases: true } })
    expect(db.projectTypeChain(derived.id).features.releases).toBe(false)
  })

  it('не владелец и пустое имя отклоняются', () => {
    const p = db.createProject('alice', { name: 'P' })
    expect(db.deriveProjectType('bob', p.id, 'X')).toBeNull()
    expect(() => db.deriveProjectType('alice', p.id, '   ')).toThrow(/Название/i)
  })
})

describe('миграция существующей базы', () => {
  it('старый проект получает корневой тип, повторное открытие не плодит узлы', () => {
    const dir = mkdtempSync(join(tmpdir(), 'vc-ptypes-'))
    const file = join(dir, 'db.sqlite')
    try {
      const first = new VoiceChatDb(file)
      first.createUser('alice', '', 'developer')
      const p = first.createProject('alice', { name: 'Старый' })
      first.close()
      // Имитируем базу до появления типов: зануляем колонку в обход слоя.
      const raw = new Database(file)
      raw.prepare(`UPDATE projects SET project_type_id = NULL WHERE id = ?`).run(p.id)
      raw.close()

      const second = new VoiceChatDb(file)
      const migrated = second.getProject('alice', p.id)!
      expect(migrated.typeId).toBe(BUILTIN_PROJECT_TYPE_IDS.software)
      expect(migrated.typeChain.features.ci).toBe(true)
      expect(second.allProjectTypes().length).toBe(3)
      second.close()

      const third = new VoiceChatDb(file)
      expect(third.allProjectTypes().length).toBe(3)
      third.close()
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('перезапуск не дописывает «Общему проекту» конвейер разработки', () => {
    // Канонизация workflow-колонок гарантирует конвейер dev-проектам; для типа,
    // который его выключил, она обязана молчать — иначе короткая доска не
    // переживает ни одного перезапуска сервера.
    const dir = mkdtempSync(join(tmpdir(), 'vc-ptypes-cols-'))
    const file = join(dir, 'db.sqlite')
    try {
      const first = new VoiceChatDb(file)
      first.createUser('alice', '', 'developer')
      const general = first.createProject('alice', { name: 'Общий', typeId: BUILTIN_PROJECT_TYPE_IDS.general })
      const software = first.createProject('alice', { name: 'Разработка' })
      expect(first.getBoard('alice', general.id)!.columns.length).toBe(5)
      first.close()

      const second = new VoiceChatDb(file)
      const semantics = second.getBoard('alice', general.id)!.columns.map((c) => c.semanticType)
      expect(semantics).toEqual(['backlog', 'development', 'done', 'cancelled', 'decision_required'])
      // А dev-проекту канонизация по-прежнему гарантирует полный конвейер.
      expect(second.getBoard('alice', software.id)!.columns.length).toBe(13)
      second.close()
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('настроенная доска переживает перезапуск: имена, своя колонка и скрытие целы', () => {
    // Канонизация системных колонок дописывает недостающие. Проверяем, что она не
    // трогает то, что человек настроил руками, — иначе каждый перезапуск сервера
    // возвращал бы доску к заводскому виду.
    const dir = mkdtempSync(join(tmpdir(), 'vc-ptypes-board-'))
    const file = join(dir, 'db.sqlite')
    try {
      const first = new VoiceChatDb(file)
      first.createUser('alice', '', 'developer')
      const project = first.createProject('alice', { name: 'Настроенный' })
      const board = first.getBoard('alice', project.id)!
      const backlog = board.columns.find((c) => c.semanticType === 'backlog')!

      first.renameColumn('alice', project.id, backlog.id, 'Идеи')
      const custom = first.createColumn('alice', project.id, 'Согласование')!
      first.setColumnHidden('alice', project.id, board.columns.find((c) => c.semanticType === 'merge')!.id, true)
      const task = first.createTask('alice', project.id, { columnId: backlog.id, title: 'Задача' })!
      const before = first.getBoard('alice', project.id)!
      first.close()

      const second = new VoiceChatDb(file)
      const after = second.getBoard('alice', project.id, { includeCompleted: true })!
      // Количество колонок не выросло: дубли системных не появились.
      expect(after.columns.length).toBe(before.columns.length)
      expect(after.columns.find((c) => c.semanticType === 'backlog')?.name).toBe('Идеи')
      expect(after.columns.some((c) => c.id === custom.id && c.name === 'Согласование')).toBe(true)
      // Скрытие — пользовательская настройка; до этой правки канонизация сбрасывала
      // его на каждом старте сервера, и колонка возвращалась на доску сама.
      expect(after.columns.find((c) => c.semanticType === 'merge')?.hidden).toBe(true)
      // Карточка осталась в своей колонке.
      expect(after.tasks.find((t) => t.id === task.id)?.columnId).toBe(backlog.id)
      second.close()
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('своя колонка в «Общем проекте» не удаляется канонизацией', () => {
    const dir = mkdtempSync(join(tmpdir(), 'vc-ptypes-general-col-'))
    const file = join(dir, 'db.sqlite')
    try {
      const first = new VoiceChatDb(file)
      first.createUser('alice', '', 'developer')
      const project = first.createProject('alice', { name: 'Общий', typeId: BUILTIN_PROJECT_TYPE_IDS.general })
      const custom = first.createColumn('alice', project.id, 'Закупка')!
      first.close()

      const second = new VoiceChatDb(file)
      const columns = second.getBoard('alice', project.id)!.columns
      // Тип задаёт минимум, а не потолок: добавленное человеком остаётся.
      expect(columns.some((c) => c.id === custom.id)).toBe(true)
      expect(columns.length).toBe(6)
      second.close()
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('посев не затирает пользовательские узлы', () => {
    const dir = mkdtempSync(join(tmpdir(), 'vc-ptypes-user-'))
    const file = join(dir, 'db.sqlite')
    try {
      const first = new VoiceChatDb(file)
      first.createUser('alice', '', 'developer')
      const own = first.createProjectType('alice', { parentId: null, name: 'Мой', description: 'моё описание' })
      first.close()

      const second = new VoiceChatDb(file)
      const same = second.getProjectType(own.id)!
      expect(same.name).toBe('Мой')
      expect(same.description).toBe('моё описание')
      expect(same.builtin).toBe(false)
      expect(same.status).toBe('private')
      second.close()
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
  it('нормализация шаблона ветки разовая: осознанный feature/{task_number} переживает перезапуск', () => {
    const dir = mkdtempSync(join(tmpdir(), 'vc-branch-tpl-'))
    const file = join(dir, 'db.sqlite')
    try {
      // Первое открытие уже проставило отметку о разовой нормализации.
      const first = new VoiceChatDb(file)
      first.createUser('alice', '', 'developer')
      const project = first.createProject('alice', { name: 'Ветки' })
      // Человек осознанно выбирает исторический шаблон — он ничем не хуже нового.
      first.updateProject('alice', project.id, { ciBranchTemplate: 'feature/{task_number}' })
      expect(first.getProject('alice', project.id)!.ciBranchTemplate).toBe('feature/{task_number}')
      first.close()

      const second = new VoiceChatDb(file)
      expect(second.getProject('alice', project.id)!.ciBranchTemplate).toBe('feature/{task_number}')
      second.close()
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
  it('старая база нормализуется один раз: исторический дефолт заменяется, отметка ставится', () => {
    const dir = mkdtempSync(join(tmpdir(), 'vc-branch-tpl-legacy-'))
    const file = join(dir, 'db.sqlite')
    try {
      const first = new VoiceChatDb(file)
      first.createUser('alice', '', 'developer')
      const project = first.createProject('alice', { name: 'Старая' })
      first.close()

      // Воспроизводим базу, созданную до нормализации: старый дефолт и нет отметки.
      const raw = new Database(file)
      raw.prepare(`UPDATE projects SET ci_branch_template='feature/{task_number}-{slug}' WHERE id=?`).run(project.id)
      raw.prepare(`DELETE FROM app_config WHERE key='migration.ciBranchTemplate.normalized'`).run()
      raw.close()

      const second = new VoiceChatDb(file)
      expect(second.getProject('alice', project.id)!.ciBranchTemplate).toBe('{task_number}')
      expect(second.getAppConfig('migration.ciBranchTemplate.normalized')).toBe('1')
      second.close()
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
