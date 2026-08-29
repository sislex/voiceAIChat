import { describe, expect, it } from 'vitest'
import {
  BUILTIN_PROJECT_TYPES,
  BUILTIN_PROJECT_TYPE_IDS,
  PROJECT_FEATURES,
  canPublishProjectType,
  featureUnavailableMessage,
  isProjectTypeVisible,
  parseProjectFeature,
  parseProjectFeatureOverride,
  parseProjectTypeStatus,
  projectTypeChainLabel,
  resolveProjectTypeDefaults,
  resolveProjectTypeFeatures,
  type ProjectFeatureOverride,
  type ProjectTypeDefaults,
  type ProjectTypeNode
} from './projectTypes'

const node = (over: Partial<ProjectTypeNode> & { features?: ProjectFeatureOverride; defaults?: ProjectTypeDefaults } = {}): ProjectTypeNode => ({
  id: 'n', parentId: null, name: 'N', description: '', features: {}, defaults: {},
  builtin: false, ownerId: 'bob', status: 'private', reviewNote: '',
  createdBy: 'bob', createdAt: 0, updatedAt: 0, ...over
})

describe('наследование возможностей', () => {
  it('ребёнок выключает унаследованное, а неуказанное наследует', () => {
    const chain = [
      node({ features: { git: true, ci: true, qa: true, preview: true } }),
      node({ features: { preview: false } })
    ]
    const features = resolveProjectTypeFeatures(chain)
    expect(features.preview).toBe(false)
    // Не упомянутые ребёнком возможности приходят от родителя без изменений.
    expect(features.git).toBe(true)
    expect(features.ci).toBe(true)
    expect(features.qa).toBe(true)
  })

  it('ребёнок может и включить обратно то, что родитель выключил', () => {
    const chain = [node({ features: { releases: false } }), node({ features: { releases: true } })]
    expect(resolveProjectTypeFeatures(chain).releases).toBe(true)
  })

  it('ничего не задано — всё выключено, а не «включено по умолчанию»', () => {
    const features = resolveProjectTypeFeatures([node(), node()])
    for (const feature of PROJECT_FEATURES) expect(features[feature], feature).toBe(false)
  })

  it('пустая цепочка даёт полный набор ключей — гейт не должен получать undefined', () => {
    const features = resolveProjectTypeFeatures([])
    expect(Object.keys(features).sort()).toEqual([...PROJECT_FEATURES].sort())
  })
})

describe('наследование заготовок', () => {
  it('массив заменяется целиком, а не склеивается', () => {
    const chain = [
      node({ defaults: { technologies: ['node', 'react'], skills: ['frontend'] } }),
      node({ defaults: { technologies: ['go'] } })
    ]
    const defaults = resolveProjectTypeDefaults(chain)
    // Иначе подтип не смог бы сократить набор родителя.
    expect(defaults.technologies).toEqual(['go'])
    expect(defaults.skills).toEqual(['frontend'])
  })

  it('скалярные значения перекрываются ближайшим потомком', () => {
    const chain = [
      node({ defaults: { ciBaseBranch: 'main', commitPolicy: 'agent_commits' } }),
      node({ defaults: { ciBaseBranch: 'develop' } })
    ]
    const defaults = resolveProjectTypeDefaults(chain)
    expect(defaults.ciBaseBranch).toBe('develop')
    expect(defaults.commitPolicy).toBe('agent_commits')
  })

  it('undefined у ребёнка не затирает значение родителя', () => {
    const chain = [node({ defaults: { testCommand: 'npm test' } }), node({ defaults: { testCommand: undefined } })]
    expect(resolveProjectTypeDefaults(chain).testCommand).toBe('npm test')
  })

  it('явный null сохраняется: «без срока» — осмысленное значение', () => {
    const chain = [node({ defaults: { doneRetentionDays: 14 } }), node({ defaults: { doneRetentionDays: null } })]
    expect(resolveProjectTypeDefaults(chain).doneRetentionDays).toBeNull()
  })
})

