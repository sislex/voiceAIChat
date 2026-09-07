// Охраны удаления релиза и сессии ручного QA — методы, которых не вызывал ни один
// тест (найдены счётчиком вызовов функций в отчёте покрытия).
//
// Ценность здесь не в «покрыть строки», а в том, что каждая охрана отвечает на
// вопрос «что нельзя сделать». Удаление текущего production-релиза или правка
// закрытой QA-сессии — это не неудобство, а потеря состояния, которое чинится
// руками. Поэтому проверяются именно отказы, по одному на причину.

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { VoiceChatDb } from './database.js'

let db: VoiceChatDb
let ids = 0

beforeEach(async () => {
  ids = 0
  db = new VoiceChatDb(':memory:', { newId: () => `id-${++ids}`, now: () => 1_000 + ids })
  await db.identity.createUser('owner', '', 'developer')
  await db.identity.createUser('stranger', '', 'developer')
})
afterEach(() => db.close())

const SHA = 'c'.repeat(40)

describe('softDeleteProjectRelease: что удалить нельзя', () => {
  async function releaseFixture(status: 'ready' | 'failed' | 'released' | 'building' = 'ready') {
    const project = await db.projects.createProject('owner', { name: 'Релизы' })
    const release = await db.releases.createProjectRelease('owner', project.id, { branch: 'release/1.0.0', version: '1.0.0', sha: SHA, status })
    return { project, release }
  }

  it('готовый релиз без потомков удаляется и пропадает из списка', async () => {
    // Удаление мягкое: из списка релиз уходит (`listProjectReleases` фильтрует
    // `deleted_at IS NULL`), но по прямой ссылке остаётся доступен — история
    // деплоя и события не теряются.
    const { project, release } = await releaseFixture('ready')
    expect(await db.releases.softDeleteProjectRelease('owner', project.id, release.id)).toBe(true)
    expect((await db.releases.listProjectReleases('owner', project.id)).map((item) => item.id)).not.toContain(release.id)
    expect(await db.releases.getProjectRelease('owner', project.id, release.id)).not.toBeNull()
  })

  it('упавший релиз тоже удаляется — он ничего не держит', async () => {
    const { project, release } = await releaseFixture('failed')
    expect(await db.releases.softDeleteProjectRelease('owner', project.id, release.id)).toBe(true)
  })

  it('не владелец проекта удалить не может', async () => {
    const { project, release } = await releaseFixture()
    await expect(async () => await db.releases.softDeleteProjectRelease('stranger', project.id, release.id)).rejects.toThrow(/release permission required/)
    expect(await db.releases.getProjectRelease('owner', project.id, release.id)).not.toBeNull()
  })

  it('релиз в работе удалить нельзя', async () => {
    // building — деплой идёт прямо сейчас, удаление осиротило бы его шаги.
    const { project, release } = await releaseFixture('building')
    await expect(async () => await db.releases.softDeleteProjectRelease('owner', project.id, release.id)).rejects.toThrow(/нельзя удалить/)
  })

  it('релиз чужого проекта не удаляется даже владельцем своего', async () => {
    const { release } = await releaseFixture()
    const other = await db.projects.createProject('owner', { name: 'Другой' })
    await expect(async () => await db.releases.softDeleteProjectRelease('owner', other.id, release.id)).rejects.toThrow(/нельзя удалить/)
  })

  it('несуществующий релиз — отказ, а не тихий успех', async () => {
    const { project } = await releaseFixture()
    await expect(async () => await db.releases.softDeleteProjectRelease('owner', project.id, 'нет-такого')).rejects.toThrow(/нельзя удалить/)
  })

  it('повторное удаление проходит молча — охрана `deleted_at` не смотрит', async () => {
    // Зафиксировано как есть: вреда нет (переставляется та же метка), но знать
    // об этом стоит — «уже удалён» и «удалён сейчас» снаружи неотличимы.
    const { project, release } = await releaseFixture()
    await db.releases.softDeleteProjectRelease('owner', project.id, release.id)
    expect(await db.releases.softDeleteProjectRelease('owner', project.id, release.id)).toBe(true)
  })
})

