import { describe, expect, it } from 'vitest'
import { CI_INFRA_LABEL, classifyCiInfraFailure, formatCiInfraFailure } from './infraErrors.js'

/** Реальный хвост лога с гонки двух `npm ci` за общий ~/.npm (задача #30). */
const CACACHE_EEXIST = `npm error code EEXIST
npm error syscall rename
npm error path /root/.npm/_cacache/tmp/6f0d1a2b
npm error dest /root/.npm/_cacache/content-v2/sha512/aa/bb/ccddeeff
npm error EEXIST: file already exists, rename '/root/.npm/_cacache/tmp/6f0d1a2b' -> '/root/.npm/_cacache/content-v2/sha512/aa/bb/ccddeeff'
`

const CACACHE_ENOENT = `npm warn tar TAR_ENTRY_ERROR ENOENT: no such file or directory
npm error code ENOENT
npm error ENOENT: no such file or directory, stat '/root/.npm/_cacache/content-v2/sha512/12/34/5678'
`

describe('classifyCiInfraFailure', () => {
  it('EEXIST в _cacache → инфраструктурный сбой npm_cache', () => {
    const f = classifyCiInfraFailure({ exitCode: 254, output: CACACHE_EEXIST })
    expect(f?.kind).toBe('npm_cache')
    expect(f?.message).toContain('254')
    expect(f?.hint).toContain('npm cache clean --force')
  })

  it('ENOENT в _cacache → тот же класс (код выхода не важен)', () => {
    expect(classifyCiInfraFailure({ exitCode: 1, output: CACACHE_ENOENT })?.kind).toBe('npm_cache')
    expect(classifyCiInfraFailure({ exitCode: null, output: CACACHE_ENOENT })?.kind).toBe('npm_cache')
  })

  it('ENOSPC → disk_full', () => {
    const f = classifyCiInfraFailure({ exitCode: 1, output: 'Error: ENOSPC: no space left on device, write' })
    expect(f?.kind).toBe('disk_full')
  })

  it('обычная ошибка задачи инфраструктурной не считается', () => {
    expect(classifyCiInfraFailure({ exitCode: 1, output: '1 test failed\nExpected 2 to be 3\n' })).toBeNull()
    // ENOENT сам по себе (нет модуля в проекте) — это к модели, а не к машине.
    expect(classifyCiInfraFailure({ exitCode: 254, output: "Error: ENOENT: no such file or directory, open 'src/missing.ts'" })).toBeNull()
    // EEXIST вне кэша npm — тоже задача (mkdir в скрипте шага).
    expect(classifyCiInfraFailure({ exitCode: 1, output: "mkdir: EEXIST: file already exists, mkdir '/tmp/x'" })).toBeNull()
    expect(classifyCiInfraFailure({ exitCode: 254, output: '' })).toBeNull()
  })

  // Реальный хвост шага «Удалить рабочую папку задачи» в ране CHAT-115: прод
  // пересобрался посреди рана и пересоздал контейнер сервера.
  it('машина отключилась посреди шага → agent_offline', () => {
    const f = classifyCiInfraFailure({ exitCode: null, output: 'Прод-репозиторий на 105aa23\nМашина отключилась во время выполнения команды\n' })
    expect(f?.kind).toBe('agent_offline')
    expect(f?.hint).toContain('пересобирался')
    expect(CI_INFRA_LABEL[f!.kind]).toBe('машина потеряла связь')
  })

  it('машина не в сети → тот же класс', () => {
    expect(classifyCiInfraFailure({ exitCode: null, output: 'Машина не в сети' })?.kind).toBe('agent_offline')
  })

  it('тот же текст с кодом выхода или в середине вывода — ошибка задачи', () => {
    // Скрипт шага дошёл до конца и вернул код: связь была, причина в задаче.
    expect(classifyCiInfraFailure({ exitCode: 1, output: 'Машина не в сети' })).toBeNull()
    // Собственные тесты проекта печатают эти строки как названия кейсов.
    expect(classifyCiInfraFailure({ exitCode: null, output: '× remoteBashMcp > Машина не в сети\n1 test failed\n' })).toBeNull()
  })

  it('текст для лога объясняет, почему нет авто-фикса', () => {
    const text = formatCiInfraFailure(classifyCiInfraFailure({ exitCode: 254, output: CACACHE_EEXIST })!)
    expect(text).toContain('Что делать:')
    expect(text).toContain('Авто-фикс не запускаю')
  })
})
