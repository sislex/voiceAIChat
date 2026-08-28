import { describe, expect, it } from 'vitest'
import { validateJsonSchema } from './jsonSchemaLite'

const schema = { type: 'object', required: ['name', 'email'], properties: { name: { type: 'string', minLength: 2 }, email: { type: 'string', format: 'email' }, age: { type: 'integer', minimum: 0, maximum: 150 }, role: { enum: ['admin', 'user'] }, tags: { type: 'array', items: { type: 'string' } } } }

describe('validateJsonSchema', () => {
  it('валидный объект — без замечаний', () => {
    expect(validateJsonSchema(schema, { name: 'Анна', email: 'a@b.co', age: 30, role: 'admin', tags: ['x'] })).toEqual([])
  })
  it('собирает все ошибки с путями', () => {
    const issues = validateJsonSchema(schema, { name: 'A', email: 'nope', age: 200, role: 'guest', tags: [1] })
    expect(issues.map((i) => `${i.path}: ${i.message}`)).toEqual([
      'name: короче 2 символов', 'email: некорректный email', 'age: больше 150', "role: значение не из списка: \"admin\", \"user\"", '$[0]: ожидается string, получено integer'.replace('$[0]', 'tags[0]')
    ])
    expect(validateJsonSchema(schema, {})).toEqual([{ path: 'name', message: 'обязательное поле' }, { path: 'email', message: 'обязательное поле' }])
    expect(validateJsonSchema(schema, 'str')).toEqual([{ path: '$', message: 'ожидается object, получено string' }])
  })
})