describe('сессия ручного QA: правки только у живой сессии', () => {
  async function qaFixture() {
    const project = await db.projects.createProject('owner', { name: 'QA' })
    const column = (await db.tasks.getBoard('owner', project.id))!.columns.find((item) => item.semanticType === 'manual_qa')!
    const task = (await db.tasks.createTask('owner', project.id, { columnId: column.id, title: 'Форма' }))!
    await db.qa.createAcceptanceCriterion('owner', project.id, task.id, {
      title: 'Сохранение', description: 'Форма сохраняется', preconditions: 'Открыт экран',
      steps: '1. Нажать Сохранить', testData: 'имя: QA', expectedResult: 'Сохранено',
      required: true, testType: 'manual'
    })
    const session = (await db.qa.startQaSession('owner', {
      projectId: project.id, taskId: task.id, branch: 'work', commitSha: SHA, testRunId: 'run-1'
    }))!
    return { project, task, session }
  }

  it('заметки сохраняются в активной сессии', async () => {
    const { project, task, session } = await qaFixture()
    const updated = await db.qa.saveQaAdditionalIssues('owner', project.id, task.id, session.id, 'нашлась опечатка в подписи')
    expect(updated.additionalIssues).toBe('нашлась опечатка в подписи')
  })

  it('заметки перезаписываются, а не дописываются', async () => {
    const { project, task, session } = await qaFixture()
    await db.qa.saveQaAdditionalIssues('owner', project.id, task.id, session.id, 'первое')
    expect((await db.qa.saveQaAdditionalIssues('owner', project.id, task.id, session.id, 'второе')).additionalIssues).toBe('второе')
  })

  it('без права QA заметки не сохраняются', async () => {
    const { project, task, session } = await qaFixture()
    await expect(async () => await db.qa.saveQaAdditionalIssues('stranger', project.id, task.id, session.id, 'чужое')).rejects.toThrow(/QA permission required/)
  })

  it('в несуществующую сессию писать нельзя', async () => {
    const { project, task } = await qaFixture()
    await expect(async () => await db.qa.saveQaAdditionalIssues('owner', project.id, task.id, 'нет-такой', 'текст')).rejects.toThrow(/stale or closed/)
  })

  it('заметки не пишутся в сессию чужой задачи', async () => {
    // id сессии угадать нельзя, но подстановка чужого projectId/taskId обязана
    // отсекаться — иначе правка уехала бы в чужую задачу.
    const { session } = await qaFixture()
    const other = await db.projects.createProject('owner', { name: 'Другой' })
    const column = (await db.tasks.getBoard('owner', other.id))!.columns.find((item) => item.semanticType === 'manual_qa')!
    const otherTask = (await db.tasks.createTask('owner', other.id, { columnId: column.id, title: 'Чужая' }))!
    await expect(async () => await db.qa.saveQaAdditionalIssues('owner', other.id, otherTask.id, session.id, 'текст')).rejects.toThrow(/stale or closed/)
  })
})

describe('привязки CI-команды', () => {
  it('у неиспользуемой команды привязок нет', async () => {
    expect(await db.ci.ciCommandUsage('нет-такой')).toEqual({ projects: [], tasks: [] })
  })

  it('проект и задача перечисляются с человеческими именами', async () => {
    const project = await db.projects.createProject('owner', { name: 'Сборка' })
    const column = (await db.tasks.getBoard('owner', project.id))!.columns.find((item) => item.semanticType === 'ready')!
    const task = (await db.tasks.createTask('owner', project.id, { columnId: column.id, title: 'Починить гейт' }))!
    const command = await db.ci.createCiCommand('owner', { name: 'Тесты', script: 'npm test' })
    await db.ci.setCiSlotCommands('project', project.id, 'after_model', [command.id])
    await db.ci.setCiSlotCommands('task', task.id, 'after_model', [command.id])

    const usage = await db.ci.ciCommandUsage(command.id)
    expect(usage.projects).toEqual([{ id: project.id, name: 'Сборка' }])
    expect(usage.tasks).toEqual([{ id: task.id, title: 'Починить гейт' }])
  })

  it('повторные привязки к одному владельцу не двоятся в списке', async () => {
    const project = await db.projects.createProject('owner', { name: 'Сборка' })
    const command = await db.ci.createCiCommand('owner', { name: 'Тесты', script: 'npm test' })
    await db.ci.setCiSlotCommands('project', project.id, 'before_model', [command.id])
    await db.ci.setCiSlotCommands('project', project.id, 'after_model', [command.id])
    expect((await db.ci.ciCommandUsage(command.id)).projects).toHaveLength(1)
  })
})
