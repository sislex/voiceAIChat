import { describe, expect, it } from 'vitest'
import { testStages } from './testStages.js'

describe('testStages', () => {
  it('пустая настройка возвращает дефолт вызывающей стороны', () => {
    expect(testStages('', ['npm run affected-check'])).toEqual(['npm run affected-check'])
    expect(testStages('  \n', ['npm run test:storybook'])).toEqual(['npm run test:storybook'])
  })

  it('строка без ведущей "[" — одиночная команда', () => {
    expect(testStages('  npm run typecheck && npm test  ', ['x'])).toEqual(['npm run typecheck && npm test'])
  })

  it('валидный JSON-массив — список непустых trim-нутых стадий', () => {
    expect(testStages('["npm run one", "  npm run two  ", "", "   ", 42]', ['x'])).toEqual(['npm run one', 'npm run two'])
  })

  it('некорректный JSON с ведущей "[" выполняется как одна команда для явного падения', () => {
    expect(testStages('[npm run one', ['x'])).toEqual(['[npm run one'])
  })

  it('пустой или полностью отфильтрованный массив выполняется как одна команда', () => {
    expect(testStages('[]', ['x'])).toEqual(['[]'])
    expect(testStages('[""]', ['x'])).toEqual(['[""]'])
  })
})