describe('встроенное дерево', () => {
  it('шесть встроенных узлов образуют ожидаемое дерево, у общего всё выключено', () => {
    const byId = new Map(BUILTIN_PROJECT_TYPES.map((t) => [t.id, t]))
    expect([...byId.keys()].sort()).toEqual(Object.values(BUILTIN_PROJECT_TYPE_IDS).sort())
    for (const id of [
      BUILTIN_PROJECT_TYPE_IDS.web,
      BUILTIN_PROJECT_TYPE_IDS.backend,
      BUILTIN_PROJECT_TYPE_IDS.mobile,
      BUILTIN_PROJECT_TYPE_IDS.library
    ]) {
      expect(byId.get(id)?.parentId).toBe(BUILTIN_PROJECT_TYPE_IDS.software)
    }
    expect(byId.get(BUILTIN_PROJECT_TYPE_IDS.software)?.parentId).toBeNull()

    const software = resolveProjectTypeFeatures([byId.get(BUILTIN_PROJECT_TYPE_IDS.software)!])
    for (const feature of PROJECT_FEATURES) expect(software[feature], feature).toBe(true)

    const general = resolveProjectTypeFeatures([byId.get(BUILTIN_PROJECT_TYPE_IDS.general)!])
    for (const feature of PROJECT_FEATURES) expect(general[feature], feature).toBe(false)
  })

  it('новые подтипы имеют собственные заготовки и наследуют возможности', () => {
    const byId = new Map(BUILTIN_PROJECT_TYPES.map((t) => [t.id, t]))
    const software = byId.get(BUILTIN_PROJECT_TYPE_IDS.software)!
    for (const id of [
      BUILTIN_PROJECT_TYPE_IDS.backend,
      BUILTIN_PROJECT_TYPE_IDS.mobile,
      BUILTIN_PROJECT_TYPE_IDS.library
    ]) {
      const subtype = byId.get(id)!
      const defaults = resolveProjectTypeDefaults([software, subtype])
      expect(defaults.columns?.length).toBeGreaterThan(0)
      expect(defaults.technologies?.length).toBeGreaterThan(0)
      expect(defaults.skills?.length).toBeGreaterThan(0)
      expect(defaults.defaultSkills?.task?.length).toBeGreaterThan(0)
      expect(defaults.ciBaseBranch).toBe('main')
      expect(defaults.ciBranchTemplate).toBe('{task_number}')
      expect(defaults.ciReuseStrategy).toBe('clean')
      expect(resolveProjectTypeFeatures([software, subtype]).ci).toBe(true)
    }
    expect(resolveProjectTypeFeatures([
      software,
      byId.get(BUILTIN_PROJECT_TYPE_IDS.library)!
    ]).preview).toBe(false)
  })

  it('«Веб-приложение» наследует все возможности корня и отличается только заготовками', () => {
    const byId = new Map(BUILTIN_PROJECT_TYPES.map((t) => [t.id, t]))
    const chain = [byId.get(BUILTIN_PROJECT_TYPE_IDS.software)!, byId.get(BUILTIN_PROJECT_TYPE_IDS.web)!]
    const features = resolveProjectTypeFeatures(chain)
    for (const feature of PROJECT_FEATURES) expect(features[feature], feature).toBe(true)
    expect(resolveProjectTypeDefaults(chain).technologies).toEqual(['web'])
  })

  it('у общего проекта своя доска без конвейера разработки, но с системными колонками', () => {
    const general = BUILTIN_PROJECT_TYPES.find((t) => t.id === BUILTIN_PROJECT_TYPE_IDS.general)!
    const semantics = (general.defaults.columns ?? []).map((c) => c.semanticType)
    expect(semantics).toContain('done')
    expect(semantics).toContain('cancelled')
    expect(semantics).toContain('decision_required')
    for (const dev of ['component_qa', 'integration_tests', 'automated_qa', 'manual_qa', 'merge', 'awaiting_merge']) {
      expect(semantics, dev).not.toContain(dev)
    }
  })
})

describe('видимость и публикация', () => {
  it('в каталоге видны встроенные, опубликованные и свои', () => {
    expect(isProjectTypeVisible(node({ builtin: true, ownerId: null }), 'carol')).toBe(true)
    expect(isProjectTypeVisible(node({ status: 'published' }), 'carol')).toBe(true)
    expect(isProjectTypeVisible(node({ status: 'private', ownerId: 'bob' }), 'bob')).toBe(true)
    expect(isProjectTypeVisible(node({ status: 'private', ownerId: 'bob' }), 'carol')).toBe(false)
    // Отправленный на утверждение ещё не общий.
    expect(isProjectTypeVisible(node({ status: 'pending', ownerId: 'bob' }), 'carol')).toBe(false)
  })

  it('публикация запрещена, пока хоть один предок приватный', () => {
    const builtinRoot = node({ builtin: true, status: 'private' })
    expect(canPublishProjectType([builtinRoot, node({ status: 'private' })])).toBe(true)
    expect(canPublishProjectType([builtinRoot, node({ status: 'published' }), node()])).toBe(true)
    // Приватный родитель невидим остальным — общий ребёнок повис бы в воздухе.
    expect(canPublishProjectType([builtinRoot, node({ status: 'private' }), node()])).toBe(false)
    expect(canPublishProjectType([builtinRoot, node({ status: 'rejected' }), node()])).toBe(false)
    expect(canPublishProjectType([])).toBe(false)
  })
})

describe('разбор внешнего входа', () => {
  it('чужие ключи и не-boolean отбрасываются', () => {
    expect(parseProjectFeatureOverride({ ci: true, qa: false, wat: true, git: 'yes' })).toEqual({ ci: true, qa: false })
    expect(parseProjectFeatureOverride(null)).toEqual({})
    expect(parseProjectFeatureOverride('ci')).toEqual({})
  })

  it('строковые значения проверяются по спискам', () => {
    expect(parseProjectFeature('ci')).toBe('ci')
    expect(parseProjectFeature('nope')).toBeNull()
    expect(parseProjectTypeStatus('published')).toBe('published')
    expect(parseProjectTypeStatus('deleted')).toBeNull()
  })

  it('ярлык цепочки читается как путь', () => {
    expect(projectTypeChainLabel([node({ name: 'Разработка ПО' }), node({ name: 'Веб-приложение' })]))
      .toBe('Разработка ПО / Веб-приложение')
  })
})

describe('сообщение об отказе по возможностям', () => {
  it('называет подсистему и объясняет, что чинится сменой типа', () => {
    const message = featureUnavailableMessage('releases')
    expect(message).toContain('релизов')
    // Главное: человек должен понять, что повтор действия не поможет.
    expect(message).toContain('тип проекта')
    expect(message).not.toContain('feature_unavailable')
  })

  it('каждая подсистема названа по-русски и в родительном падеже', () => {
    for (const feature of PROJECT_FEATURES) {
      expect(featureUnavailableMessage(feature), feature).toMatch(/^В этом проекте нет .+: их выключил тип проекта/)
    }
  })

  it('неизвестный код не ломает текст', () => {
    expect(featureUnavailableMessage('нечто')).toContain('текущего типа проекта')
    expect(featureUnavailableMessage(undefined)).toContain('текущего типа проекта')
  })
})
