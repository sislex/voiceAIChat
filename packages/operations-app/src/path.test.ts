// Пути на машине пользователя. Главное здесь — `isPathAllowed`: это граница
// доступа к файлам чужого хоста, и её обход означает чтение за пределами
// разрешённого каталога. Поэтому проверяются не «happy path», а попытки выйти:
// `..`, префикс-совпадение соседнего каталога и подмена разделителя.

import { describe, expect, it } from 'vitest'
import { isPathAllowed, machineBreadcrumbs, normalizeMachinePath } from './path'

describe('normalizeMachinePath', () => {
  it('схлопывает `.` и `..`, не давая уйти выше корня', () => {
    expect(normalizeMachinePath('/a/b/../c')).toBe('/a/c')
    expect(normalizeMachinePath('/a/./b')).toBe('/a/b')
    expect(normalizeMachinePath('/../../etc')).toBe('/etc')
    expect(normalizeMachinePath('/a/b/../..')).toBe('/')
  })

  it('убирает пустые сегменты от двойных слешей', () => {
    expect(normalizeMachinePath('//a///b/')).toBe('/a/b')
  })

  it('windows-путь опознаётся по букве диска и приводит её к верхнему регистру', () => {
    expect(normalizeMachinePath('c:\\Users\\me')).toBe('C:\\Users\\me')
    expect(normalizeMachinePath('C:/Users/me')).toBe('C:\\Users\\me')
  })

  it('обратный слеш в пути делает его windows-путём даже без диска', () => {
    expect(normalizeMachinePath('a\\b')).toBe('\\a\\b')
  })

  it('windows-путь тоже не уходит выше корня', () => {
    expect(normalizeMachinePath('C:\\a\\..\\..\\b')).toBe('C:\\b')
  })
})

describe('isPathAllowed', () => {
  it('сам разрешённый каталог и всё внутри него — разрешены', () => {
    expect(isPathAllowed('/home/me', ['/home/me'])).toBe(true)
    expect(isPathAllowed('/home/me/project/src', ['/home/me'])).toBe(true)
  })

  it('выход через `..` не проходит', () => {
    expect(isPathAllowed('/home/me/../other', ['/home/me'])).toBe(false)
    expect(isPathAllowed('/home/me/project/../../etc', ['/home/me'])).toBe(false)
  })

  it('сосед с общим префиксом имени не считается вложенным', () => {
    // Классическая дыра: '/home/mesh' начинается на '/home/me'.
    expect(isPathAllowed('/home/mesh', ['/home/me'])).toBe(false)
    expect(isPathAllowed('/home/me-old/x', ['/home/me'])).toBe(false)
  })

  it('хвостовой слеш в разрешённом каталоге ничего не меняет', () => {
    expect(isPathAllowed('/home/me/x', ['/home/me/'])).toBe(true)
  })

  it('регистр не даёт обойти проверку', () => {
    expect(isPathAllowed('/Home/Me/x', ['/home/me'])).toBe(true)
  })

  it('windows: разделитель и регистр диска не дают обойти проверку', () => {
    expect(isPathAllowed('c:/users/me/x', ['C:\\Users\\me'])).toBe(true)
    expect(isPathAllowed('C:\\Users\\other', ['C:\\Users\\me'])).toBe(false)
  })

  it('пустой список разрешённых каталогов не разрешает ничего', () => {
    expect(isPathAllowed('/home/me', [])).toBe(false)
  })

  it('разрешение даёт любой подходящий каталог из списка', () => {
    expect(isPathAllowed('/srv/data/x', ['/home/me', '/srv/data'])).toBe(true)
  })
})

describe('machineBreadcrumbs', () => {
  it('от корня до самого пути, накопительно', () => {
    expect(machineBreadcrumbs('/a/b/c')).toEqual(['/', '/a', '/a/b', '/a/b/c'])
  })

  it('корень сам по себе — одна крошка', () => {
    expect(machineBreadcrumbs('/')).toEqual(['/'])
  })

  it('windows считает корнем диск, а не слеш', () => {
    expect(machineBreadcrumbs('C:\\a\\b')).toEqual(['C:\\', 'C:\\a', 'C:\\a\\b'])
  })

  it('крошки строятся по нормализованному пути, а не по исходному', () => {
    expect(machineBreadcrumbs('/a/./b/../c')).toEqual(['/', '/a', '/a/c'])
  })
})
